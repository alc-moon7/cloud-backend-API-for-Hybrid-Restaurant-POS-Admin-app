import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { pool, withTransaction } from '../../db/pool.js';
import { hashSecret, verifySecret } from '../../shared/crypto.js';
import { badRequest, notFound, unauthorized } from '../../shared/http-error.js';
import { issueSessionToken } from '../../shared/session.js';

type BillingCycle = 'monthly' | 'annual';
type PaymentMethod = 'bkash' | 'nagad' | 'bank' | 'card';

const ownerPlans = [
  {
    code: 'cloud-starter',
    name: 'Cloud Starter',
    currency: 'BDT',
    monthlyPrice: 800,
    annualPrice: 8000,
    annualSavings: 1600,
    billingProvider: 'sslcommerz',
    paymentMethods: ['bkash', 'nagad', 'bank', 'card'],
  },
];

export function listOwnerPlans() {
  return ownerPlans;
}

export async function requestOwnerOtp(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  const code = createOtpCode();

  await pool.query(
    `
      INSERT INTO owner_otps (id, phone, code, expires_at)
      VALUES ($1, $2, $3, now() + interval '10 minutes')
    `,
    [randomUUID(), normalizedPhone, code],
  );

  return {
    ok: true,
    detail: 'OTP sent.',
    devOtpCode: code,
  };
}

