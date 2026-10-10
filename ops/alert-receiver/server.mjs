import { appendFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';

await mkdir('/data', { recursive: true });
createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/alerts') {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024) {
        response.writeHead(413).end();
        return;
      }
    }
    const notification = JSON.parse(body);
    await appendFile(
      '/data/notifications.jsonl',
      `${JSON.stringify({ receivedAt: new Date().toISOString(), notification })}\n`,
      { mode: 0o600 },
    );
    response.writeHead(200).end('retained');
  } catch {
    response.writeHead(500).end('Notification could not be retained');
  }
}).listen(8081, '0.0.0.0');
