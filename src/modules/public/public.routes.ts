import { Router } from 'express';

import { pool } from '../../db/pool.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { notFound } from '../../shared/http-error.js';
import { requiredParam } from '../../shared/params.js';

export const publicRouter = Router({ mergeParams: true });

publicRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const outletId = requiredParam(request.params.outletId, 'outletId');
    const result = await pool.query(
      `
        SELECT
          out.id AS outlet_id,
          out.name AS outlet_name,
          r.id AS restaurant_id,
          r.name AS restaurant_name,
          cfg.currency,
          cfg.tax_rate,
          cfg.prep_time_minutes,
          cfg.gps_latitude,
          cfg.gps_longitude,
          cfg.gps_radius_meters,
          cfg.gps_enforcement_enabled
        FROM outlets out
        JOIN restaurants r ON r.id = out.restaurant_id
        LEFT JOIN outlet_configs cfg ON cfg.outlet_id = out.id
        WHERE out.id = $1
        LIMIT 1
      `,
      [outletId],
    );

    if (!result.rowCount) throw notFound('Outlet was not found.');
    const row = result.rows[0];
    const gpsEnforcementEnabled = Boolean(row.gps_enforcement_enabled ?? false);
    const gpsLatitude = row.gps_latitude == null ? null : Number(row.gps_latitude);
    const gpsLongitude = row.gps_longitude == null ? null : Number(row.gps_longitude);
    const gpsRadiusMeters = row.gps_radius_meters == null ? null : Number(row.gps_radius_meters);
    const gpsConfigured =
      gpsEnforcementEnabled &&
      gpsLatitude != null &&
      gpsLongitude != null &&
      gpsRadiusMeters != null &&
      gpsRadiusMeters > 0;

    response.json({
      ok: true,
      data: {
        restaurant: {
          id: row.restaurant_id,
          name: row.restaurant_name,
        },
        outlet: {
          id: row.outlet_id,
          name: row.outlet_name,
          currency: row.currency ?? 'BDT',
          taxRate: Number(row.tax_rate ?? 0),
          prepTimeMinutes: Number(row.prep_time_minutes ?? 20),
        },
        geofence: {
          gpsEnforcementEnabled,
          gpsConfigured,
          gpsLatitude,
          gpsLongitude,
          gpsRadiusMeters,
        },
      },
    });
  }),
);