export async function verifyOwnerOtp(phone: string, otp: string) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedOtp = String(otp ?? '').trim();
  if (!normalizedOtp) throw badRequest('OTP is required.');

  const match = await pool.query(
    `
      SELECT *
      FROM owner_otps
      WHERE phone = $1
        AND code = $2
        AND expires_at >= now()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedPhone, normalizedOtp],
  );

  if (!match.rowCount) throw badRequest('OTP verification failed.');

  await pool.query('UPDATE owner_otps SET verified_at = now() WHERE id = $1', [
    match.rows[0].id,
  ]);

  return {
    ok: true,
    verified: true,
    detail: 'Phone verified.',
  };
}

export async function createOwnerPaymentSession(input: {
  phone: string;
  planCode: string;
  billingCycle: BillingCycle;
  paymentMethod: PaymentMethod;
}) {
  const normalizedPhone = normalizePhone(input.phone);
  await ensureVerifiedPhone(normalizedPhone);
  const plan = getPlan(input.planCode);
  const amount = input.billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
  const paymentSessionId = `pay_${randomUUID()}`;

  await pool.query(
    `
      INSERT INTO owner_payment_sessions (
        id,
        phone,
        plan_code,
        plan_name,
        billing_cycle,
        payment_method,
        amount,
        currency,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
    `,
    [
      paymentSessionId,
      normalizedPhone,
      plan.code,
      plan.name,
      input.billingCycle,
      input.paymentMethod,
      amount,
      plan.currency,
    ],
  );

  return {
    paymentSessionId,
    amount,
    currency: plan.currency,
    status: 'pending',
  };
}

export async function confirmOwnerPayment(input: {
  paymentSessionId: string;
  status: string;
}) {
  const paymentSessionId = String(input.paymentSessionId ?? '').trim();
  if (!paymentSessionId) throw badRequest('paymentSessionId is required.');

  const normalizedStatus = String(input.status ?? '').trim() || 'failed';
  const result = await pool.query(
    `
      UPDATE owner_payment_sessions
      SET status = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `,
    [normalizedStatus, paymentSessionId],
  );

  if (!result.rowCount) throw notFound('Payment session was not found.');

  return {
    paymentSessionId,
    status: result.rows[0].status,
  };
}

export async function getOwnerPaymentStatus(paymentSessionId: string) {
  const normalized = String(paymentSessionId ?? '').trim();
  if (!normalized) throw badRequest('paymentSessionId is required.');
  const result = await pool.query(
    'SELECT * FROM owner_payment_sessions WHERE id = $1 LIMIT 1',
    [normalized],
  );
  if (!result.rowCount) throw notFound('Payment session was not found.');
  const row = result.rows[0];
  return {
    paymentSessionId: row.id,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
  };
}

export async function completeOwnerOnboarding(input: {
  phone: string;
  paymentSessionId: string;
  restaurantName: string;
  firstOutletName: string;
  ownerPassword: string;
  adminPin: string;
}) {
  const phone = normalizePhone(input.phone);
  const restaurantName = cleanRequired(input.restaurantName, 'Restaurant name is required.');
  const firstOutletName = cleanRequired(input.firstOutletName, 'First outlet name is required.');
  const ownerPassword = String(input.ownerPassword ?? '').trim();
  const adminPin = String(input.adminPin ?? '').trim();

  if (ownerPassword.length < 8) throw badRequest('Owner password must be at least 8 characters.');
  if (adminPin.length < 4) throw badRequest('Admin PIN must be at least 4 digits.');

  await ensureVerifiedPhone(phone);

  const payment = await getPaymentSessionRow(input.paymentSessionId, phone);
  if (payment.status !== 'succeeded') {
    throw badRequest('Payment must be completed before restaurant setup.');
  }

  return withTransaction(async (client) => {
    const existingOwner = await client.query(
      'SELECT * FROM owners WHERE phone = $1 LIMIT 1',
      [phone],
    );
    const ownerId = existingOwner.rowCount ? (existingOwner.rows[0].id as string) : `owner_${randomUUID()}`;

    let restaurantId =
      existingOwner.rowCount && existingOwner.rows[0].restaurant_id
        ? String(existingOwner.rows[0].restaurant_id)
        : `rest_${randomUUID()}`;
    let outletId =
      existingOwner.rowCount && existingOwner.rows[0].outlet_id
        ? String(existingOwner.rows[0].outlet_id)
        : `outlet_${randomUUID()}`;

    if (existingOwner.rowCount && restaurantId && outletId) {
      await client.query(
        `
          UPDATE restaurants
          SET name = $1, status = 'active', updated_at = now()
          WHERE id = $2
        `,
        [restaurantName, restaurantId],
      );
      await client.query(
        `
          UPDATE outlets
          SET name = $1, updated_at = now()
          WHERE id = $2
        `,
        [firstOutletName, outletId],
      );
    } else {
      await client.query(
        `
          INSERT INTO restaurants (id, name, status)
          VALUES ($1, $2, 'active')
        `,
        [restaurantId, restaurantName],
      );
      await client.query(
        `
          INSERT INTO outlets (id, restaurant_id, name)
          VALUES ($1, $2, $3)
        `,
        [outletId, restaurantId, firstOutletName],
      );
      await seedDefaultTables(client, outletId);
    }

    await client.query(
      `
        INSERT INTO owners (id, phone, password_hash, restaurant_id, outlet_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (phone)
        DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          restaurant_id = EXCLUDED.restaurant_id,
          outlet_id = EXCLUDED.outlet_id,
          updated_at = now()
      `,
      [ownerId, phone, hashSecret(ownerPassword), restaurantId, outletId],
    );

    await client.query(
      `
        INSERT INTO restaurant_subscriptions (
          restaurant_id,
          status,
          plan_code,
          plan_name,
          billing_cycle,
          amount,
          currency,
          payment_method,
          payment_session_id,
          activated_at,
          updated_at
        )
        VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8, now(), now())
        ON CONFLICT (restaurant_id)
        DO UPDATE SET
          status = 'active',
          plan_code = EXCLUDED.plan_code,
          plan_name = EXCLUDED.plan_name,
          billing_cycle = EXCLUDED.billing_cycle,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          payment_method = EXCLUDED.payment_method,
          payment_session_id = EXCLUDED.payment_session_id,
          activated_at = now(),
          updated_at = now()
      `,
      [
        restaurantId,
        payment.plan_code,
        payment.plan_name,
        payment.billing_cycle,
        payment.amount,
        payment.currency,
        payment.payment_method,
        payment.id,
      ],
    );

    await client.query(
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
          gps_enforcement_enabled,
          updated_at
        )
        VALUES ($1, $2, 0, 20, true, true, 'none', 80, false, false, now())
        ON CONFLICT (outlet_id)
        DO UPDATE SET
          currency = EXCLUDED.currency,
          updated_at = now()
      `,
      [outletId, payment.currency],
    );

    await client.query(
      `
        INSERT INTO restaurant_admin_credentials (
          id,
          owner_id,
          restaurant_id,
          outlet_id,
          role,
          pin_hash,
          updated_at
        )
        VALUES ($1, $2, $3, $4, 'admin', $5, now())
        ON CONFLICT (restaurant_id, role)
        DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          outlet_id = EXCLUDED.outlet_id,
          pin_hash = EXCLUDED.pin_hash,
          updated_at = now()
      `,
      [randomUUID(), ownerId, restaurantId, outletId, hashSecret(adminPin)],
    );

    return buildWorkspaceResponse({
      ownerId,
      phone,
      restaurantId,
      restaurantName,
      restaurantStatus: 'active',
      outletId,
      outletName: firstOutletName,
      subscriptionStatus: 'active',
      planName: payment.plan_name,
      billingCycle: payment.billing_cycle,
    });
  });
}

