import { toIso } from '../../shared/time.js';

export function mapMenuRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: Number(row.price),
    imageUrl: row.image_url,
    isAvailable: row.is_available,
    preparationTimeMinutes: row.preparation_time_minutes,
    tags: row.tags ?? [],
    syncStatus: row.sync_status,
    version: row.version,
    deletedAt: toIso(row.deleted_at),
    createdAt: toIso(row.app_created_at) ?? toIso(row.created_at),
    updatedAt: toIso(row.app_updated_at) ?? toIso(row.updated_at),
  };
}
