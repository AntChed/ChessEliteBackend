import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';

import { serializeServerMessage } from './messages.js';

export function attachWebSocketServer(server: Server) {
  const webSocketServer = new WebSocketServer({
    path: '/ws',
    server,
  });

  webSocketServer.on('connection', (socket) => {
    socket.on('message', (rawMessage) => {
      let parsedMessage: unknown;

      try {
        parsedMessage = JSON.parse(rawMessage.toString());
      } catch {
        socket.send(
          serializeServerMessage({
            error: {
              code: 'INVALID_MESSAGE',
              message: 'Message must be valid JSON',
            },
            type: 'ERROR',
          }),
        );
        return;
      }

      if (
        parsedMessage &&
        typeof parsedMessage === 'object' &&
        'type' in parsedMessage &&
        parsedMessage.type === 'PING'
      ) {
        socket.send(serializeServerMessage({ type: 'PONG' }));
        return;
      }

      socket.send(
        serializeServerMessage({
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Online multiplayer WebSocket protocol is not implemented yet',
          },
          type: 'ERROR',
        }),
      );
    });
  });

  return webSocketServer;
}

