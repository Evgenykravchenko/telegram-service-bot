import { Readable } from 'node:stream';
import type { Logger } from '../config/logger.js';
import type {
  InlineKeyboardMarkup,
  MediaKind,
  TelegramUpdate,
  TelegramUser,
} from '../domain/types.js';
import type { DownloadableFile } from '../services/yandex-disk-client.js';

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
    private readonly uploadTimeoutMs: number,
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
    kind: MediaKind,
    chatId: number,
    reference: string,
    options: SendOptions = {},
  ): Promise<unknown> {
    const method = `send${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`;
    return this.call(method, { chat_id: chatId, [kind]: reference, ...options });
  }

  async uploadMedia(
    kind: MediaKind,
    chatId: string,
    file: DownloadableFile,
    stream: AsyncIterable<Uint8Array>,
  ): Promise<{ fileId: string; fileUniqueId: string; messageId: number }> {
    assertTelegramUploadSize(kind, file.size);
    const boundary = `telegram-service-${crypto.randomUUID()}`;
    const safeName = file.name.replace(/["\r\n]/g, '_');
    const prefix = Buffer.from(
      [
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="chat_id"\r\n\r\n',
        `${chatId}\r\n`,
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="${kind}"; filename="${safeName}"\r\n`,
        `Content-Type: ${file.mimeType}\r\n\r\n`,
      ].join(''),
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Readable.from(multipartBody(prefix, stream, suffix));
    const method = `send${capitalize(kind)}`;
    const response = await fetch(new URL(method, this.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(prefix.length + file.size + suffix.length),
      },
      body,
      duplex: 'half',
      signal: AbortSignal.timeout(this.uploadTimeoutMs),
    });
    const message = await parseTelegramResponse<UploadedMessage>(response, method);
    return extractUploadedFile(message, kind);
  }

  deleteMessage(chatId: string | number, messageId: number): Promise<unknown> {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
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
    return parseTelegramResponse<T>(response, method);
  }
}

interface TelegramFileObject {
  file_id: string;
  file_unique_id: string;
}

interface UploadedMessage {
  message_id: number;
  photo?: TelegramFileObject[];
  video?: TelegramFileObject;
  audio?: TelegramFileObject;
  document?: TelegramFileObject;
}

async function parseTelegramResponse<T>(response: Response, method: string): Promise<T> {
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

async function* multipartBody(
  prefix: Buffer,
  stream: AsyncIterable<Uint8Array>,
  suffix: Buffer,
): AsyncGenerator<Buffer> {
  yield prefix;
  for await (const chunk of stream) yield Buffer.from(chunk);
  yield suffix;
}

function extractUploadedFile(
  message: UploadedMessage,
  kind: MediaKind,
): { fileId: string; fileUniqueId: string; messageId: number } {
  const file = kind === 'photo' ? message.photo?.at(-1) : message[kind];
  if (!file) throw new Error(`Telegram response does not contain uploaded ${kind}`);
  return {
    fileId: file.file_id,
    fileUniqueId: file.file_unique_id,
    messageId: message.message_id,
  };
}

export function assertTelegramUploadSize(kind: MediaKind, size: number): void {
  const limit = (kind === 'photo' ? 10 : 50) * 1024 * 1024;
  if (size > limit) {
    throw new Error(
      `${kind} is ${formatMegabytes(size)} MB; Telegram Bot API upload limit is ${formatMegabytes(limit)} MB`,
    );
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
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
