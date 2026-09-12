import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentService } from '../src/services/content-service.js';

describe('ContentService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses bundled fallback text when Directus is disabled', async () => {
    const content = new ContentService(
      false,
      'http://localhost:8055',
      '',
      'telegram-service-bot',
      60_000,
      pino({ enabled: false }),
    );
    await expect(content.text('screen.main', 'Локальный текст')).resolves.toBe('Локальный текст');
  });

  it('uses a prepared Telegram file from the related media asset', async () => {
    vi.stubGlobal('fetch', async (url: URL) => {
      const path = String(url);
      if (path.includes('/items/responses?')) {
        return Response.json({ data: [{ id: 5 }] });
      }
      if (path.includes('/items/response_blocks?')) {
        return Response.json({
          data: [
            {
              kind: 'video',
              body: null,
              send_separately: false,
              media: { status: 'ready', telegram_file_id: 'prepared-video-id' },
            },
          ],
        });
      }
      return Response.json({ data: [] });
    });
    const content = new ContentService(
      true,
      'http://directus:8055',
      'token',
      'telegram-service-bot',
      60_000,
      pino({ enabled: false }),
    );

    const result = await content.get('complex.1');
    expect(result?.blocks[0]?.mediaReference).toBe('prepared-video-id');
  });
});
