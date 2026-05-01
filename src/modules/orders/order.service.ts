import { randomUUID } from 'node:crypto';

import type { DbClient } from '../../db/pool.js';
import { pool, withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../shared/http-error.js';
import { canTransitionOrderStatus } from './order-status.js';
import { mapOrderRow } from './order.mapper.js';

export type OrderInputItem = {
  id?: string;
  orderId?: string;
  menuItemId: string;
  name?: string;
  qty: number;
  price?: number;
  lineTotal?: number;
};

export type OrderInput = {
  id?: string;
  orderNo?: string;
  source?: string;
  customerName?: string | null;
  tableNo?: string | null;
  note?: string | null;
  status?: string;
  total?: number;
  items: OrderInputItem[];
  syncStatus?: string;
  version?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export async function listOrders(
  outletId: string,
  options: { since?: Date | null; status?: string | null; source?: string | null },
) {
  const where = ['outlet_id = $1'];
  const values: unknown[] = [outletId];
  if (options.since) {
    values.push(options.since);
    where.push(`updated_at >= $${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    where.push(`status = $${values.length}`);
  }
  if (options.source) {
    values.push(options.source);
    where.push(`source = $${values.length}`);
  }

  const result = await pool.query(
    `
      SELECT *
      FROM orders
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
    `,
    values,
  );
  return hydrateOrders(result.rows);
}

export async function upsertOrder(outletId: string, input: OrderInput) {
  if (!input.items.length) throw badRequest('Order must include at least one item.');

  return withTransaction(async (client) => {
    const orderId = input.id ?? randomUUID();
    const existing = await client.query('SELECT * FROM orders WHERE id = $1', [
      orderId,
    ]);
    if (existing.rowCount) {
      const items = await getOrderItemRows(client, orderId);
      return mapOrderRow(existing.rows[0], items);
    }

    const preparedItems = await prepareOrderItems(client, orderId, input.items);
    const total = preparedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const orderNo = input.orderNo ?? buildOrderNo();
    const status = input.status ?? 'pending';
    const result = await client.query(
      `
        INSERT INTO orders (
          id,
          outlet_id,
          order_no,
          source,
          customer_name,
          table_no,
          note,
          status,
          total,
          sync_status,
          version,
          app_created_at,
          app_updated_at,
          raw_payload,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14::jsonb, now()
        )
        RETURNING *
      `,
      [
        orderId,
        outletId,
        orderNo,
        input.source ?? 'cloud',
        clean(input.customerName),
        clean(input.tableNo),
        clean(input.note),
        status,
        input.total ?? total,
        input.syncStatus ?? 'synced',
        input.version ?? 1,
        input.createdAt ?? null,
        input.updatedAt ?? null,
        JSON.stringify(input),
      ],
    );

    for (const item of preparedItems) {
      await client.query(
        `
          INSERT INTO order_items (
            id,
            order_id,
            menu_item_id,
            name,
            qty,
            price,
            line_total
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          item.id,
          orderId,
          item.menuItemId,
          item.name,
          item.qty,
          item.price,
          item.lineTotal,
        ],
      );
    }

    return mapOrderRow(result.rows[0], preparedItems.map(itemToRow));
  });
}

export async function updateOrderStatus(
  outletId: string,
  id: string,
  status: string,
) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND outlet_id = $2 LIMIT 1',
      [id, outletId],
    );
    if (!existing.rowCount) throw notFound('Order was not found.');

    const current = existing.rows[0].status as string;
    if (!canTransitionOrderStatus(current, status)) {
      throw badRequest(`Cannot change ${current} order to ${status}.`);
    }

    const result = await client.query(
      `
        UPDATE orders
        SET status = $1, version = version + 1, updated_at = now(), app_updated_at = now()
        WHERE id = $2 AND outlet_id = $3
        RETURNING *
      `,
      [status, id, outletId],
    );
    const items = await getOrderItemRows(client, id);
    return mapOrderRow(result.rows[0], items);
  });
}

async function hydrateOrders(rows: Array<Record<string, unknown>>) {
  const orders = [];
  for (const row of rows) {
    const items = await getOrderItemRows(pool, row.id as string);
    orders.push(mapOrderRow(row, items));
  }
  return orders;
}

async function prepareOrderItems(
  db: DbClient,
  orderId: string,
  items: OrderInputItem[],
) {
  const prepared = [];
  for (const item of items) {
    if (item.qty <= 0) throw badRequest('Item quantity must be greater than zero.');

    if (item.name && item.price != null) {
      const lineTotal = item.lineTotal ?? item.price * item.qty;
      prepared.push({
        id: item.id ?? randomUUID(),
        orderId,
        menuItemId: item.menuItemId,
        name: item.name,
        qty: item.qty,
        price: item.price,
        lineTotal,
      });
      continue;
    }

    const menu = await db.query(
      `
        SELECT *
        FROM menu_items
        WHERE id = $1 AND deleted_at IS NULL AND is_available = true
        LIMIT 1
      `,
      [item.menuItemId],
    );
    if (!menu.rowCount) {
      throw badRequest(`Menu item ${item.menuItemId} is not available.`);
    }
    const menuItem = menu.rows[0];
    const price = Number(menuItem.price);
    prepared.push({
      id: item.id ?? randomUUID(),
      orderId,
      menuItemId: item.menuItemId,
      name: menuItem.name as string,
      qty: item.qty,
      price,
      lineTotal: price * item.qty,
    });
  }
  return prepared;
}

async function getOrderItemRows(db: DbClient, orderId: string) {
  const result = await db.query(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY name ASC',
    [orderId],
  );
  return result.rows;
}

function itemToRow(item: {
  id: string;
  orderId: string;
  menuItemId: string;
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
}) {
  return {
    id: item.id,
    order_id: item.orderId,
    menu_item_id: item.menuItemId,
    name: item.name,
    qty: item.qty,
    price: item.price,
    line_total: item.lineTotal,
  };
}

function buildOrderNo() {
  const stamp = new Date()
    .toISOString()
    .replace(/\D/g, '')
    .slice(2, 14);
  return `ORD-${stamp}-${randomUUID().split('-')[0].toUpperCase()}`;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
