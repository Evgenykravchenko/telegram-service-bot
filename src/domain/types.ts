export type Flow = 'massage' | 'exercise_therapy' | 'advice';

export type Step =
  | 'massage_type'
  | 'concern'
  | 'exercise_format'
  | 'exercise_goal'
  | 'advice_request'
  | 'name'
  | 'phone'
  | 'preferred_time'
  | 'preferred_days'
  | 'privacy';

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

export interface Session {
  chatId: number;
  user: TelegramUser;
  flow: Flow;
  step: Step;
  source: string;
  data: Record<string, string | boolean>;
  updatedAt: Date;
}

export interface ApplicationRecord {
  id: number;
  chatId: number;
  userId: number;
  flow: Flow;
  source: string;
  data: Record<string, string | boolean>;
  consentAt: string;
  status: 'pending' | 'delivering' | 'delivered' | 'failed';
  attempts: number;
  user: TelegramUser;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

export interface ContentBlock {
  kind: 'text' | 'photo' | 'video' | 'audio' | 'document';
  body: string | null;
  mediaReference: string | null;
  sendSeparately: boolean;
}

export interface ContentButton {
  label: string;
  action: 'text' | 'open_link';
  target: string;
  row: number;
}

export interface ManagedContent {
  blocks: ContentBlock[];
  buttons: ContentButton[];
}

export type MediaKind = 'photo' | 'video' | 'audio' | 'document';
export type MediaStatus = 'draft' | 'queued' | 'processing' | 'ready' | 'error';

export interface MediaAsset {
  id: number;
  name: string;
  kind: MediaKind;
  yandex_path: string;
  status: MediaStatus;
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  mime_type: string | null;
  file_size: number | null;
  error_message: string | null;
}
