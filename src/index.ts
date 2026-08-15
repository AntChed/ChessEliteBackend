import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabasePool } from './db/pool.js';
import { logInfo } from './logging/logger.js';
import { attachWebSocketServer } from './ws/websocketServer.js';

const app = createApp();
const server = createServer(app);
const webSocketServer = attachWebSocketServer(server);

server.listen(env.port, () => {
  logInfo('SERVER_STARTED', {
    port: env.port,
  });
});

async function shutdown(signal: NodeJS.Signals) {
  logInfo('SERVER_STOPPING', {
    signal,
  });

  webSocketServer.close();
  server.close(async () => {
    await closeDatabasePool();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
