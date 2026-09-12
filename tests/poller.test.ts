import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import type { TelegramUpdate } from '../src/domain/types.js';
import type { UpdateRepository } from '../src/repositories/contracts.js';
import type { TelegramClient } from '../src/telegram/client.js';
import type { TelegramController } from '../src/telegram/controller.js';
import { TelegramPoller } from '../src/telegram/poller.js';

class MemoryUpdates implements UpdateRepository {
  completed: number[] = [];
  failed: number[] = [];
  async begin(): Promise<boolean> {
    return true;
  }
  async complete(updateId: number): Promise<void> {
    this.completed.push(updateId);
  }
  async fail(updateId: number): Promise<void> {
    this.failed.push(updateId);
  }
}

describe('TelegramPoller', () => {
  it('does not replay a partially handled update and continues with the batch', async () => {
    const updates: TelegramUpdate[] = [{ update_id: 1 }, { update_id: 2 }];
    let request = 0;
    const telegram = {
      getUpdates: async (_offset: number, _timeout: number, signal: AbortSignal) => {
        request += 1;
        if (request === 1) return updates;
        return await new Promise<TelegramUpdate[]>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    };
    let resolveSecond: (() => void) | undefined;
    const secondHandled = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const controller = {
      handle: async (update: TelegramUpdate) => {
        if (update.update_id === 1) throw new Error('reply failed after persistence');
        resolveSecond?.();
      },
    };
    const repository = new MemoryUpdates();
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
    const poller = new TelegramPoller(
      config,
      telegram as unknown as TelegramClient,
      repository,
      controller as unknown as TelegramController,
      pino({ enabled: false }),
    );

    poller.start();
    await secondHandled;
    await poller.stop();

    expect(repository.failed).toEqual([1]);
    expect(repository.completed).toEqual([2]);
  });
});
