import type { Logger } from '../config/logger.js';
import type { ContentBlock, ContentButton, ManagedContent } from '../domain/types.js';

interface DirectusEnvelope<T> {
  data: T;
}

interface DirectusResponse {
  id: number;
}

interface DirectusBlock {
  kind: ContentBlock['kind'];
  body: string | null;
  send_separately: boolean;
}

interface DirectusButton {
  label: string;
  action: ContentButton['action'];
  target: string;
  row_number: number;
}

interface CacheEntry {
  content: ManagedContent;
  expiresAt: number;
}

export class ContentService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly enabled: boolean,
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly botKey: string,
    private readonly ttlMs: number,
    private readonly logger: Logger,
  ) {}

  async get(key: string): Promise<ManagedContent | null> {
    if (!this.enabled) return null;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.content;

    try {
      const content = await this.fetchContent(key);
      if (content) this.cache.set(key, { content, expiresAt: Date.now() + this.ttlMs });
      return content ?? cached?.content ?? null;
    } catch (error) {
      this.logger.warn({ err: error, contentKey: key }, 'Directus content unavailable');
      return cached?.content ?? null;
    }
  }

  async text(key: string, fallback: string): Promise<string> {
    const content = await this.get(key);
    const body = content?.blocks
      .filter((block) => block.kind === 'text' && block.body)
      .map((block) => block.body)
      .join('\n\n');
    return body || fallback;
  }

  private async fetchContent(key: string): Promise<ManagedContent | null> {
    const responseQuery = new URLSearchParams({
      'filter[name][_eq]': key,
      'filter[status][_eq]': 'published',
      'filter[bot][key][_eq]': this.botKey,
      fields: 'id',
      limit: '2',
    });
    const response = await this.request<DirectusEnvelope<DirectusResponse[]>>(
      `/items/responses?${responseQuery.toString()}`,
    );
    const item = response.data[0];
    if (!item) return null;
    if (response.data.length > 1) {
      this.logger.warn({ contentKey: key }, 'Duplicate Directus content key');
    }

    const blockQuery = new URLSearchParams({
      'filter[response][_eq]': String(item.id),
      'filter[enabled][_eq]': 'true',
      fields: 'kind,body,send_separately',
      sort: 'sort,id',
      limit: '-1',
    });
    const buttonQuery = new URLSearchParams({
      'filter[response][_eq]': String(item.id),
      'filter[enabled][_eq]': 'true',
      fields: 'label,action,target,row_number',
      sort: 'row_number,sort,id',
      limit: '-1',
    });
    const [blocks, buttons] = await Promise.all([
      this.request<DirectusEnvelope<DirectusBlock[]>>(
        `/items/response_blocks?${blockQuery.toString()}`,
      ),
      this.request<DirectusEnvelope<DirectusButton[]>>(
        `/items/response_buttons?${buttonQuery.toString()}`,
      ),
    ]);

    return {
      blocks: blocks.data.map((block) => ({
        kind: block.kind,
        body: block.body,
        sendSeparately: block.send_separately,
      })),
      buttons: buttons.data.map((button) => ({
        label: button.label,
        action: button.action,
        target: button.target,
        row: button.row_number,
      })),
    };
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Directus request failed: ${response.status}`);
    return (await response.json()) as T;
  }
}
