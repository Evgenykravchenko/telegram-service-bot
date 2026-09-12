import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import type { ApplicationRecord, Session, TelegramUpdate } from '../src/domain/types.js';
import type {
  ApplicationRepository,
  AttributionRepository,
  SessionRepository,
} from '../src/repositories/contracts.js';
import { ContentService } from '../src/services/content-service.js';
import type { TelegramClient } from '../src/telegram/client.js';
import { TelegramController } from '../src/telegram/controller.js';

class MemoryStore implements SessionRepository, AttributionRepository, ApplicationRepository {
  sessions = new Map<number, Session>();
  sources = new Map<number, string>();
  applications: Session[] = [];

  async find(chatId: number): Promise<Session | null> {
    return this.sessions.get(chatId) ?? null;
  }
  async save(session: Session): Promise<void> {
    this.sessions.set(session.chatId, structuredClone(session));
  }
  async delete(chatId: number): Promise<void> {
    this.sessions.delete(chatId);
  }
  async deleteExpired(): Promise<number> {
    return 0;
  }
  async findSource(chatId: number): Promise<string> {
    return this.sources.get(chatId) ?? 'direct';
  }
  async saveSource(chatId: number, source: string): Promise<void> {
    this.sources.set(chatId, source);
  }
  async enqueue(session: Session): Promise<number> {
    this.applications.push(structuredClone(session));
    return this.applications.length;
  }
  async claimNext(): Promise<ApplicationRecord | null> {
    return null;
  }
  async markDelivered(): Promise<void> {}
  async reschedule(): Promise<void> {}
  async deleteExpiredApplications(): Promise<number> {
    return 0;
  }
}

class FakeTelegram {
  messages: Array<{ chatId: number | string; text: string; options: unknown }> = [];
  async sendMessage(chatId: number | string, text: string, options: unknown = {}): Promise<void> {
    this.messages.push({ chatId, text, options });
  }
  async answerCallbackQuery(): Promise<void> {}
  async isChannelMember(): Promise<boolean> {
    return true;
  }
  async sendMedia(): Promise<void> {}
}

const config = loadConfig({
  NODE_ENV: 'test',
  TELEGRAM_BOT_TOKEN: '1234567890:abcdefghijklmnopqrstuvwxyz',
  TELEGRAM_ADMIN_CHAT_ID: '-1001234567890',
  TELEGRAM_CHANNEL_USERNAME: '@example_channel',
  TELEGRAM_CHANNEL_URL: 'https://t.me/example_channel',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  PRIVACY_POLICY_URL: 'https://example.org/privacy',
  PRIVACY_CONTACT_EMAIL: 'owner@example.org',
  PRIVACY_CONTACT_TELEGRAM: 'https://t.me/owner',
});

const user = { id: 20, first_name: 'Иван', username: 'client' };
const message = (text: string, updateId = 1): TelegramUpdate => ({
  update_id: updateId,
  message: { message_id: updateId, chat: { id: 10, type: 'private' }, from: user, text },
});
const callback = (data: string, updateId: number): TelegramUpdate => ({
  update_id: updateId,
  callback_query: {
    id: String(updateId),
    from: user,
    data,
    message: { message_id: updateId, chat: { id: 10, type: 'private' } },
  },
});

describe('TelegramController', () => {
  let store: MemoryStore;
  let telegram: FakeTelegram;
  let controller: TelegramController;

  beforeEach(() => {
    store = new MemoryStore();
    telegram = new FakeTelegram();
    const content = new ContentService(
      false,
      config.DIRECTUS_URL,
      '',
      config.CONTENT_BOT_KEY,
      60_000,
      pino({ enabled: false }),
    );
    controller = new TelegramController(
      config,
      telegram as unknown as TelegramClient,
      store,
      store,
      store,
      content,
      pino({ enabled: false }),
    );
  });

  it('opens the main menu and remembers a safe attribution source', async () => {
    await controller.handle(message('/start instagram_reels_15'));
    expect(store.sources.get(10)).toBe('instagram_reels_15');
    expect(telegram.messages.at(-1)?.text).toContain('получить комплекс');
  });

  it('persists a form between updates and creates an application after consent', async () => {
    await controller.handle(message('/start instagram_reels_15'));
    await controller.handle(callback('flow:massage', 2));
    await controller.handle(callback('answer:massage_type:Спина и шея', 3));
    await controller.handle(message('Нужен расслабляющий массаж', 4));
    await controller.handle(message('Иван', 5));
    await controller.handle(message('+7 900 000-00-00', 6));
    await controller.handle(message('После 18:00', 7));
    await controller.handle(message('Суббота', 8));

    expect(store.sessions.get(10)?.step).toBe('privacy');
    await controller.handle(callback('privacy:accept', 9));
    expect(store.applications).toHaveLength(1);
    expect(store.applications[0]?.source).toBe('instagram_reels_15');
    expect(store.sessions.has(10)).toBe(false);
    expect(telegram.messages.at(-1)?.text).toContain('Заявка сохранена');
  });

  it('does not create an application without consent', async () => {
    await controller.handle(callback('flow:advice', 1));
    await controller.handle(callback('privacy:decline', 2));
    expect(store.applications).toHaveLength(0);
  });
});
