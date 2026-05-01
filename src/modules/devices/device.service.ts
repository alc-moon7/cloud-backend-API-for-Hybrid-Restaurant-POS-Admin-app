import type { DbClient } from '../../db/pool.js';

type DeviceRegistration = {
  serverId: string;
  restaurantId: string;
  outletId: string;
  restaurantName: string;
  outletName: string;
};

type DeviceHeartbeat = {
  serverId: string;
  restaurantId: string;
  outletId: string;
  localIp?: string | null;
  port?: number | null;
  localServerRunning?: boolean | null;
};

export async function ensureRestaurantOutlet(
  db: DbClient,
  input: {
    restaurantId: string;
    outletId: string;
    restaurantName?: string;
    outletName?: string;
  },
) {
  await db.query(
    `
      INSERT INTO restaurants (id, name, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `,
    [input.restaurantId, input.restaurantName ?? input.restaurantId],
  );

  await db.query(
    `
      INSERT INTO outlets (id, restaurant_id, name, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (id)
      DO UPDATE SET
        restaurant_id = EXCLUDED.restaurant_id,
        name = EXCLUDED.name,
        updated_at = now()
    `,
    [input.outletId, input.restaurantId, input.outletName ?? input.outletId],
  );
}

export async function registerDevice(db: DbClient, input: DeviceRegistration) {
  await ensureRestaurantOutlet(db, input);
  const result = await db.query(
    `
      INSERT INTO devices (
        id,
        restaurant_id,
        outlet_id,
        restaurant_name,
        outlet_name,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (id)
      DO UPDATE SET
        restaurant_id = EXCLUDED.restaurant_id,
        outlet_id = EXCLUDED.outlet_id,
        restaurant_name = EXCLUDED.restaurant_name,
        outlet_name = EXCLUDED.outlet_name,
        updated_at = now()
      RETURNING *
    `,
    [
      input.serverId,
      input.restaurantId,
      input.outletId,
      input.restaurantName,
      input.outletName,
    ],
  );
  return result.rows[0];
}

export async function heartbeatDevice(db: DbClient, input: DeviceHeartbeat) {
  await ensureRestaurantOutlet(db, {
    restaurantId: input.restaurantId,
    outletId: input.outletId,
  });

  const result = await db.query(
    `
      INSERT INTO devices (
        id,
        restaurant_id,
        outlet_id,
        restaurant_name,
        outlet_name,
        local_ip,
        local_port,
        local_server_running,
        last_heartbeat_at,
        updated_at
      )
      VALUES ($1, $2, $3, $2, $3, $4, $5, $6, now(), now())
      ON CONFLICT (id)
      DO UPDATE SET
        restaurant_id = EXCLUDED.restaurant_id,
        outlet_id = EXCLUDED.outlet_id,
        local_ip = EXCLUDED.local_ip,
        local_port = EXCLUDED.local_port,
        local_server_running = EXCLUDED.local_server_running,
        last_heartbeat_at = now(),
        updated_at = now()
      RETURNING *
    `,
    [
      input.serverId,
      input.restaurantId,
      input.outletId,
      input.localIp ?? null,
      input.port ?? null,
      input.localServerRunning ?? false,
    ],
  );
  return result.rows[0];
}
