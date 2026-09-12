import pg from 'pg';
import type { Logger } from '../config/logger.js';
import type { ApplicationRecord, Flow, Session, Step, TelegramUser } from '../domain/types.js';
import type {
  ApplicationRepository,
  AttributionRepository,
  SessionRepository,
  UpdateRepository,
} from './contracts.js';

const { Pool } = pg;

interface SessionRow {
  chat_id: string;
  user_data: TelegramUser;
  flow: Flow;
  step: Step;
  source: string;
  data: Record<string, string | boolean>;
  updated_at: Date;
}

interface ApplicationRow {
  id: string;
  chat_id: string;
  user_id: string;
  user_data: TelegramUser;
  flow: Flow;
  source: string;
  data: Record<string, string | boolean>;
  consent_at: Date;
  status: ApplicationRecord['status'];
  attempts: number;
}

export class PostgresStore
  implements SessionRepository, UpdateRepository, ApplicationRepository, AttributionRepository
{
  private readonly pool: pg.Pool;

  constructor(
    databaseUrl: string,
    ssl: boolean,
    private readonly logger: Logger,
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      ssl: ssl ? { rejectUnauthorized: true } : false,
    });
    this.pool.on('error', (error) => logger.error({ err: error }, 'PostgreSQL pool error'));
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_sessions (
        chat_id BIGINT PRIMARY KEY,
        user_data JSONB NOT NULL,
        flow TEXT NOT NULL,
        step TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'direct',
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_updates (
        update_id BIGINT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('processing', 'done', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_attribution (
        chat_id BIGINT PRIMARY KEY,
        source TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_applications (
        id BIGSERIAL PRIMARY KEY,
        source_update_id BIGINT NOT NULL UNIQUE,
        chat_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        user_data JSONB NOT NULL,
        flow TEXT NOT NULL,
        source TEXT NOT NULL,
        data JSONB NOT NULL,
        consent_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS telegram_applications_delivery_idx
        ON telegram_applications (status, next_attempt_at, id);
      CREATE INDEX IF NOT EXISTS telegram_sessions_updated_idx
        ON telegram_sessions (updated_at);

      UPDATE telegram_applications
      SET status = 'pending', next_attempt_at = NOW()
      WHERE status = 'delivering';
    `);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async find(chatId: number): Promise<Session | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT chat_id, user_data, flow, step, source, data, updated_at
       FROM telegram_sessions WHERE chat_id = $1`,
      [chatId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      chatId: Number(row.chat_id),
      user: row.user_data,
      flow: row.flow,
      step: row.step,
      source: row.source,
      data: row.data,
      updatedAt: row.updated_at,
    };
  }

  async save(session: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO telegram_sessions (chat_id, user_data, flow, step, source, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (chat_id) DO UPDATE SET
         user_data = EXCLUDED.user_data,
         flow = EXCLUDED.flow,
         step = EXCLUDED.step,
         source = EXCLUDED.source,
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [session.chatId, session.user, session.flow, session.step, session.source, session.data],
    );
  }

  async delete(chatId: number): Promise<void> {
    await this.pool.query('DELETE FROM telegram_sessions WHERE chat_id = $1', [chatId]);
  }

  async findSource(chatId: number): Promise<string> {
    const result = await this.pool.query<{ source: string }>(
      'SELECT source FROM telegram_attribution WHERE chat_id = $1',
      [chatId],
    );
    return result.rows[0]?.source ?? 'direct';
  }

  async saveSource(chatId: number, source: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO telegram_attribution (chat_id, source, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chat_id) DO UPDATE SET source = EXCLUDED.source, updated_at = NOW()`,
      [chatId, source],
    );
  }

  async deleteExpired(ttlHours: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM telegram_sessions
       WHERE updated_at < NOW() - ($1 * INTERVAL '1 hour')`,
      [ttlHours],
    );
    return result.rowCount ?? 0;
  }

  async begin(updateId: number): Promise<boolean> {
    const result = await this.pool.query<{ status: string }>(
      `INSERT INTO telegram_updates (update_id, status)
       VALUES ($1, 'processing')
       ON CONFLICT (update_id) DO UPDATE SET
         status = 'processing',
         attempts = telegram_updates.attempts + 1,
         updated_at = NOW()
       WHERE telegram_updates.status <> 'done'
       RETURNING status`,
      [updateId],
    );
    return result.rowCount === 1;
  }

  async complete(updateId: number): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_updates SET status = 'done', last_error = NULL, updated_at = NOW()
       WHERE update_id = $1`,
      [updateId],
    );
  }

  async fail(updateId: number, error: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_updates SET status = 'failed', last_error = $2, updated_at = NOW()
       WHERE update_id = $1`,
      [updateId, errorMessage(error)],
    );
  }

  async enqueue(session: Session, updateId: number, consentAt: string): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO telegram_applications (
         source_update_id, chat_id, user_id, user_data, flow, source, data, consent_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (source_update_id) DO UPDATE SET source_update_id = EXCLUDED.source_update_id
       RETURNING id`,
      [
        updateId,
        session.chatId,
        session.user.id,
        session.user,
        session.flow,
        session.source,
        session.data,
        consentAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Application was not persisted');
    return Number(row.id);
  }

  async claimNext(): Promise<ApplicationRecord | null> {
    const result = await this.pool.query<ApplicationRow>(`
      UPDATE telegram_applications
      SET status = 'delivering', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM telegram_applications
        WHERE status = 'pending' AND next_attempt_at <= NOW()
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, chat_id, user_id, user_data, flow, source, data,
                consent_at, status, attempts
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      chatId: Number(row.chat_id),
      userId: Number(row.user_id),
      user: row.user_data,
      flow: row.flow,
      source: row.source,
      data: row.data,
      consentAt: row.consent_at.toISOString(),
      status: row.status,
      attempts: row.attempts,
    };
  }

  async markDelivered(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_applications
       SET status = 'delivered', delivered_at = NOW(), last_error = NULL
       WHERE id = $1`,
      [id],
    );
  }

  async reschedule(id: number, error: unknown, attempts: number): Promise<void> {
    const exhausted = attempts >= 10;
    const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await this.pool.query(
      `UPDATE telegram_applications SET
         status = $2,
         next_attempt_at = NOW() + ($3 * INTERVAL '1 second'),
         last_error = $4
       WHERE id = $1`,
      [id, exhausted ? 'failed' : 'pending', delaySeconds, errorMessage(error)],
    );
  }

  async deleteExpiredApplications(retentionDays: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM telegram_applications
       WHERE status IN ('delivered', 'failed')
         AND created_at < NOW() - ($1 * INTERVAL '1 day')`,
      [retentionDays],
    );
    return result.rowCount ?? 0;
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}
