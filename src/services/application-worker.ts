import type { AppConfig } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import type { ApplicationRecord } from '../domain/types.js';
import { inlineKeyboard } from '../domain/keyboards.js';
import type { ApplicationRepository } from '../repositories/contracts.js';
import type { TelegramClient } from '../telegram/client.js';

export class ApplicationWorker {
  private stopping = false;
  private running: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly applications: ApplicationRepository,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.running) return;
    this.stopping = false;
    this.running = this.loop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.running;
    this.running = null;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      const application = await this.applications.claimNext().catch((error: unknown) => {
        this.logger.error({ err: error }, 'Could not claim pending application');
        return null;
      });
      if (!application) {
        await delay(1000);
        continue;
      }
      await this.deliver(application);
    }
  }

  private async deliver(application: ApplicationRecord): Promise<void> {
    try {
      const username = application.user.username;
      const contactUrl = username
        ? `https://t.me/${username}`
        : `tg://user?id=${application.userId}`;
      await this.telegram.sendMessage(
        this.config.TELEGRAM_ADMIN_CHAT_ID,
        buildAdminCard(application),
        {
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard([[{ text: '💬 Написать клиенту', url: contactUrl }]]),
        },
      );
      await this.applications.markDelivered(application.id);
      this.logger.info({ applicationId: application.id }, 'Application delivered');
    } catch (error) {
      await this.applications.reschedule(application.id, error, application.attempts);
      this.logger.error(
        { err: error, applicationId: application.id, attempts: application.attempts },
        'Application delivery failed',
      );
    }
  }
}

export function buildAdminCard(application: ApplicationRecord): string {
  const data = application.data;
  const service =
    application.flow === 'massage'
      ? 'Массаж'
      : application.flow === 'exercise_therapy'
        ? 'ЛФК'
        : 'Помощь с выбором услуги';
  const details =
    application.flow === 'massage'
      ? [`<b>Вид массажа:</b> ${safe(data.massage_type)}`, `<b>Запрос:</b> ${safe(data.concern)}`]
      : application.flow === 'exercise_therapy'
        ? [
            `<b>Формат:</b> ${safe(data.exercise_format)}`,
            `<b>Цель:</b> ${safe(data.exercise_goal)}`,
          ]
        : [`<b>Запрос:</b> ${safe(data.advice_request)}`];
  return [
    `🔔 <b>НОВАЯ ЗАЯВКА: ${service.toUpperCase()}</b>`,
    '',
    `<b>Имя:</b> ${safe(data.name)}`,
    `<b>Telegram:</b> ${safe(application.user.username ? `@${application.user.username}` : '—')}`,
    `<b>Telegram user ID:</b> ${application.userId}`,
    `<b>Телефон:</b> ${safe(data.phone)}`,
    ...details,
    '',
    `<b>Удобное время:</b> ${safe(data.preferred_time)}`,
    `<b>Дни:</b> ${safe(data.preferred_days)}`,
    `<b>Согласие:</b> ${safe(formatDate(application.consentAt))}`,
    `<b>Источник:</b> ${safe(application.source)}`,
  ].join('\n');
}

function safe(value: string | boolean | undefined): string {
  return String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Omsk',
  }).format(new Date(value));
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
