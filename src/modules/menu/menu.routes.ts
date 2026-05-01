import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../../db/pool.js';
import { broadcast } from '../../realtime/hub.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { requiredParam } from '../../shared/params.js';
import { parseOptionalDate } from '../../shared/time.js';
import { withIdempotency } from '../sync/idempotency.service.js';
import {
  listMenuItems,
  patchMenuItem,
  softDeleteMenuItem,
  upsertMenuItem,
} from './menu.service.js';

const menuSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  imageUrl: z.string().optional().nullable(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().nonnegative().optional().nullable(),
  tags: z.array(z.string()).optional(),
  syncStatus: z.string().optional(),
  version: z.number().int().positive().optional(),
  deletedAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
});

export const menuRouter = Router({ mergeParams: true });

menuRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const outletId = requiredParam(request.params.outletId, 'outletId');
    const includeUnavailable =
      request.query.includeUnavailable?.toString() === 'true';
    const since = parseOptionalDate(request.query.since);
    const items = await listMenuItems(outletId, {
      includeUnavailable,
      since,
    });
    response.json({ ok: true, count: items.length, data: items });
  }),
);

menuRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const outletId = requiredParam(request.params.outletId, 'outletId');
      const body = menuSchema.parse(request.body);
      const item = await upsertMenuItem(pool, outletId, body);
      broadcast({ type: 'menu_updated', data: item });
      return { statusCode: 200, body: { ok: true, data: item } };
    });
  }),
);

menuRouter.patch(
  '/:id',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const outletId = requiredParam(request.params.outletId, 'outletId');
      const id = requiredParam(request.params.id, 'id');
      const patch = menuSchema.partial().parse(request.body);
      const item = await patchMenuItem(
        pool,
        outletId,
        id,
        patch,
      );
      broadcast({ type: 'menu_updated', data: item });
      return { statusCode: 200, body: { ok: true, data: item } };
    });
  }),
);

menuRouter.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const outletId = requiredParam(request.params.outletId, 'outletId');
      const id = requiredParam(request.params.id, 'id');
      const item = await softDeleteMenuItem(
        pool,
        outletId,
        id,
      );
      broadcast({ type: 'menu_updated', data: item });
      return { statusCode: 200, body: { ok: true, data: item } };
    });
  }),
);
