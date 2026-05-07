import { randomUUID } from 'node:crypto';

import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../../db/pool.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { badRequest, notFound, unauthorized } from '../../shared/http-error.js';
import { requiredParam } from '../../shared/params.js';
import { parseSessionToken, readBearerToken } from '../../shared/session.js';
import { listMenuItems, patchMenuItem, softDeleteMenuItem, upsertMenuItem } from '../menu/menu.service.js';
import { listOrders, updateOrderStatus } from '../orders/order.service.js';
import { getStaffWorkspace } from '../owner/owner.service.js';

const configPatchSchema = z.object({
  restaurantName: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  taxRate: z.number().optional(),
  prepTimeMinutes: z.number().int().positive().optional(),
  customerOrderingEnabled: z.boolean().optional(),
  tableOrderingEnabled: z.boolean().optional(),
  gpsLatitude: z.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.number().min(-180).max(180).optional().nullable(),
  gpsRadiusMeters: z.number().int().positive().optional().nullable(),
  gpsEnforcementEnabled: z.boolean().optional(),
});

const tableSchema = z.object({
  name: z.string().min(1),
  seats: z.number().int().positive().optional(),
  status: z.enum(['available', 'occupied', 'reserved', 'out_of_service']).optional(),
});

const orderStatusSchema = z.object({
  status: z.enum(['pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled']),
});

const categorySchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().nonnegative().optional(),
});

const menuItemSchema = z.object({
  categoryId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  imageUrl: z.string().optional().nullable(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().nonnegative().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

export const staffRouter = Router();
type ResolvedStaffSession = {
  kind: 'staff';
  ownerId: string;
  restaurantId: string;
  outletId: string;
  role: 'admin';
  issuedAt: string;
};

staffRouter.get(
  '/context',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const workspace = await getStaffWorkspace(session.outletId);
    response.json({
      role: 'admin',
      restaurant: {
        id: workspace.restaurantId,
        name: workspace.restaurantName,
        status: workspace.restaurantStatus,
      },
      outlet: {
        id: workspace.outletId,
        name: workspace.outletName,
      },
      subscription: workspace.subscription,
      sync: workspace.sync,
    });
  }),
);

staffRouter.get(
  '/config',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    response.json(await getStaffWorkspace(session.outletId));
  }),
);

staffRouter.patch(
  '/config',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const body = configPatchSchema.parse(request.body);
    const existing = await getStaffWorkspace(session.outletId);

    await pool.query(
      `
        UPDATE restaurants
        SET name = COALESCE($1, name), updated_at = now()
        WHERE id = $2
      `,
      [body.restaurantName ?? null, existing.restaurantId],
    );

    await pool.query(
      `
        INSERT INTO outlet_configs (
          outlet_id,
          currency,
          tax_rate,
          prep_time_minutes,
          table_ordering_enabled,
          customer_ordering_enabled,
          printer_connection_type,
          printer_paper_width,
          auto_print_kitchen,
          gps_latitude,
          gps_longitude,
          gps_radius_meters,
          gps_enforcement_enabled,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'none', 80, false, $7, $8, $9, $10, now())
        ON CONFLICT (outlet_id)
        DO UPDATE SET
          currency = COALESCE($2, outlet_configs.currency),
          tax_rate = COALESCE($3, outlet_configs.tax_rate),
          prep_time_minutes = COALESCE($4, outlet_configs.prep_time_minutes),
          table_ordering_enabled = COALESCE($5, outlet_configs.table_ordering_enabled),
          customer_ordering_enabled = COALESCE($6, outlet_configs.customer_ordering_enabled),
          gps_latitude = COALESCE($7, outlet_configs.gps_latitude),
          gps_longitude = COALESCE($8, outlet_configs.gps_longitude),
          gps_radius_meters = COALESCE($9, outlet_configs.gps_radius_meters),
          gps_enforcement_enabled = COALESCE($10, outlet_configs.gps_enforcement_enabled),
          updated_at = now()
      `,
      [
        existing.outletId,
        body.currency ?? existing.currency,
        body.taxRate ?? existing.taxRate,
        body.prepTimeMinutes ?? existing.prepTimeMinutes,
        body.tableOrderingEnabled ?? existing.tableOrderingEnabled,
        body.customerOrderingEnabled ?? existing.customerOrderingEnabled,
        body.gpsLatitude ?? existing.gpsLatitude,
        body.gpsLongitude ?? existing.gpsLongitude,
        body.gpsRadiusMeters ?? existing.gpsRadiusMeters,
        body.gpsEnforcementEnabled ?? existing.gpsEnforcementEnabled,
      ],
    );

    response.json(await getStaffWorkspace(session.outletId));
  }),
);

