import type { AppConfig } from './config/env.js';
import type { Logger } from './config/logger.js';
import { HealthServer } from './health/server.js';
import { PostgresStore } from './repositories/postgres.js';
import { ApplicationWorker } from './services/application-worker.js';
import { ContentService } from './services/content-service.js';
import { TelegramClient } from './telegram/client.js';
import { TelegramController } from './telegram/controller.js';
import { TelegramPoller } from './telegram/poller.js';

export class Application {
  private readonly store: PostgresStore;
  private readonly telegram: TelegramClient;
  private readonly poller: TelegramPoller;
  private readonly applicationWorker: ApplicationWorker;
  private readonly health: HealthServer;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.store = new PostgresStore(config.DATABASE_URL, config.DATABASE_SSL, logger);
    this.telegram = new TelegramClient(
      config.TELEGRAM_BOT_TOKEN,
      config.TELEGRAM_REQUEST_TIMEOUT_SECONDS * 1000,
      logger,
    );
    const content = new ContentService(
      config.DIRECTUS_ENABLED,
      config.DIRECTUS_URL,
      config.DIRECTUS_TOKEN,
      config.CONTENT_BOT_KEY,
      config.CONTENT_CACHE_TTL_SECONDS * 1000,
      logger,
    );
    const controller = new TelegramController(
      config,
      this.telegram,
      this.store,
      this.store,
      this.store,
      content,
      logger,
    );
    this.poller = new TelegramPoller(config, this.telegram, this.store, controller, logger);
    this.applicationWorker = new ApplicationWorker(config, this.store, this.telegram, logger);
    this.health = new HealthServer(config.HEALTH_PORT, () => this.store.ping(), logger);
  }

  async start(): Promise<void> {
    await this.store.migrate();
    await this.telegram.call('deleteWebhook', { drop_pending_updates: false });
    await this.telegram.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Запустить бота' },
        { command: 'menu', description: 'Главное меню' },
        { command: 'id', description: 'Показать ID текущего чата' },
        { command: 'privacy', description: 'Политика обработки данных' },
        { command: 'delete_data', description: 'Отозвать согласие или удалить данные' },
        { command: 'help', description: 'Помощь' },
      ],
    });
    const me = await this.telegram.getMe();
    await this.telegram.getChat(this.config.TELEGRAM_ADMIN_CHAT_ID);
    const channelStatus = await this.telegram.getChatMemberStatus(
      this.config.TELEGRAM_CHANNEL_USERNAME,
      me.id,
    );
    if (!['administrator', 'creator'].includes(channelStatus)) {
      throw new Error(
        `Bot must be an administrator of ${this.config.TELEGRAM_CHANNEL_USERNAME} to check subscriptions`,
      );
    }
    await this.health.start();
    this.applicationWorker.start();
    this.poller.start();
    await this.cleanup();
    this.cleanupTimer = setInterval(() => void this.cleanup(), 6 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
    this.logger.info(
      { bot: me.username, contentBotKey: this.config.CONTENT_BOT_KEY },
      'Telegram service bot started',
    );
  }

  async stop(signal: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.logger.info({ signal }, 'Stopping application');
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.poller.stop();
    await this.applicationWorker.stop();
    await this.health.stop();
    await this.store.close();
  }

  private async cleanup(): Promise<void> {
    try {
      const [sessions, applications] = await Promise.all([
        this.store.deleteExpired(this.config.SESSION_TTL_HOURS),
        this.store.deleteExpiredApplications(this.config.APPLICATION_RETENTION_DAYS),
      ]);
      if (sessions + applications > 0) {
        this.logger.info({ sessions, applications }, 'Expired records removed');
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Data retention cleanup failed');
    }
  }
}
