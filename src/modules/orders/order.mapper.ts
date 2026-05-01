import { toIso } from '../../shared/time.js';

export function mapOrderItemRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    orderId: row.order_id,
    menuItemId: row.menu_item_id,
    name: row.name,
    qty: Number(row.qty),
    price: Number(row.price),
    lineTotal: Number(row.line_total),
  };
}

export function mapOrderRow(
  row: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
) {
  return {
    id: row.id,
    orderNo: row.order_no,
    source: row.source,
    customerName: row.customer_name,
    tableNo: row.table_no,
    note: row.note,
    status: row.status,
    total: Number(row.total),
    items: items.map(mapOrderItemRow),
    syncStatus: row.sync_status,
    version: row.version,
    createdAt: toIso(row.app_created_at) ?? toIso(row.created_at),
    updatedAt: toIso(row.app_updated_at) ?? toIso(row.updated_at),
  };
}