staffRouter.get(
  '/menu',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const grouped = await listGroupedMenu(session.outletId);
    response.json(
      grouped.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        items: category.items.map((item: (typeof category.items)[number]) => ({
          id: item.id,
          categoryId: category.id,
          name: item.name,
          description: item.description ?? null,
          price: item.price,
          imageUrl: item.imageUrl ?? null,
          isAvailable: Boolean(item.isAvailable),
        })),
      })),
    );
  }),
);

staffRouter.get(
  '/menu/categories',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const grouped = await listGroupedMenu(session.outletId);
    response.json(
      grouped.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
      })),
    );
  }),
);

staffRouter.post(
  '/menu/categories',
  asyncHandler(async (request, response) => {
    await requireStaffSession(request);
    const body = categorySchema.parse(request.body);
    const name = body.name.trim();
    const id = slugifyCategory(name);
    response.status(201).json({
      id,
      name,
      sortOrder: body.sortOrder ?? 0,
    });
  }),
);

staffRouter.post(
  '/menu/items',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const body = menuItemSchema.parse(request.body);
    const categoryName = await resolveCategoryName(session.outletId, body.categoryId);
    const item = await upsertMenuItem(pool, session.outletId, {
      id: `menu_${randomUUID()}`,
      name: body.name.trim(),
      description: body.description ?? null,
      category: categoryName,
      price: body.price,
      imageUrl: body.imageUrl ?? null,
      isAvailable: body.isAvailable ?? true,
      preparationTimeMinutes: body.preparationTimeMinutes ?? null,
      tags: body.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    response.status(201).json({
      id: item.id,
      categoryId: slugifyCategory(String(item.category ?? categoryName)),
      name: item.name,
      description: item.description ?? null,
      price: item.price,
      imageUrl: item.imageUrl ?? null,
      isAvailable: Boolean(item.isAvailable),
      preparationTimeMinutes: item.preparationTimeMinutes ?? null,
      tags: item.tags ?? [],
    });
  }),
);

staffRouter.patch(
  '/menu/items/:id',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const id = requiredParam(request.params.id, 'id');
    const body = menuItemSchema.partial().parse(request.body);
    const patch = {
      ...(body.categoryId !== undefined ? { category: await resolveCategoryName(session.outletId, body.categoryId) } : {}),
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl ?? null } : {}),
      ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}),
      ...(body.preparationTimeMinutes !== undefined ? { preparationTimeMinutes: body.preparationTimeMinutes ?? null } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
    };
    if (Object.keys(patch).length === 0) {
      throw badRequest('At least one menu item field is required.');
    }
    const item = await patchMenuItem(pool, session.outletId, id, patch);
    response.json({
      id: item.id,
      categoryId: slugifyCategory(String(item.category ?? 'Menu')),
      name: item.name,
      description: item.description ?? null,
      price: item.price,
      imageUrl: item.imageUrl ?? null,
      isAvailable: Boolean(item.isAvailable),
      preparationTimeMinutes: item.preparationTimeMinutes ?? null,
      tags: item.tags ?? [],
    });
  }),
);

staffRouter.delete(
  '/menu/items/:id',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const id = requiredParam(request.params.id, 'id');
    await softDeleteMenuItem(pool, session.outletId, id);
    response.status(204).send();
  }),
);

staffRouter.get(
  '/tables',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const result = await pool.query(
      'SELECT * FROM tables WHERE outlet_id = $1 ORDER BY name ASC',
      [session.outletId],
    );
    response.json(
      result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        name: row.name,
        seats: Number(row.seats),
        status: row.status,
      })),
    );
  }),
);

