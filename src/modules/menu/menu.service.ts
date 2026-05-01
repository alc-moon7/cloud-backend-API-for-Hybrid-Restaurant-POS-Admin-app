import type { DbClient } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { notFound } from '../../shared/http-error.js';
import { mapMenuRow } from './menu.mapper.js';

export type MenuInput = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  imageUrl?: string | null;
  isAvailable?: boolean;
  preparationTimeMinutes?: number | null;
  tags?: string[];
  syncStatus?: string;
  version?: number;
  deletedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export async function listMenuItems(
  outletId: string,
  options: { includeUnavailable?: boolean; since?: Date | null },
) {
  const where = ['outlet_id = $1', 'deleted_at IS NULL'];
  const values: unknown[] = [outletId];
  if (!options.includeUnavailable) {
    where.push('is_available = true');
  }
  if (options.since) {
    values.push(options.since);
    where.push(`updated_at >= $${values.length}`);
  }

  const result = await pool.query(
    `
      SELECT *
      FROM menu_items
      WHERE ${where.join(' AND ')}
      ORDER BY category ASC, name ASC
    `,
    values,
  );
  return result.rows.map(mapMenuRow);
}

export async function upsertMenuItem(
  db: DbClient,
  outletId: string,
  input: MenuInput,
) {
  const result = await db.query(
    `
      INSERT INTO menu_items (
        id,
        outlet_id,
        name,
        description,
        category,
        price,
        image_url,
        is_available,
        preparation_time_minutes,
        tags,
        sync_status,
        version,
        deleted_at,
        app_created_at,
        app_updated_at,
        raw_payload,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16::jsonb, now()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        outlet_id = EXCLUDED.outlet_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        price = EXCLUDED.price,
        image_url = EXCLUDED.image_url,
        is_available = EXCLUDED.is_available,
        preparation_time_minutes = EXCLUDED.preparation_time_minutes,
        tags = EXCLUDED.tags,
        sync_status = EXCLUDED.sync_status,
        version = GREATEST(menu_items.version, EXCLUDED.version),
        deleted_at = EXCLUDED.deleted_at,
        app_updated_at = EXCLUDED.app_updated_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      WHERE
        menu_items.app_updated_at IS NULL
        OR EXCLUDED.app_updated_at IS NULL
        OR EXCLUDED.app_updated_at >= menu_items.app_updated_at
      RETURNING *
    `,
    [
      input.id,
      outletId,
      input.name,
      input.description ?? '',
      input.category ?? 'General',
      input.price,
      input.imageUrl ?? null,
      input.isAvailable ?? true,
      input.preparationTimeMinutes ?? null,
      input.tags ?? [],
      input.syncStatus ?? 'synced',
      input.version ?? 1,
      input.deletedAt ?? null,
      input.createdAt ?? null,
      input.updatedAt ?? null,
      JSON.stringify(input),
    ],
  );

  if (result.rowCount) return mapMenuRow(result.rows[0]);
  const existing = await getMenuItem(input.id);
  if (!existing) throw notFound('Menu item was not found.');
  return existing;
}

export async function patchMenuItem(
  db: DbClient,
  outletId: string,
  id: string,
  patch: Partial<MenuInput>,
) {
  const existing = await db.query(
    'SELECT * FROM menu_items WHERE id = $1 AND outlet_id = $2 LIMIT 1',
    [id, outletId],
  );
  if (!existing.rowCount) throw notFound('Menu item was not found.');

  const current = mapMenuRow(existing.rows[0]) as MenuInput;
  return upsertMenuItem(db, outletId, {
    ...current,
    ...patch,
    id,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    version: Math.max(Number(current.version ?? 1), Number(patch.version ?? 1)),
  });
}

export async function softDeleteMenuItem(
  db: DbClient,
  outletId: string,
  id: string,
) {
  const result = await db.query(
    `
      UPDATE menu_items
      SET
        deleted_at = now(),
        is_available = false,
        version = version + 1,
        updated_at = now(),
        app_updated_at = now()
      WHERE id = $1 AND outlet_id = $2
      RETURNING *
    `,
    [id, outletId],
  );
  if (!result.rowCount) throw notFound('Menu item was not found.');
  return mapMenuRow(result.rows[0]);
}

async function getMenuItem(id: string) {
  const result = await pool.query('SELECT * FROM menu_items WHERE id = $1', [id]);
  if (!result.rowCount) return null;
  return mapMenuRow(result.rows[0]);
}
