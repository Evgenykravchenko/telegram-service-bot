import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TELEGRAM_BOT_TOKEN: z.string().min(20),
    TELEGRAM_ADMIN_CHAT_ID: z.string().regex(/^-?\d+$/),
    TELEGRAM_CHANNEL_USERNAME: z.string().regex(/^@[A-Za-z0-9_]{5,}$/),
    TELEGRAM_CHANNEL_URL: z.string().url(),
    CONTENT_BOT_KEY: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .default('telegram-service-bot'),
    DIRECTUS_ENABLED: booleanFromString,
    DIRECTUS_URL: z.string().url().default('http://localhost:8055'),
    DIRECTUS_TOKEN: z.string().default(''),
    CONTENT_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
    YANDEX_DISK_TOKEN: z.string().default(''),
    TELEGRAM_MEDIA_CHAT_ID: z
      .string()
      .refine((value) => value === '' || /^-?\d+$/.test(value), 'must be an integer chat ID')
      .default(''),
    MEDIA_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(20),
    MEDIA_BATCH_SIZE: z.coerce.number().int().min(1).max(10).default(3),
    TELEGRAM_UPLOAD_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    DATABASE_URL: z.string().url(),
    DATABASE_SSL: booleanFromString,
    PRIVACY_POLICY_URL: z.string().url(),
    PRIVACY_CONTACT_EMAIL: z.string().email(),
    PRIVACY_CONTACT_TELEGRAM: z.string().url(),
    HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(8090),
    TELEGRAM_POLL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(50).default(30),
    TELEGRAM_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(60).default(35),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    APPLICATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  })
  .superRefine((value, context) => {
    if (value.DIRECTUS_ENABLED && !value.DIRECTUS_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DIRECTUS_TOKEN'],
        message: 'DIRECTUS_TOKEN is required when DIRECTUS_ENABLED=true',
      });
    }

    if (value.YANDEX_DISK_TOKEN && !value.DIRECTUS_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DIRECTUS_ENABLED'],
        message: 'DIRECTUS_ENABLED must be true when YANDEX_DISK_TOKEN is configured',
      });
    }

    if (value.NODE_ENV === 'production' && value.PRIVACY_POLICY_URL.includes('example.com')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PRIVACY_POLICY_URL'],
        message: 'placeholder privacy URL is forbidden in production',
      });
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(environment);
}
