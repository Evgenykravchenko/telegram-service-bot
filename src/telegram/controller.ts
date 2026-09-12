import type { AppConfig } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import {
  complexesMenu,
  exerciseFormats,
  inlineKeyboard,
  mainMenu,
  massageTypes,
  privacyKeyboard,
  subscriptionKeyboard,
} from '../domain/keyboards.js';
import type {
  InlineKeyboardMarkup,
  ManagedContent,
  Session,
  Step,
  TelegramUpdate,
  TelegramUser,
} from '../domain/types.js';
import type {
  ApplicationRepository,
  AttributionRepository,
  SessionRepository,
} from '../repositories/contracts.js';
import type { ContentService } from '../services/content-service.js';
import type { TelegramClient } from './client.js';

const MAIN_TEXT = [
  'Здравствуйте! 👋',
  '',
  'Здесь можно получить комплекс упражнений, оставить заявку на массаж или записаться на занятие ЛФК.',
  '',
  'Выберите, что вас интересует 👇',
].join('\n');

const ACCEPTED_TEXT = [
  '<b>Готово 🤍</b>',
  '',
  'Заявка сохранена и будет передана специалисту.',
  'Как только появится возможность, с вами свяжутся в Telegram.',
].join('\n');

export class TelegramController {
  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramClient,
    private readonly sessions: SessionRepository,
    private readonly attribution: AttributionRepository,
    private readonly applications: ApplicationRepository,
    private readonly content: ContentService,
    private readonly logger: Logger,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update, update.callback_query.from);
      return;
    }
    if (update.message?.from) await this.handleMessage(update, update.message.from);
  }

  private async handleMessage(update: TelegramUpdate, user: TelegramUser): Promise<void> {
    const message = update.message;
    if (!message) return;
    const chatId = message.chat.id;
    const text = message.text?.trim() ?? '';
    const command = parseCommand(text);

    if (command.name === 'start') {
      const source = normalizeSource(command.argument);
      if (command.argument.startsWith('complex_2')) {
        await this.requestComplex(chatId, user, 2);
      } else if (command.argument.startsWith('complex')) {
        await this.showComplexes(chatId);
      } else {
        await this.attribution.saveSource(chatId, source);
        await this.showMain(chatId);
      }
      return;
    }
    if (command.name === 'menu') {
      await this.sessions.delete(chatId);
      await this.showMain(chatId);
      return;
    }
    if (command.name === 'id') {
      await this.telegram.sendMessage(chatId, `ID этого чата: <code>${chatId}</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }
    if (command.name === 'privacy') {
      await this.telegram.sendMessage(
        chatId,
        `Политика обработки данных: ${this.config.PRIVACY_POLICY_URL}`,
      );
      return;
    }
    if (command.name === 'delete_data') {
      await this.telegram.sendMessage(
        chatId,
        `Для отзыва согласия или удаления данных напишите ${this.config.PRIVACY_CONTACT_EMAIL} или ${this.config.PRIVACY_CONTACT_TELEGRAM}`,
      );
      return;
    }
    if (command.name === 'help') {
      await this.telegram.sendMessage(chatId, 'Используйте /menu, чтобы открыть главное меню.');
      return;
    }

    const session = await this.sessions.find(chatId);
    if (!session) {
      await this.showMain(chatId);
      return;
    }
    await this.acceptText(session, text);
  }

  private async handleCallback(update: TelegramUpdate, user: TelegramUser): Promise<void> {
    const callback = update.callback_query;
    if (!callback?.message) return;
    await this.telegram.answerCallbackQuery(callback.id).catch((error: unknown) => {
      this.logger.debug({ err: error }, 'Could not acknowledge callback query');
    });
    const chatId = callback.message.chat.id;
    const data = callback.data ?? '';

    if (data === 'menu') {
      await this.sessions.delete(chatId);
      await this.showMain(chatId);
      return;
    }
    if (data === 'complexes') {
      await this.showComplexes(chatId);
      return;
    }
    if (data.startsWith('complex:')) {
      await this.requestComplex(chatId, user, Number(data.slice('complex:'.length)));
      return;
    }
    if (data.startsWith('subscription:')) {
      await this.deliverComplex(chatId, user, Number(data.slice('subscription:'.length)));
      return;
    }
    if (data.startsWith('flow:')) {
      const flow = data.slice('flow:'.length);
      if (flow === 'massage' || flow === 'exercise_therapy' || flow === 'advice') {
        await this.startFlow(chatId, user, flow);
      }
      return;
    }
    if (data.startsWith('answer:')) {
      const [, field, ...valueParts] = data.split(':');
      const session = await this.sessions.find(chatId);
      if (!session || !field) return;
      await this.acceptButton(session, field, valueParts.join(':'));
      return;
    }
    if (data === 'privacy:decline') {
      await this.sessions.delete(chatId);
      await this.telegram.sendMessage(
        chatId,
        'Без согласия заявка не отправляется. Вернуться к услугам можно через /menu.',
      );
      return;
    }
    if (data === 'privacy:accept') {
      const session = await this.sessions.find(chatId);
      if (!session || session.step !== 'privacy') {
        await this.telegram.sendMessage(
          chatId,
          'Анкета уже завершена или устарела. Откройте /menu.',
        );
        return;
      }
      const consentAt = new Date().toISOString();
      session.data.privacy_consent = true;
      session.data.privacy_consent_at = consentAt;
      await this.applications.enqueue(session, update.update_id, consentAt);
      await this.telegram.sendMessage(chatId, ACCEPTED_TEXT, { parse_mode: 'HTML' });
      await this.sessions.delete(chatId);
    }
  }

  private async showMain(chatId: number): Promise<void> {
    await this.sendScreen(chatId, 'screen.main', MAIN_TEXT, mainMenu);
  }

  private async showComplexes(chatId: number): Promise<void> {
    await this.sendScreen(
      chatId,
      'screen.complexes',
      'Выберите комплекс упражнений, который хотите получить.',
      complexesMenu,
    );
  }

  private async requestComplex(chatId: number, user: TelegramUser, number: number): Promise<void> {
    if (number !== 1 && number !== 2) return;
    const subscribed = await this.telegram
      .isChannelMember(this.config.TELEGRAM_CHANNEL_USERNAME, user.id)
      .catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Channel membership check failed');
        return false;
      });
    if (!subscribed) {
      await this.telegram.sendMessage(
        chatId,
        'Чтобы получить комплекс, подпишитесь на канал и нажмите «Проверить подписку».',
        { reply_markup: subscriptionKeyboard(this.config.TELEGRAM_CHANNEL_URL, number) },
      );
      return;
    }
    await this.sendManaged(chatId, `complex.${number}`);
  }

  private async deliverComplex(chatId: number, user: TelegramUser, number: number): Promise<void> {
    const subscribed = await this.telegram.isChannelMember(
      this.config.TELEGRAM_CHANNEL_USERNAME,
      user.id,
    );
    if (!subscribed) {
      await this.telegram.sendMessage(chatId, 'Подписка пока не найдена.', {
        reply_markup: subscriptionKeyboard(this.config.TELEGRAM_CHANNEL_URL, number),
      });
      return;
    }
    await this.sendManaged(chatId, `complex.${number}`);
  }

  private async sendManaged(chatId: number, key: string): Promise<void> {
    const content = await this.content.get(key);
    if (!content || content.blocks.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        'Материал пока не опубликован. Пожалуйста, попробуйте позднее.',
      );
      return;
    }
    const keyboard = contentKeyboard(content);
    for (const [index, block] of content.blocks.entries()) {
      if (!block.body) continue;
      const options =
        index === content.blocks.length - 1 && keyboard ? { reply_markup: keyboard } : {};
      if (block.kind === 'text') await this.telegram.sendMessage(chatId, block.body, options);
      else await this.telegram.sendMedia(block.kind, chatId, block.body, options);
    }
  }

  private async startFlow(
    chatId: number,
    user: TelegramUser,
    flow: Session['flow'],
  ): Promise<void> {
    const step: Step =
      flow === 'massage'
        ? 'massage_type'
        : flow === 'exercise_therapy'
          ? 'exercise_format'
          : 'advice_request';
    const source = await this.attribution.findSource(chatId);
    const session: Session = {
      chatId,
      user,
      flow,
      step,
      source,
      data: {},
      updatedAt: new Date(),
    };
    await this.sessions.save(session);
    await this.renderStep(session);
  }

  private async acceptButton(session: Session, field: string, value: string): Promise<void> {
    if (field === 'massage_type' && session.step === 'massage_type') {
      session.data.massage_type = value;
      session.step = 'concern';
    } else if (field === 'exercise_format' && session.step === 'exercise_format') {
      session.data.exercise_format = value;
      session.step = 'exercise_goal';
    } else {
      return;
    }
    await this.sessions.save(session);
    await this.renderStep(session);
  }

  private async acceptText(session: Session, value: string): Promise<void> {
    if (!value) {
      await this.telegram.sendMessage(session.chatId, 'Ответ не должен быть пустым.');
      return;
    }
    if (value.length > 1000) {
      await this.telegram.sendMessage(session.chatId, 'Сократите ответ до 1000 символов.');
      return;
    }
    if (session.step === 'phone' && !isPhone(value)) {
      await this.telegram.sendMessage(
        session.chatId,
        'Введите номер телефона, например: +7 900 123-45-67.',
      );
      return;
    }

    const transitions: Partial<Record<Step, { field: string; next: Step }>> = {
      concern: { field: 'concern', next: 'name' },
      exercise_goal: { field: 'exercise_goal', next: 'name' },
      advice_request: { field: 'advice_request', next: 'name' },
      name: { field: 'name', next: 'phone' },
      phone: { field: 'phone', next: 'preferred_time' },
      preferred_time: { field: 'preferred_time', next: 'preferred_days' },
      preferred_days: { field: 'preferred_days', next: 'privacy' },
    };
    const transition = transitions[session.step];
    if (!transition) {
      await this.renderStep(session);
      return;
    }
    session.data[transition.field] = value;
    session.step = transition.next;
    await this.sessions.save(session);
    await this.renderStep(session);
  }

  private async renderStep(session: Session): Promise<void> {
    const prompts: Record<Step, { text: string; keyboard?: InlineKeyboardMarkup }> = {
      massage_type: { text: 'Какой массаж вас интересует?', keyboard: massageTypes },
      concern: {
        text: 'Кратко опишите задачу. Не указывайте диагнозы и данные медицинских документов.',
      },
      exercise_format: { text: 'Какой формат занятия вам удобен?', keyboard: exerciseFormats },
      exercise_goal: {
        text: 'Кратко опишите цель занятия. Не указывайте диагнозы и медицинские документы.',
      },
      advice_request: { text: 'Расскажите, с выбором какой услуги нужна помощь.' },
      name: { text: 'Как к вам обращаться?' },
      phone: { text: 'Укажите номер телефона для связи.' },
      preferred_time: { text: 'В какое время вам обычно удобно?' },
      preferred_days: { text: 'Какие дни вам подходят?' },
      privacy: {
        text: 'Для передачи заявки необходимо согласие на обработку персональных данных.',
        keyboard: privacyKeyboard(this.config.PRIVACY_POLICY_URL),
      },
    };
    const prompt = prompts[session.step];
    const managed = await this.content.get(`form.${session.step}`);
    const text = contentText(managed) || prompt.text;
    const keyboard = (managed && contentKeyboard(managed)) || prompt.keyboard;
    await this.telegram.sendMessage(session.chatId, text, {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  private async sendScreen(
    chatId: number,
    key: string,
    fallbackText: string,
    fallbackKeyboard: InlineKeyboardMarkup,
  ): Promise<void> {
    const managed = await this.content.get(key);
    await this.telegram.sendMessage(chatId, contentText(managed) || fallbackText, {
      reply_markup: (managed && contentKeyboard(managed)) || fallbackKeyboard,
    });
  }
}

function parseCommand(text: string): { name: string; argument: string } {
  if (!text.startsWith('/')) return { name: '', argument: '' };
  const [head = '', ...rest] = text.split(/\s+/);
  return {
    name: head
      .slice(1)
      .replace(/@[^\s]+$/, '')
      .toLowerCase(),
    argument: rest.join(' ').trim(),
  };
}

function normalizeSource(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'direct';
}

function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function contentKeyboard(content: ManagedContent): InlineKeyboardMarkup | undefined {
  if (content.buttons.length === 0) return undefined;
  const rows = new Map<number, InlineKeyboardMarkup['inline_keyboard'][number]>();
  for (const button of content.buttons) {
    const row = rows.get(button.row) ?? [];
    if (button.action === 'open_link') row.push({ text: button.label, url: button.target });
    else if (button.target.length <= 64)
      row.push({ text: button.label, callback_data: button.target });
    rows.set(button.row, row);
  }
  return inlineKeyboard(
    [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row),
  );
}

function contentText(content: ManagedContent | null): string {
  return (
    content?.blocks
      .filter((block) => block.kind === 'text' && block.body)
      .map((block) => block.body)
      .join('\n\n') ?? ''
  );
}
