import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramClient } from '../src/telegram/client.js';

afterEach(() => vi.unstubAllGlobals());

describe('TelegramClient.uploadMedia', () => {
  it('streams a video and returns reusable Telegram identifiers', async () => {
    let uploadedBody = '';
    vi.stubGlobal(
      'fetch',
      async (_url: URL, init: RequestInit & { body: AsyncIterable<Buffer> }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of init.body) chunks.push(Buffer.from(chunk));
        uploadedBody = Buffer.concat(chunks).toString();
        return new Response(
          JSON.stringify({
            ok: true,
            result: { video: { file_id: 'video-file-id', file_unique_id: 'unique-video-id' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    const client = new TelegramClient(
      '1234567890:abcdefghijklmnopqrstuvwxyz',
      1000,
      1000,
      pino({ enabled: false }),
    );
    const bytes = new TextEncoder().encode('video-content');
    const result = await client.uploadMedia(
      'video',
      '-100123',
      {
        href: 'https://example.org/video.mp4',
        name: 'video.mp4',
        size: bytes.length,
        mimeType: 'video/mp4',
      },
      (async function* () {
        yield bytes;
      })(),
    );

    expect(result).toEqual({ fileId: 'video-file-id', fileUniqueId: 'unique-video-id' });
    expect(uploadedBody).toContain('name="video"; filename="video.mp4"');
    expect(uploadedBody).toContain('video-content');
  });

  it('rejects files above the official cloud Bot API limit before uploading', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new TelegramClient(
      '1234567890:abcdefghijklmnopqrstuvwxyz',
      1000,
      1000,
      pino({ enabled: false }),
    );

    await expect(
      client.uploadMedia(
        'video',
        '-100123',
        {
          href: 'https://example.org/large.mp4',
          name: 'large.mp4',
          size: 50 * 1024 * 1024 + 1,
          mimeType: 'video/mp4',
        },
        (async function* () {
          yield new Uint8Array();
        })(),
      ),
    ).rejects.toThrow(/50\.0 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