export async function loginOwner(input: { phone: string; password: string }) {
  const phone = normalizePhone(input.phone);
  const password = String(input.password ?? '').trim();
  if (!password) throw badRequest('Password is required.');

  const result = await pool.query(
    `
      SELECT
        o.*,
        r.name AS restaurant_name,
        r.status AS restaurant_status,
        out.name AS outlet_name,
        rs.status AS subscription_status,
        rs.plan_name,
        rs.billing_cycle
      FROM owners o
      LEFT JOIN restaurants r ON r.id = o.restaurant_id
      LEFT JOIN outlets out ON out.id = o.outlet_id
      LEFT JOIN restaurant_subscriptions rs ON rs.restaurant_id = o.restaurant_id
      WHERE o.phone = $1
      LIMIT 1
    `,
    [phone],
  );

  if (!result.rowCount) throw unauthorized('Owner login failed.');
  const row = result.rows[0];
  if (!verifySecret(password, row.password_hash as string | null)) {
    throw unauthorized('Owner login failed.');
  }

  if (!row.restaurant_id || !row.outlet_id) {
    return {
      ownerAccessToken: issueSessionToken({
        kind: 'owner',
        ownerId: row.id as string,
        role: 'owner',
        phone,
      }),
      owner: {
        id: row.id,
        phone,
        hasRestaurant: false,
      },
    };
  }

  return buildWorkspaceResponse({
    ownerId: row.id as string,
    phone,
    restaurantId: row.restaurant_id as string,
    restaurantName: String(row.restaurant_name ?? 'Restaurant'),
    restaurantStatus: String(row.restaurant_status ?? 'active'),
    outletId: row.outlet_id as string,
    outletName: String(row.outlet_name ?? 'Main Outlet'),
    subscriptionStatus: String(row.subscription_status ?? 'active'),
    planName: String(row.plan_name ?? 'Cloud Starter'),
    billingCycle: String(row.billing_cycle ?? 'monthly'),
  });
}

export async function loginStaff(pin: string) {
  const normalizedPin = String(pin ?? '').trim();
  if (!normalizedPin) throw badRequest('PIN is required.');

  const result = await pool.query(
    `
      SELECT
        cred.*,
        own.phone,
        r.name AS restaurant_name,
        r.status AS restaurant_status,
        out.name AS outlet_name,
        rs.status AS subscription_status,
        rs.plan_name
      FROM restaurant_admin_credentials cred
      JOIN owners own ON own.id = cred.owner_id
      JOIN restaurants r ON r.id = cred.restaurant_id
      JOIN outlets out ON out.id = cred.outlet_id
      LEFT JOIN restaurant_subscriptions rs ON rs.restaurant_id = cred.restaurant_id
      WHERE cred.role = 'admin'
      ORDER BY cred.updated_at DESC
    `,
  );

  const match = result.rows.find((row: Record<string, unknown>) =>
    verifySecret(normalizedPin, row.pin_hash as string | null),
  );
  if (!match) throw unauthorized('Incorrect PIN');

  return {
    accessToken: issueSessionToken({
      kind: 'staff',
      ownerId: match.owner_id as string,
      restaurantId: match.restaurant_id as string,
      outletId: match.outlet_id as string,
      role: 'admin',
      phone: match.phone as string,
    }),
    role: 'admin',
    restaurant: {
      id: match.restaurant_id,
      name: match.restaurant_name,
      status: match.restaurant_status,
    },
    outlet: {
      id: match.outlet_id,
      name: match.outlet_name,
    },
    subscription: {
      status: match.subscription_status ?? 'active',
      planName: match.plan_name ?? 'Cloud Starter',
    },
    sync: {
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
    },
    menuDomain: null,
  };
}