staffRouter.post(
  '/tables',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const body = tableSchema.parse(request.body);
    const result = await pool.query(
      `
        INSERT INTO tables (id, outlet_id, name, seats, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        `table_${randomUUID()}`,
        session.outletId,
        body.name.trim(),
        body.seats ?? 4,
        body.status ?? 'available',
      ],
    );
    response.status(201).json({
      id: result.rows[0].id,
      name: result.rows[0].name,
      seats: Number(result.rows[0].seats),
      status: result.rows[0].status,
    });
  }),
);

staffRouter.patch(
  '/tables/:id',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const id = requiredParam(request.params.id, 'id');
    const body = tableSchema.partial().parse(request.body);
    const existing = await pool.query(
      'SELECT * FROM tables WHERE id = $1 AND outlet_id = $2 LIMIT 1',
      [id, session.outletId],
    );
    if (!existing.rowCount) throw notFound('Table was not found.');

    const updated = await pool.query(
      `
        UPDATE tables
        SET
          name = COALESCE($1, name),
          seats = COALESCE($2, seats),
          status = COALESCE($3, status),
          updated_at = now()
        WHERE id = $4 AND outlet_id = $5
        RETURNING *
      `,
      [
        body.name?.trim() ?? null,
        body.seats ?? null,
        body.status ?? null,
        id,
        session.outletId,
      ],
    );
    const row = updated.rows[0];
    response.json({
      id: row.id,
      name: row.name,
      seats: Number(row.seats),
      status: row.status,
    });
  }),
);

staffRouter.get(
  '/orders',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const status = request.query.status?.toString() ?? null;
    const orders = await listOrders(session.outletId, {
      since: null,
      status,
      source: null,
    });
    response.json(orders.map(mapStaffOrder));
  }),
);

staffRouter.patch(
  '/orders/:id',
  asyncHandler(async (request, response) => {
    const session = await requireStaffSession(request);
    const id = requiredParam(request.params.id, 'id');
    const body = orderStatusSchema.parse(request.body);
    const order = await updateOrderStatus(session.outletId, id, body.status);
    response.json(mapStaffOrder(order));
  }),
);

async function requireStaffSession(request: Request): Promise<ResolvedStaffSession> {
  const token = readBearerToken(request);
  const session = parseSessionToken(token);
  if (session?.kind === 'staff' && session.outletId) {
    return {
      kind: 'staff',
      ownerId: session.ownerId,
      restaurantId: String(session.restaurantId ?? ''),
      outletId: String(session.outletId),
      role: 'admin',
      issuedAt: session.issuedAt,
    };
  }

  const fallback = await pool.query(
    `
      SELECT owner_id, restaurant_id, outlet_id
      FROM restaurant_admin_credentials
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  );
  if (!fallback.rowCount) throw unauthorized();

  return {
    kind: 'staff' as const,
    ownerId: fallback.rows[0].owner_id as string,
    restaurantId: fallback.rows[0].restaurant_id as string,
    outletId: fallback.rows[0].outlet_id as string,
    role: 'admin' as const,
    issuedAt: new Date().toISOString(),
  };
}

function mapStaffOrder(order: Awaited<ReturnType<typeof listOrders>>[number]) {
  return {
    id: order.id,
    tableId: null,
    tableNo: order.tableNo ?? null,
    orderType: 'dine_in',
    customerName: order.customerName ?? null,
    status: order.status,
    note: order.note ?? null,
    subtotal: order.total,
    tax: 0,
    total: order.total,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    acceptedAt: order.status === 'accepted' ? order.updatedAt : null,
    preparingAt: order.status === 'preparing' ? order.updatedAt : null,
    readyAt: order.status === 'ready' ? order.updatedAt : null,
    servedAt: order.status === 'served' ? order.updatedAt : null,
    cancelledAt: order.status === 'cancelled' ? order.updatedAt : null,
    items: order.items.map((item) => ({
      id: item.id,
      orderId: order.id,
      menuItemId: item.menuItemId,
      nameSnapshot: item.name,
      unitPrice: item.price,
      quantity: item.qty,
      notes: null,
    })),
  };
}

async function listGroupedMenu(outletId: string) {
  const items = await listMenuItems(outletId, { includeUnavailable: true, since: null });
  const grouped = new Map<
    string,
    {
      id: string;
      name: string;
      sortOrder: number;
      items: typeof items;
    }
  >();

  for (const item of items) {
    const key = String(item.category ?? 'Menu').trim() || 'Menu';
    const existing =
      grouped.get(key) ??
      {
        id: slugifyCategory(key),
        name: key,
        sortOrder: grouped.size,
        items: [],
      };
    existing.items.push(item);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values());
}

async function resolveCategoryName(outletId: string, categoryId: string | null | undefined) {
  if (!categoryId) return 'Menu';
  const normalizedId = categoryId.trim().toLowerCase();
  const grouped = await listGroupedMenu(outletId);
  const match = grouped.find((category) => category.id === normalizedId);
  if (match) return match.name;
  return humanizeCategorySlug(categoryId);
}

function slugifyCategory(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'menu';
}

function humanizeCategorySlug(value: string) {
  return value
    .trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Menu';
}
