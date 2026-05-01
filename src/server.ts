import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { attachRealtime } from './realtime/hub.js';

const app = createApp();
const server = createServer(app);
attachRealtime(server);

server.listen(env.port, () => {
  console.log(`Hybrid POS cloud API listening on http://localhost:${env.port}`);
  console.log(`Admin realtime WebSocket: ws://localhost:${env.port}/ws/admin`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
