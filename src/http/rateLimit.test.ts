import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import express from 'express';

import { createRateLimit } from './rateLimit.js';

let baseUrl = '';
let server: Server | null = null;

before(async () => {
  const app = express();

  app.use(
    createRateLimit({
      keyGenerator: () => 'same-client',
      keyPrefix: `test:${randomUUID()}`,
      maxRequests: 2,
      windowMs: 60 * 1000,
    }),
  );
  app.get('/limited', (_request, response) => {
    response.json({ ok: true });
  });

  server = createServer(app);

  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();

  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');

  baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});

test('rate limiter returns 429 with retry metadata after the quota is exhausted', async () => {
  const firstResponse = await fetch(`${baseUrl}/limited`);
  const secondResponse = await fetch(`${baseUrl}/limited`);
  const thirdResponse = await fetch(`${baseUrl}/limited`);
  const body = (await thirdResponse.json()) as { error?: { code?: string } };

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(thirdResponse.status, 429);
  assert.equal(thirdResponse.headers.has('retry-after'), true);
  assert.equal(body.error?.code, 'RATE_LIMITED');
});
