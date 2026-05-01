import { Router } from 'express';
import { z } from 'zod';

import { broadcast } from '../../realtime/hub.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { requiredParam } from '../../shared/params.js';
import { parseOptionalDate } from '../../shared/time.js';
import { withIdempotency } from '../sync/idempotency.service.js';
import { orderStatuses } from './order-status.js';
import {
  getOrderById,
  listOrders,
  updateOrderStatus,
  upsertOrder,
} from './order.service.js';

const orderItemSchema = z.object({
  id: z.string().optional(),
  orderId: z.string().optional(),
  menuItemId: z.string().min(1),
  name: z.string().optional(),
  qty: z.number().int().positive(),
  price: z.number().nonnegative().optional(),
  lineTotal: z.number().nonnegative().optional(),
});

const orderSchema = z.object({
  id: z.string().optional(),
  orderNo: z.string().optional(),
  source: z.string().optional(),
  customerName: z.string().optional().nullable(),
  tableNo: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  status: z.enum(orderStatuses as [string, ...string[]]).optional(),
  total: z.number().nonnegative().optional(),
  items: z.array(orderItemSchema).min(1),
  syncStatus: z.string().optional(),
  version: z.number().int().positive().optional(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(orderStatuses as [string, ...string[]]),
  updatedAt: z.string().optional(),
});

export const orderRouter = Router({ mergeParams: true });

orderRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const outletId = requiredParam(request.params.outletId, 'outletId');
    const orders = await listOrders(outletId, {
      since: parseOptionalDate(request.query.since),
      status: request.query.status?.toString() ?? null,
      source: request.query.source?.toString() ?? null,
    });
    response.json({ ok: true, count: orders.length, data: orders });
  }),
);

orderRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const outletId = requiredParam(request.params.outletId, 'outletId');
      const body = orderSchema.parse(request.body);
      const order = await upsertOrder(outletId, body);
      broadcast({ type: 'order_created', data: order });
      return { statusCode: 201, body: { ok: true, data: order } };
    });
  }),
);

orderRouter.get(
  '/:id',
  asyncHandler(async (request, response) => {
    const outletId = requiredParam(request.params.outletId, 'outletId');
    const id = requiredParam(request.params.id, 'id');
    const order = await getOrderById(outletId, id);
    response.json({ ok: true, data: order });
  }),
);

orderRouter.patch(
  '/:id/status',
  asyncHandler(async (request, response) => {
    await withIdempotency(request, response, async () => {
      const outletId = requiredParam(request.params.outletId, 'outletId');
      const id = requiredParam(request.params.id, 'id');
      const body = statusSchema.parse(request.body);
      const order = await updateOrderStatus(
        outletId,
        id,
        body.status,
      );
      broadcast({ type: 'order_status_updated', data: order });
      return { statusCode: 200, body: { ok: true, data: order } };
    });
  }),
);
