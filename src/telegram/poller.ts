import type { AppConfig } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import type { UpdateRepository } from '../repositories/contracts.js';
import type { TelegramClient } from './client.js';
import type { TelegramController } from './controller.js';

export class TelegramPoller {
  private readonly abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private offset = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramClient,
    private readonly updates: UpdateRepository,
    private readonly controller: TelegramController,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.loopPromise) return;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        const batch = await this.telegram.getUpdates(
          this.offset,
          this.config.TELEGRAM_POLL_TIMEOUT_SECONDS,
          this.abortController.signal,
        );
        for (const update of batch) {
          const shouldProcess = await this.updates.begin(update.update_id);
          if (!shouldProcess) {
            this.offset = update.update_id + 1;
            continue;
          }
          try {
            await this.controller.handle(update);
            await this.updates.complete(update.update_id);
            this.offset = update.update_id + 1;
          } catch (error) {
            await this.updates.fail(update.update_id, error);
            this.logger.error({ err: error, updateId: update.update_id }, 'Update handling failed');
            // The handler may already have persisted a state transition or queued an
            // application. Replaying the same update could apply that transition twice.
            this.offset = update.update_id + 1;
          }
        }
      } catch (error) {
        if (this.abortController.signal.aborted) break;
        this.logger.error({ err: error }, 'Telegram polling failed');
        await delay(3000);
      }
    }
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
