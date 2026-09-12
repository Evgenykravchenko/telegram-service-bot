import type { ApplicationRecord, Session } from '../domain/types.js';

export interface SessionRepository {
  find(chatId: number): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(chatId: number): Promise<void>;
  deleteExpired(ttlHours: number): Promise<number>;
}

export interface AttributionRepository {
  findSource(chatId: number): Promise<string>;
  saveSource(chatId: number, source: string): Promise<void>;
}

export interface UpdateRepository {
  begin(updateId: number): Promise<boolean>;
  complete(updateId: number): Promise<void>;
  fail(updateId: number, error: unknown): Promise<void>;
}

export interface ApplicationRepository {
  enqueue(session: Session, updateId: number, consentAt: string): Promise<number>;
  claimNext(): Promise<ApplicationRecord | null>;
  markDelivered(id: number): Promise<void>;
  reschedule(id: number, error: unknown, attempts: number): Promise<void>;
  deleteExpiredApplications(retentionDays: number): Promise<number>;
}
