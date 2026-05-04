import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { openApiSpec } from './docs/openapi.js';
import {
  authMiddleware,
  errorMiddleware,
  notFoundMiddleware,
} from './http/middleware.js';
import { deviceRouter } from './modules/devices/device.routes.js';
import { menuRouter } from './modules/menu/menu.routes.js';
import { orderRouter } from './modules/orders/order.routes.js';
import { syncRouter } from './modules/sync/sync.routes.js';
import { connectedClientCount } from './realtime/hub.js';

export function createApp() {
  const app = express();

  app.get('/openapi.json', (_request, response) => {
    response.json(openApiSpec);
  });
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      explorer: true,
      customSiteTitle: 'Hybrid POS API Docs',
      swaggerOptions: {
        persistAuthorization: true,
      },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
      credentials: env.corsOrigin !== '*',
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(authMiddleware);

  app.get('/health', async (_request, response) => {
    const startedAt = Date.now();
    try {
      await pool.query('SELECT 1');
      response.json({
        ok: true,
        server: 'hybrid-pos-cloud',
        mode: 'cloud',
        database: true,
        wsPath: '/ws/admin',
        connectedWsClients: connectedClientCount(),
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      response.status(503).json({
        ok: false,
        server: 'hybrid-pos-cloud',
        mode: 'cloud',
        database: false,
        error: error instanceof Error ? error.message : 'Database unavailable.',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use('/devices', deviceRouter);
  app.use('/outlets/:outletId/menu', menuRouter);
  app.use('/outlets/:outletId/orders', orderRouter);
  app.use('/outlets/:outletId/sync', syncRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
