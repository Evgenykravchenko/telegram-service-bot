import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '../config/logger.js';

export class HealthServer {
  private server: Server | null = null;

  constructor(
    private readonly port: number,
    private readonly checkDatabase: () => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      if (request.url !== '/health') {
        response.writeHead(404).end();
        return;
      }
      void this.respond(response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, '0.0.0.0', resolve);
    });
    this.logger.info({ port: this.port }, 'Health server started');
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async respond(response: ServerResponse): Promise<void> {
    try {
      await this.checkDatabase();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'unavailable' }));
    }
  }
}
