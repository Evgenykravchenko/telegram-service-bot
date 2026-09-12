const port = process.env.HEALTH_PORT ?? '8090';
const response = await fetch(`http://127.0.0.1:${port}/health`, {
  signal: AbortSignal.timeout(3000),
}).catch(() => null);

if (!response?.ok) process.exit(1);
