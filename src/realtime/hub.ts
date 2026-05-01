import type { Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

type RealtimeEvent = {
  type: string;
  data: unknown;
};

const clients = new Set<WebSocket>();

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.split('?')[0] !== '/ws/admin') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      clients.add(client);
      client.on('close', () => clients.delete(client));
      client.on('error', () => clients.delete(client));
      client.send(
        JSON.stringify({
          type: 'connected',
          data: { connectedClients: clients.size },
          sentAt: new Date().toISOString(),
        }),
      );
    });
  });

  return wss;
}

export function broadcast(event: RealtimeEvent) {
  const payload = JSON.stringify({
    ...event,
    sentAt: new Date().toISOString(),
  });

  for (const client of [...clients]) {
    if (client.readyState !== client.OPEN) {
      clients.delete(client);
      continue;
    }
    client.send(payload);
  }
}

export function connectedClientCount() {
  return clients.size;
}
