import type { Logger } from '../config/logger.js';
import type { MediaAsset } from '../domain/types.js';
import { assertTelegramUploadSize, type TelegramClient } from '../telegram/client.js';
import type { DirectusMediaClient } from './directus-media-client.js';
import type { YandexDiskClient } from './yandex-disk-client.js';

export class MediaPreparer {
  constructor(
    private readonly directus: DirectusMediaClient,
    private readonly yandexDisk: YandexDiskClient,
    private readonly telegram: TelegramClient,
    private readonly mediaChatId: string,
    private readonly logger: Logger,
  ) {}

  async prepare(asset: MediaAsset): Promise<void> {
    await this.directus.updateMedia(asset.id, { status: 'processing', error_message: null });
    try {
      const file = await this.yandexDisk.getDownloadableFile(asset.yandex_path);
      assertTelegramUploadSize(asset.kind, file.size);
      const stream = await this.yandexDisk.openDownload(file);
      const uploaded = await this.telegram.uploadMedia(asset.kind, this.mediaChatId, file, stream);
      await this.directus.updateMedia(asset.id, {
        status: 'ready',
        telegram_file_id: uploaded.fileId,
        telegram_file_unique_id: uploaded.fileUniqueId,
        mime_type: file.mimeType,
        file_size: file.size,
        error_message: null,
      });
      try {
        await this.telegram.deleteMessage(this.mediaChatId, uploaded.messageId);
      } catch (error) {
        this.logger.warn(
          { err: error, mediaId: asset.id, messageId: uploaded.messageId },
          'Telegram staging message deletion failed',
        );
      }
      this.logger.info({ mediaId: asset.id, kind: asset.kind }, 'Telegram media prepared');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.directus.updateMedia(asset.id, {
        status: 'error',
        error_message: message.slice(0, 1000),
      });
      this.logger.error({ err: error, mediaId: asset.id }, 'Telegram media preparation failed');
    }
  }
}
