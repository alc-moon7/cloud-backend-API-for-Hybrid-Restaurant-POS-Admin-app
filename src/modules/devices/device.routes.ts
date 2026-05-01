import { Router } from 'express';
import { z } from 'zod';

import { pool, withTransaction } from '../../db/pool.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { broadcast } from '../../realtime/hub.js';
import { heartbeatDevice, registerDevice } from './device.service.js';
import { withIdempotency } from '../sync/idempotency.service.js';

const registerSchema = z.object({
  serverId: z.string().min(1),
  restaurantId: z.string().min(1),
  outletId: z.string().min(1),
  restaurantName: z.string().min(1),
  outletName: z.string().min(1),
});

const heartbeatSchema = z.object({
  serverId: z.string().min(1),
  restaurantId: z.string().min(1),
  outletId: z.string().min(1),
  localIp: z.string().optional().nullable(),
  port: z.number().int().positive().optional().nullable(),
  localServerRunning: z.boolean().optional().nullable(),
  timestamp: z.string().optional(),
});

export const deviceRouter = Router();

deviceRouter.post(
  '/register',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const body = registerSchema.parse(request.body);
      const device = await withTransaction((client) => registerDevice(client, body));
      broadcast({ type: 'device_registered', data: device });
      return {
        statusCode: 200,
        body: { ok: true, data: device },
      };
    });
  }),
);

deviceRouter.post(
  '/heartbeat',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const body = heartbeatSchema.parse(request.body);
      const device = await heartbeatDevice(pool, body);
      broadcast({ type: 'device_heartbeat', data: device });
      return {
        statusCode: 200,
        body: { ok: true, data: device },
      };
    });
  }),
);
