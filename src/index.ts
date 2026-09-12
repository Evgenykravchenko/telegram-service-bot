import 'dotenv/config';
import { Application } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const application = new Application(config, logger);

  const shutdown = (signal: string) => {
    void application
      .stop(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.fatal({ err: error }, 'Graceful shutdown failed');
        process.exit(1);
      });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  await application.start();
}

main().catch((error: unknown) => {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
  logger.fatal({ err: error }, 'Application failed to start');
  process.exit(1);
});
