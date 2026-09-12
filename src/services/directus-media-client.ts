import type { MediaAsset } from '../domain/types.js';

interface DirectusEnvelope<T> {
  data: T;
}

export class DirectusMediaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'DirectusMediaError';
  }
}

export class DirectusMediaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly botKey: string,
  ) {}

  async getQueuedMedia(limit: number): Promise<MediaAsset[]> {
    const query = new URLSearchParams({
      'filter[status][_eq]': 'queued',
      'filter[bot][key][_eq]': this.botKey,
      fields:
        'id,name,kind,yandex_path,status,telegram_file_id,telegram_file_unique_id,mime_type,file_size,error_message',
      sort: 'id',
      limit: String(limit),
    });
    const result = await this.request<DirectusEnvelope<MediaAsset[]>>(
      `/items/media_assets?${query.toString()}`,
    );
    return result.data;
  }

  async updateMedia(id: number, changes: Partial<MediaAsset>): Promise<MediaAsset> {
    const result = await this.request<DirectusEnvelope<MediaAsset>>(`/items/media_assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    return result.data;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new DirectusMediaError(
        `Directus request failed: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }
    return (await response.json()) as T;
  }
}
