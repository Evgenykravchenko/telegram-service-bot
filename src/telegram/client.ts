import type { Logger } from '../config/logger.js';
import type { InlineKeyboardMarkup, TelegramUpdate, TelegramUser } from '../domain/types.js';

interface TelegramEnvelope<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface SendOptions {
  parse_mode?: 'HTML';
  reply_markup?: InlineKeyboardMarkup;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(
    token: string,
    private readonly requestTimeoutMs: number,
    private readonly logger: Logger,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}/`;
  }

  async call<T>(method: string, payload: object, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.request<T>(method, payload, signal);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === 4 || signal?.aborted) throw error;
        const retryAfter = error instanceof TelegramApiError ? error.retryAfter : undefined;
        const delayMs = (retryAfter ?? Math.min(8, 2 ** (attempt - 1))) * 1000;
        this.logger.warn({ method, attempt, delayMs }, 'Telegram request will be retried');
        await delay(delayMs, signal);
      }
    }
    throw lastError;
  }

  getUpdates(offset: number, timeout: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout, allowed_updates: ['message', 'callback_query'] },
      signal,
    );
  }

  sendMessage(chatId: number | string, text: string, options: SendOptions = {}): Promise<unknown> {
    return this.call('sendMessage', { chat_id: chatId, text, ...options });
  }

  sendMedia(
    kind: 'photo' | 'video' | 'audio' | 'document',
    chatId: number,
    reference: string,
    options: SendOptions = {},
  ): Promise<unknown> {
    const method = `send${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`;
    return this.call(method, { chat_id: chatId, [kind]: reference, ...options });
  }

  answerCallbackQuery(callbackQueryId: string): Promise<unknown> {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  async isChannelMember(channelUsername: string, userId: number): Promise<boolean> {
    const status = await this.getChatMemberStatus(channelUsername, userId);
    return !['left', 'kicked'].includes(status);
  }

  async getChatMemberStatus(chatId: string, userId: number): Promise<string> {
    const member = await this.call<{ status: string }>('getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });
    return member.status;
  }

  getChat(chatId: string): Promise<unknown> {
    return this.call('getChat', { chat_id: chatId });
  }

  getMe(): Promise<TelegramUser & { username: string }> {
    return this.call('getMe', {});
  }

  private async request<T>(method: string, payload: object, signal?: AbortSignal): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(new URL(method, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: requestSignal,
    });
    const data = (await response.json().catch(() => null)) as TelegramEnvelope<T> | null;
    if (!response.ok || !data?.ok) {
      throw new TelegramApiError(
        data?.description ?? `${method}: HTTP ${response.status}`,
        data?.error_code ?? response.status,
        data?.parameters?.retry_after,
      );
    }
    return data.result;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TelegramApiError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Request aborted'));
      },
      { once: true },
    );
  });
}
