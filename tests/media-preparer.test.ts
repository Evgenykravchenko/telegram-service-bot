import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '../src/domain/types.js';
import type { DirectusMediaClient } from '../src/services/directus-media-client.js';
import { MediaPreparer } from '../src/services/media-preparer.js';
import type { YandexDiskClient } from '../src/services/yandex-disk-client.js';
import type { TelegramClient } from '../src/telegram/client.js';

const asset: MediaAsset = {
  id: 17,
  name: 'Комплекс для спины',
  kind: 'video',
  yandex_path: '/Telegram Bot/complex-1.mp4',
  status: 'queued',
  telegram_file_id: null,
  telegram_file_unique_id: null,
  mime_type: null,
  file_size: null,
  error_message: null,
};

describe('MediaPreparer', () => {
  it('stores Telegram identifiers after a successful streamed upload', async () => {
    const updateMedia = vi.fn().mockResolvedValue(asset);
    const file = {
      href: 'https://download.example/file',
      name: 'complex-1.mp4',
      size: 1024,
      mimeType: 'video/mp4',
    };
    const yandex = {
      getDownloadableFile: vi.fn().mockResolvedValue(file),
      openDownload: vi.fn().mockResolvedValue(
        (async function* () {
          yield new Uint8Array([1, 2, 3]);
        })(),
      ),
    };
    const telegram = {
      uploadMedia: vi.fn().mockResolvedValue({
        fileId: 'telegram-file',
        fileUniqueId: 'telegram-unique',
        messageId: 42,
      }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };
    const preparer = new MediaPreparer(
      { updateMedia } as unknown as DirectusMediaClient,
      yandex as unknown as YandexDiskClient,
      telegram as unknown as TelegramClient,
      '-100123',
      pino({ enabled: false }),
    );

    await preparer.prepare(asset);

    expect(updateMedia).toHaveBeenNthCalledWith(1, 17, {
      status: 'processing',
      error_message: null,
    });
    expect(updateMedia).toHaveBeenNthCalledWith(
      2,
      17,
      expect.objectContaining({
        status: 'ready',
        telegram_file_id: 'telegram-file',
        telegram_file_unique_id: 'telegram-unique',
        mime_type: 'video/mp4',
        file_size: 1024,
      }),
    );
    expect(telegram.deleteMessage).toHaveBeenCalledWith('-100123', 42);
  });

  it('keeps prepared media ready when staging message deletion fails', async () => {
    const updateMedia = vi.fn().mockResolvedValue(asset);
    const file = {
      href: 'https://download.example/file',
      name: 'complex-1.mp4',
      size: 1024,
      mimeType: 'video/mp4',
    };
    const yandex = {
      getDownloadableFile: vi.fn().mockResolvedValue(file),
      openDownload: vi.fn().mockResolvedValue(
        (async function* () {
          yield new Uint8Array([1, 2, 3]);
        })(),
      ),
    };
    const telegram = {
      uploadMedia: vi.fn().mockResolvedValue({
        fileId: 'telegram-file',
        fileUniqueId: 'telegram-unique',
        messageId: 42,
      }),
      deleteMessage: vi.fn().mockRejectedValue(new Error('Message cannot be deleted')),
    };
    const preparer = new MediaPreparer(
      { updateMedia } as unknown as DirectusMediaClient,
      yandex as unknown as YandexDiskClient,
      telegram as unknown as TelegramClient,
      '-100123',
      pino({ enabled: false }),
    );

    await preparer.prepare(asset);

    expect(updateMedia).toHaveBeenCalledTimes(2);
    expect(updateMedia).toHaveBeenLastCalledWith(
      17,
      expect.objectContaining({ status: 'ready', telegram_file_id: 'telegram-file' }),
    );
  });

  it('records a preparation error without leaking the token', async () => {
    const updateMedia = vi.fn().mockResolvedValue(asset);
    const yandex = {
      getDownloadableFile: vi.fn().mockRejectedValue(new Error('Resource not found')),
    };
    const preparer = new MediaPreparer(
      { updateMedia } as unknown as DirectusMediaClient,
      yandex as unknown as YandexDiskClient,
      {} as TelegramClient,
      '-100123',
      pino({ enabled: false }),
    );

    await preparer.prepare(asset);

    expect(updateMedia).toHaveBeenLastCalledWith(17, {
      status: 'error',
      error_message: 'Resource not found',
    });
  });
});
