import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../../db/pool.js';
import { broadcast } from '../../realtime/hub.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { requiredParam } from '../../shared/params.js';
import { parseOptionalDate } from '../../shared/time.js';
import { mapMenuRow } from '../menu/menu.mapper.js';
import { softDeleteMenuItem, upsertMenuItem } from '../menu/menu.service.js';
import { mapOrderRow } from '../orders/order.mapper.js';
import { updateOrderStatus, upsertOrder } from '../orders/order.service.js';
import { withIdempotency } from './idempotency.service.js';

const syncEventSchema = z.object({
  id: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  payloadJson: z.string().optional(),
  status: z.string().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  lastError: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
});

const pushSchema = z.union([
  z.object({ events: z.array(syncEventSchema) }),
  syncEventSchema,
]);

export const syncRouter = Router({ mergeParams: true });

syncRouter.get(
  '/pull',
  asyncHandler(async (request, response) => {
    const outletId = requiredParam(request.params.outletId, 'outletId');
    const since = parseOptionalDate(request.query.since);
    const [menu, orders] = await Promise.all([
      pullMenu(outletId, since),
      pullOrders(outletId, since),
    ]);
    response.json({
      ok: true,
      data: {
        menu,
        orders,
        timestamp: new Date().toISOString(),
      },
    });
  }),
);

syncRouter.post(
  '/push',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const outletId = requiredParam(request.params.outletId, 'outletId');
      const parsed = pushSchema.parse(request.body);
      const events = 'events' in parsed ? parsed.events : [parsed];
      const results = [];
      for (const event of events) {
        results.push(await applySyncEvent(outletId, event));
      }
      return {
        statusCode: 200,
        body: { ok: true, count: results.length, data: results },
      };
    });
  }),
);

async function applySyncEvent(
  outletId: string,
  event: z.infer<typeof syncEventSchema>,
) {
  const payload = readPayload(event);
  await pool.query(
    `
      INSERT INTO sync_events (
        id,
        outlet_id,
        entity_type,
        entity_id,
        action,
        payload,
        status,
        retry_count,
        last_error,
        app_created_at,
        app_updated_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, now())
      ON CONFLICT (id)
      DO UPDATE SET
        status = EXCLUDED.status,
        retry_count = EXCLUDED.retry_count,
        last_error = EXCLUDED.last_error,
        app_updated_at = EXCLUDED.app_updated_at,
        updated_at = now()
    `,
    [
      event.id,
      outletId,
      event.entityType,
      event.entityId,
      event.action,
      JSON.stringify(payload),
      event.status ?? 'synced',
      event.retryCount ?? 0,
      event.lastError ?? null,
      event.createdAt ?? null,
      event.updatedAt ?? null,
    ],
  );

  if (event.entityType === 'menu_item') {
    if (event.action === 'delete') {
      const item = await softDeleteMenuItem(pool, outletId, event.entityId);
      broadcast({ type: 'menu_updated', data: item });
      return { eventId: event.id, entityType: event.entityType, data: item };
    }
    const item = await upsertMenuItem(pool, outletId, payload as never);
    broadcast({ type: 'menu_updated', data: item });
    return { eventId: event.id, entityType: event.entityType, data: item };
  }

  if (event.entityType === 'order') {
    const order = await upsertOrder(outletId, payload as never);
    broadcast({ type: 'order_created', data: order });
    return { eventId: event.id, entityType: event.entityType, data: order };
  }

  if (event.entityType === 'order_status') {
    const status = String(payload.status ?? '');
    const order = await updateOrderStatus(outletId, event.entityId, status);
    broadcast({ type: 'order_status_updated', data: order });
    return { eventId: event.id, entityType: event.entityType, data: order };
  }

  return { eventId: event.id, entityType: event.entityType, skipped: true };
}

async function pullMenu(outletId: string, since: Date | null) {
  const values: unknown[] = [outletId];
  const where = ['outlet_id = $1'];
  if (since) {
    values.push(since);
    where.push(`updated_at >= $${values.length}`);
  }
  const result = await pool.query(
    `SELECT * FROM menu_items WHERE ${where.join(' AND ')} ORDER BY updated_at ASC`,
    values,
  );
  return result.rows.map(mapMenuRow);
}

async function pullOrders(outletId: string, since: Date | null) {
  const values: unknown[] = [outletId];
  const where = ['outlet_id = $1'];
  if (since) {
    values.push(since);
    where.push(`updated_at >= $${values.length}`);
  }
  const orderRows = await pool.query(
    `SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY updated_at ASC`,
    values,
  );
  const orders = [];
  for (const row of orderRows.rows) {
    const items = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY name ASC',
      [row.id],
    );
    orders.push(mapOrderRow(row, items.rows));
  }
  return orders;
}

function readPayload(event: z.infer<typeof syncEventSchema>) {
  if (event.payload) return event.payload;
  if (event.payloadJson) {
    const decoded = JSON.parse(event.payloadJson);
    if (decoded && typeof decoded === 'object') return decoded;
  }
  return {};
}
