import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: ['token', '*.token', 'authorization', '*.authorization', 'config.TELEGRAM_BOT_TOKEN'],
      censor: '[REDACTED]',
    },
  });
}
