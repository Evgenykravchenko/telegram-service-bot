interface YandexDiskMetadata {
  name: string;
  size?: number;
  mime_type?: string;
  type: 'file' | 'dir';
}

interface YandexDiskLink {
  href: string;
}

export interface DownloadableFile {
  href: string;
  name: string;
  size: number;
  mimeType: string;
}

export class YandexDiskError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'YandexDiskError';
  }
}

export class YandexDiskClient {
  private readonly apiUrl = 'https://cloud-api.yandex.net/v1/disk/';

  constructor(
    private readonly token: string,
    private readonly downloadTimeoutMs = 600_000,
  ) {}

  async getDownloadableFile(path: string): Promise<DownloadableFile> {
    const [metadata, link] = await Promise.all([
      this.request<YandexDiskMetadata>('resources', { path }),
      this.request<YandexDiskLink>('resources/download', { path }),
    ]);
    if (metadata.type !== 'file') throw new Error(`Yandex Disk path is not a file: ${path}`);
    if (!metadata.size) throw new Error(`Yandex Disk did not return file size: ${path}`);
    return {
      href: link.href,
      name: metadata.name,
      size: metadata.size,
      mimeType: metadata.mime_type ?? 'application/octet-stream',
    };
  }

  async openDownload(file: DownloadableFile): Promise<AsyncIterable<Uint8Array>> {
    const response = await fetch(file.href, {
      signal: AbortSignal.timeout(this.downloadTimeoutMs),
    });
    if (!response.ok || !response.body) {
      throw new YandexDiskError(
        `Yandex Disk download failed: ${response.status} ${response.statusText}`,
        response.status,
        await response.text(),
      );
    }
    return response.body;
  }

  private async request<T>(endpoint: string, query: Record<string, string>): Promise<T> {
    const url = new URL(endpoint, this.apiUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { Authorization: `OAuth ${this.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new YandexDiskError(
        `Yandex Disk request failed: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }
    return (await response.json()) as T;
  }
}