export async function getStaffWorkspace(outletId: string) {
  const result = await pool.query(
    `
      SELECT
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        r.status AS restaurant_status,
        out.id AS outlet_id,
        out.name AS outlet_name,
        rs.status AS subscription_status,
        rs.plan_name,
        rs.billing_cycle,
        cfg.currency,
        cfg.tax_rate,
        cfg.prep_time_minutes,
        cfg.table_ordering_enabled,
        cfg.customer_ordering_enabled,
        cfg.printer_device_id,
        cfg.printer_connection_type,
        cfg.printer_address,
        cfg.printer_paper_width,
        cfg.auto_print_kitchen,
        cfg.gps_latitude,
        cfg.gps_longitude,
        cfg.gps_radius_meters,
        cfg.gps_enforcement_enabled
      FROM outlets out
      JOIN restaurants r ON r.id = out.restaurant_id
      LEFT JOIN restaurant_subscriptions rs ON rs.restaurant_id = r.id
      LEFT JOIN outlet_configs cfg ON cfg.outlet_id = out.id
      WHERE out.id = $1
      LIMIT 1
    `,
    [outletId],
  );

  if (!result.rowCount) throw notFound('Outlet was not found.');
  const row = result.rows[0];
  return {
    restaurantId: row.restaurant_id as string,
    restaurantName: row.restaurant_name as string,
    restaurantStatus: row.restaurant_status as string,
    outletId: row.outlet_id as string,
    outletName: row.outlet_name as string,
    currency: String(row.currency ?? 'BDT'),
    taxRate: Number(row.tax_rate ?? 0),
    prepTimeMinutes: Number(row.prep_time_minutes ?? 20),
    tableOrderingEnabled: Boolean(row.table_ordering_enabled ?? true),
    customerOrderingEnabled: Boolean(row.customer_ordering_enabled ?? true),
    gpsLatitude: row.gps_latitude == null ? null : Number(row.gps_latitude),
    gpsLongitude: row.gps_longitude == null ? null : Number(row.gps_longitude),
    gpsRadiusMeters: row.gps_radius_meters == null ? null : Number(row.gps_radius_meters),
    gpsEnforcementEnabled: Boolean(row.gps_enforcement_enabled ?? false),
    printer: {
      deviceId: (row.printer_device_id as string | null) ?? null,
      connectionType: String(row.printer_connection_type ?? 'none'),
      address: (row.printer_address as string | null) ?? null,
      paperWidth: Number(row.printer_paper_width ?? 80),
      autoPrintKitchen: Boolean(row.auto_print_kitchen ?? false),
    },
    subscription: {
      status: String(row.subscription_status ?? 'active'),
      planName: String(row.plan_name ?? 'Cloud Starter'),
      billingCycle: String(row.billing_cycle ?? 'monthly'),
    },
    sync: {
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
    },
  };
}

async function ensureVerifiedPhone(phone: string) {
  const result = await pool.query(
    `
      SELECT 1
      FROM owner_otps
      WHERE phone = $1
        AND verified_at IS NOT NULL
        AND expires_at >= now() - interval '1 day'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [phone],
  );
  if (!result.rowCount) throw badRequest('Phone must be verified before continuing.');
}

async function getPaymentSessionRow(paymentSessionId: string, phone: string) {
  const result = await pool.query(
    `
      SELECT *
      FROM owner_payment_sessions
      WHERE id = $1 AND phone = $2
      LIMIT 1
    `,
    [String(paymentSessionId ?? '').trim(), phone],
  );
  if (!result.rowCount) throw notFound('Payment session was not found.');
  return result.rows[0] as {
    id: string;
    phone: string;
    plan_code: string;
    plan_name: string;
    billing_cycle: string;
    payment_method: string;
    amount: number;
    currency: string;
    status: string;
  };
}

async function seedDefaultTables(client: PoolClient, outletId: string) {
  for (const name of ['A1', 'A2', 'A3', 'A4']) {
    await client.query(
      `
        INSERT INTO tables (id, outlet_id, name, seats, status)
        VALUES ($1, $2, $3, 4, 'available')
      `,
      [`table_${randomUUID()}`, outletId, name],
    );
  }
}

function buildWorkspaceResponse(input: {
  ownerId: string;
  phone: string;
  restaurantId: string;
  restaurantName: string;
  restaurantStatus: string;
  outletId: string;
  outletName: string;
  subscriptionStatus: string;
  planName: string;
  billingCycle: string;
}) {
  return {
    ownerAccessToken: issueSessionToken({
      kind: 'owner',
      ownerId: input.ownerId,
      restaurantId: input.restaurantId,
      outletId: input.outletId,
      role: 'owner',
      phone: input.phone,
    }),
    accessToken: issueSessionToken({
      kind: 'staff',
      ownerId: input.ownerId,
      restaurantId: input.restaurantId,
      outletId: input.outletId,
      role: 'admin',
      phone: input.phone,
    }),
    owner: {
      id: input.ownerId,
      phone: input.phone,
      hasRestaurant: true,
    },
    restaurant: {
      id: input.restaurantId,
      name: input.restaurantName,
      status: input.restaurantStatus,
    },
    outlet: {
      id: input.outletId,
      name: input.outletName,
    },
    subscription: {
      status: input.subscriptionStatus,
      billingCycle: input.billingCycle,
      planName: input.planName,
    },
    sync: {
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
    },
    menuDomain: null,
  };
}

function getPlan(code: string) {
  const plan = ownerPlans.find((entry) => entry.code === String(code ?? '').trim());
  if (!plan) throw badRequest('Plan was not found.');
  return plan;
}

function createOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(phone: string) {
  const normalized = String(phone ?? '').trim();
  if (!normalized) throw badRequest('Phone number is required.');
  return normalized;
}

function cleanRequired(value: string, message: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw badRequest(message);
  return normalized;
}
