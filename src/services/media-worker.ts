import type { Logger } from '../config/logger.js';
import type { DirectusMediaClient } from './directus-media-client.js';
import type { MediaPreparer } from './media-preparer.js';

export class MediaWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly directus: DirectusMediaClient,
    private readonly preparer: MediaPreparer,
    private readonly intervalMs: number,
    private readonly batchSize: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    this.logger.info({ intervalMs: this.intervalMs }, 'Telegram media worker started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const assets = await this.directus.getQueuedMedia(this.batchSize);
      for (const asset of assets) await this.preparer.prepare(asset);
    } catch (error) {
      this.logger.error({ err: error }, 'Telegram media worker iteration failed');
    } finally {
      this.running = false;
    }
  }
}
