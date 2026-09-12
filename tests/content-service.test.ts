import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { ContentService } from '../src/services/content-service.js';

describe('ContentService', () => {
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
});
