import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  TELEGRAM_BOT_TOKEN: '1234567890:abcdefghijklmnopqrstuvwxyz',
  TELEGRAM_ADMIN_CHAT_ID: '-1001234567890',
  TELEGRAM_CHANNEL_USERNAME: '@example_channel',
  TELEGRAM_CHANNEL_URL: 'https://t.me/example_channel',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  PRIVACY_POLICY_URL: 'https://example.org/privacy',
  PRIVACY_CONTACT_EMAIL: 'owner@example.org',
  PRIVACY_CONTACT_TELEGRAM: 'https://t.me/owner',
};

describe('loadConfig', () => {
  it('parses a complete local configuration', () => {
    const config = loadConfig(validEnvironment);
    expect(config.CONTENT_BOT_KEY).toBe('telegram-service-bot');
    expect(config.DIRECTUS_ENABLED).toBe(false);
  });

  it('requires a Directus token when CMS integration is enabled', () => {
    expect(() => loadConfig({ ...validEnvironment, DIRECTUS_ENABLED: 'true' })).toThrow(
      /DIRECTUS_TOKEN/,
    );
  });

  it('rejects a placeholder privacy URL in production', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        PRIVACY_POLICY_URL: 'https://example.com/privacy',
      }),
    ).toThrow(/placeholder privacy URL/);
  });
});
