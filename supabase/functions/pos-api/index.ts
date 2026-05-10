import {
  createClient,
  type SupabaseClient,
} from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors';

type JsonMap = Record<string, unknown>;

type ActionResult = {
  statusCode: number;
  body: JsonMap;
};

type MenuInput = {
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

type OrderInputItem = {
  id?: string;
  orderId?: string;
  menuItemId: string;
  name?: string;
  qty: number;
  price?: number;
  lineTotal?: number;
};

type OrderInput = {
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

type SyncEventInput = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload?: JsonMap;
  payloadJson?: string;
  status?: string;
  retryCount?: number;
  lastError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type BkashCredentials = {
  mode: string;
  baseUrl: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
};

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const statusPriority: Record<string, number> = {
  pending: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  served: 4,
  cancelled: 99,
};

const orderStatuses = new Set(Object.keys(statusPriority));
const realtimeTopicPrefix = 'pos:outlet:';
const menuImageBucket = 'menu-images';
const bkashProvider = 'bkash';
const bkashPurpose = 'admin_activation';

let cachedClient: SupabaseClient | null = null;

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') {
      return new Response('ok', {
        headers: responseHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const segments = path.split('/').filter(Boolean);

    if (request.method === 'GET' && segments[0] === 'health') {
      return json(await health());
    }

    if (
      request.method === 'POST' &&
      segments[0] === 'admin' &&
      segments[1] === 'login'
    ) {
      return json((await loginAdminAccount(request)).body);
    }

    if (segments[0] === 'payments' && segments[1] === 'bkash') {
      if (request.method === 'POST' && segments[2] === 'create') {
        return await withIdempotency(request, () => createBkashPayment(request));
      }
      if (
        request.method === 'GET' &&
        segments.length === 4 &&
        segments[3] === 'status'
      ) {
        return json(
          await getBkashPaymentStatus(requiredSegment(segments[2], 'paymentId')),
        );
      }
      if (
        request.method === 'POST' &&
        segments.length === 4 &&
        segments[3] === 'verify'
      ) {
        return json(await verifyBkashPayment(requiredSegment(segments[2], 'paymentId')));
      }
      if (segments[2] === 'callback') {
        return bkashCallback(request);
      }
    }

    if (
      request.method === 'POST' &&
      segments[0] === 'tenants' &&
      segments[1] === 'bootstrap'
    ) {
      return await withIdempotency(request, () => bootstrapTenant(request));
    }

    if (
      request.method === 'POST' &&
      segments[0] === 'devices' &&
      segments[1] === 'register'
    ) {
      return json((await registerDevice(request)).body);
    }

    if (
      request.method === 'POST' &&
      segments[0] === 'devices' &&
      segments[1] === 'heartbeat'
    ) {
      return json((await heartbeatDevice(request)).body);
    }

    if (
      request.method === 'GET' &&
      segments[0] === 'outlets' &&
      segments[2] === 'bootstrap'
    ) {
      return json(await getOutletBootstrap(requiredSegment(segments[1], 'outletId')));
    }

    if (segments[0] === 'outlets' && segments[2] === 'menu') {
      const outletId = requiredSegment(segments[1], 'outletId');
      if (
        request.method === 'POST' &&
        segments.length === 4 &&
        segments[3] === 'images'
      ) {
        await requireAdminForOutlet(request, outletId);
        return await withIdempotency(request, () => uploadMenuImage(outletId, request));
      }
      if (request.method === 'GET' && segments.length === 3) {
        return json(await listMenu(outletId, url));
      }
      if (request.method === 'POST' && segments.length === 3) {
        await requireAdminForOutlet(request, outletId);
        return await withIdempotency(request, () => createMenuItem(outletId, request));
      }
      if (request.method === 'PATCH' && segments.length === 4) {
        await requireAdminForOutlet(request, outletId);
        return await withIdempotency(request, () =>
          patchMenuItem(
            outletId,
            requiredSegment(segments[3], 'id'),
            request,
          )
        );
      }
      if (request.method === 'DELETE' && segments.length === 4) {
        await requireAdminForOutlet(request, outletId);
        return await withIdempotency(request, () =>
          deleteMenuItem(outletId, requiredSegment(segments[3], 'id'))
        );
      }
    }

    if (segments[0] === 'outlets' && segments[2] === 'orders') {
      const outletId = requiredSegment(segments[1], 'outletId');
      if (request.method === 'GET' && segments.length === 3) {
        await requireAdminForOutlet(request, outletId);
        return json(await listOrders(outletId, url));
      }
      if (request.method === 'POST' && segments.length === 3) {
        return await withIdempotency(request, () => createOrder(outletId, request));
      }
      if (request.method === 'GET' && segments.length === 4) {
        return json({
          ok: true,
          data: await getOrderById(outletId, requiredSegment(segments[3], 'id')),
        });
      }
      if (
        request.method === 'PATCH' &&
        segments.length === 5 &&
        segments[4] === 'status'
      ) {
        await requireAdminForOutlet(request, outletId);
        return await withIdempotency(request, () =>
          patchOrderStatus(
            outletId,
            requiredSegment(segments[3], 'id'),
            request,
          )
        );
      }
    }

    if (segments[0] === 'outlets' && segments[2] === 'sync') {
      const outletId = requiredSegment(segments[1], 'outletId');
      if (
        request.method === 'GET' &&
        segments.length === 4 &&
        segments[3] === 'pull'
      ) {
        await requireAdminForOutlet(request, outletId);
        return json(await pullSync(outletId, url));
      }
      if (
        request.method === 'POST' &&
        segments.length === 4 &&
        segments[3] === 'push'
      ) {
        await requireAdminForOutlet(request, outletId);
        return await withIdempotency(request, () => pushSync(outletId, request));
      }
    }

    throw new ApiError(404, `Route not found: ${request.method} ${path}`);
  } catch (error) {
    return errorJson(error);
  }
});

function db() {
  if (cachedClient) return cachedClient;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(
      500,
      'Supabase function secrets are not configured.',
    );
  }
  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedClient;
}

async function health() {
  const startedAt = Date.now();
  const { error } = await db().from('restaurants').select('id').limit(1);
  if (error) {
    return {
      ok: false,
      server: 'hybrid-pos-cloud',
      mode: 'cloud',
      database: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    ok: true,
    server: 'hybrid-pos-cloud',
    mode: 'cloud',
    database: true,
    wsPath: '/realtime/v1/websocket',
    connectedWsClients: 0,
    realtime: {
      enabled: true,
      provider: 'supabase_realtime_broadcast',
      supabaseUrl: Deno.env.get('SUPABASE_URL') ?? null,
      publishableKey:
        Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
          Deno.env.get('SUPABASE_ANON_KEY') ??
          null,
      channelPrefix: realtimeTopicPrefix,
      events: [
        'device_registered',
        'device_heartbeat',
        'menu_updated',
        'order_created',
        'order_status_updated',
      ],
    },
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };
}

async function createBkashPayment(request: Request): Promise<ActionResult> {
  const body = await readJson(request);
  const serverId = requireString(body.serverId, 'serverId');
  const amount = requireNumber(body.amount, 'amount');
  if (amount <= 0) throw new ApiError(400, 'amount must be greater than zero.');

  const currency = optionalString(body.currency, 'currency') ?? 'BDT';
  if (currency !== 'BDT') throw new ApiError(400, 'Only BDT is supported.');

  const credentials = bkashCredentials();
  const callbackURL = bkashCallbackUrl(request);
  const merchantInvoiceNumber = buildBkashInvoice(serverId);
  const paymentBody = {
    mode: '0011',
    payerReference: serverId,
    callbackURL,
    amount: amount.toFixed(2),
    currency,
    intent: 'sale',
    merchantInvoiceNumber,
  };
  const created = await bkashRequest('/create', paymentBody, credentials);
  const paymentID = stringFrom(created.paymentID ?? created.paymentId);
  const checkoutUrl = stringFrom(created.bkashURL ?? created.bKashURL);
  if (!paymentID || !checkoutUrl) {
    throw new ApiError(502, 'bKash did not return a payment URL.', created);
  }

  const row = await upsertSingle('payment_sessions', {
    id: crypto.randomUUID(),
    server_id: serverId,
    provider: bkashProvider,
    mode: credentials.mode,
    purpose: optionalString(body.purpose, 'purpose') ?? bkashPurpose,
    amount,
    currency,
    merchant_invoice_number: merchantInvoiceNumber,
    payment_id: paymentID,
    checkout_url: checkoutUrl,
    status: 'created',
    raw_create: created,
    updated_at: new Date().toISOString(),
  });

  return {
    statusCode: 201,
    body: {
      ok: true,
      data: mapPaymentSession(row),
    },
  };
}

async function bkashCallback(request: Request) {
  const url = new URL(request.url);
  const callbackBody = await safeCallbackBody(request);
  const paymentId = url.searchParams.get('paymentID') ??
    url.searchParams.get('paymentId') ??
    optionalString(callbackBody.paymentID, 'paymentID') ??
    optionalString(callbackBody.paymentId, 'paymentId');
  const status = url.searchParams.get('status')?.toLowerCase() ?? '';
  if (!paymentId) {
    return html(paymentHtml('Payment not found', false));
  }

  try {
    if (status === 'success') {
      await executeBkashPayment(paymentId);
      return html(paymentHtml('Payment successful. You can return to REs Admin.', true));
    }
    await updatePaymentSession(paymentId, {
      status: status === 'cancel' || status === 'cancelled' ? 'cancelled' : 'failed',
      last_error: status || 'bKash payment was not completed.',
      updated_at: new Date().toISOString(),
    });
    return html(paymentHtml('Payment was not completed. Please try again.', false));
  } catch (error) {
    await updatePaymentSession(paymentId, {
      status: 'failed',
      last_error: error instanceof Error ? error.message : 'Payment execution failed.',
      updated_at: new Date().toISOString(),
    });
    return html(paymentHtml('Payment verification failed. Please retry from the app.', false));
  }
}

async function getBkashPaymentStatus(paymentId: string) {
  const row = await maybePaymentSession(paymentId);
  if (!row) throw new ApiError(404, 'Payment session was not found.');
  return { ok: true, data: mapPaymentSession(row) };
}

async function verifyBkashPayment(paymentId: string) {
  const row = await maybePaymentSession(paymentId);
  if (!row) throw new ApiError(404, 'Payment session was not found.');
  if (row.status === 'paid') {
    return { ok: true, data: mapPaymentSession(row) };
  }

  const status = await queryBkashPayment(paymentId);
  const transactionStatus = stringFrom(status.transactionStatus).toLowerCase();
  const trxID = stringFrom(status.trxID ?? status.trxId ?? status.transactionId);
  const paid = transactionStatus === 'completed' || Boolean(trxID);
  const updated = await updatePaymentSession(paymentId, {
    status: paid ? 'paid' : String(row.status ?? 'created'),
    transaction_id: trxID || stringFrom(row.transaction_id) || null,
    raw_status: status,
    updated_at: new Date().toISOString(),
  });
  return { ok: true, data: mapPaymentSession(updated) };
}

async function executeBkashPayment(paymentId: string) {
  const credentials = bkashCredentials();
  const executed = await bkashRequest('/execute', { paymentID: paymentId }, credentials);
  const trxID = stringFrom(executed.trxID ?? executed.trxId ?? executed.transactionId);
  const transactionStatus = stringFrom(executed.transactionStatus).toLowerCase();
  const paid = transactionStatus === 'completed' || Boolean(trxID);
  const updated = await updatePaymentSession(paymentId, {
    status: paid ? 'paid' : 'failed',
    transaction_id: trxID || null,
    raw_execute: executed,
    last_error: paid ? null : stringFrom(executed.statusMessage) || 'bKash payment was not completed.',
    updated_at: new Date().toISOString(),
  });
  if (!paid) {
    throw new ApiError(402, 'bKash payment was not completed.', executed);
  }
  return updated;
}

async function queryBkashPayment(paymentId: string) {
  return bkashRequest('/payment/status', { paymentID: paymentId }, bkashCredentials());
}

async function bkashRequest(
  endpoint: string,
  body: JsonMap,
  credentials: BkashCredentials,
) {
  const token = await grantBkashToken(credentials);
  const response = await fetch(`${credentials.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': token,
      'X-App-Key': credentials.appKey,
    },
    body: JSON.stringify(body),
  });
  const jsonBody = await readResponseJson(response);
  if (!response.ok || stringFrom(jsonBody.errorCode)) {
    throw new ApiError(
      response.ok ? 502 : response.status,
      stringFrom(jsonBody.errorMessage) ||
        stringFrom(jsonBody.statusMessage) ||
        'bKash request failed.',
      jsonBody,
    );
  }
  return jsonBody;
}

async function grantBkashToken(credentials: BkashCredentials) {
  const response = await fetch(`${credentials.baseUrl}/token/grant`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'username': credentials.username,
      'password': credentials.password,
    },
    body: JSON.stringify({
      app_key: credentials.appKey,
      app_secret: credentials.appSecret,
    }),
  });
  const jsonBody = await readResponseJson(response);
  const token = stringFrom(jsonBody.id_token ?? jsonBody.idToken);
  if (!response.ok || !token) {
    throw new ApiError(
      response.ok ? 502 : response.status,
      stringFrom(jsonBody.errorMessage) ||
        stringFrom(jsonBody.statusMessage) ||
        'bKash token grant failed.',
      jsonBody,
    );
  }
  return token;
}

async function loginAdminAccount(request: Request): Promise<ActionResult> {
  const body = await readJson(request);
  const identifier = (
    optionalString(body.usernameOrEmail, 'usernameOrEmail') ??
      optionalString(body.email, 'email') ??
      optionalString(body.username, 'username')
  )?.toLowerCase();
  if (!identifier) {
    throw new ApiError(400, 'usernameOrEmail is required.');
  }
  const password = requireString(body.password, 'password');
  const serverId = optionalString(body.serverId, 'serverId') ?? makePublicId('server');

  const account = await findAdminAccount(identifier);
  if (!account || account.is_active !== true) {
    throw new ApiError(401, 'Invalid username/email or password.');
  }

  const passwordHash = await sha256Hex(
    `${password}:${String(account.password_salt)}`,
  );
  if (passwordHash !== String(account.password_hash)) {
    throw new ApiError(401, 'Invalid username/email or password.');
  }

  const restaurantId = String(account.restaurant_id);
  const outletId = String(account.outlet_id);
  const restaurantName = await restaurantNameFor(restaurantId);
  const outletName = await outletNameFor(outletId);
  const now = new Date().toISOString();
  const deviceToken = makeDeviceToken();
  const tokenHash = await sha256Hex(deviceToken);

  await ensureRestaurantOutlet({
    restaurantId,
    outletId,
    restaurantName,
    outletName,
    updateNames: false,
  });

  const device = await upsertSingle('devices', {
    id: serverId,
    restaurant_id: restaurantId,
    outlet_id: outletId,
    restaurant_name: restaurantName,
    outlet_name: outletName,
    device_token_hash: tokenHash,
    token_issued_at: now,
    is_active: true,
    updated_at: now,
  });

  await broadcastToOutlet(outletId, 'device_registered', {
    ...device,
    device_token_hash: undefined,
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      data: {
        account: {
          id: account.id,
          email: account.email,
          username: account.username,
          role: account.role,
        },
        serverId,
        restaurantId,
        outletId,
        restaurantName,
        outletName,
        deviceToken,
        cloudSyncEnabled: true,
      },
    },
  };
}

async function findAdminAccount(identifier: string) {
  const fields =
    'id, restaurant_id, outlet_id, email, username, password_salt, password_hash, role, is_active';
  const emailResult = await db()
    .from('admin_accounts')
    .select(fields)
    .eq('email', identifier)
    .maybeSingle();
  throwIf(emailResult.error);
  if (emailResult.data) return emailResult.data as JsonMap;

  const usernameResult = await db()
    .from('admin_accounts')
    .select(fields)
    .eq('username', identifier)
    .maybeSingle();
  throwIf(usernameResult.error);
  return usernameResult.data as JsonMap | null;
}

async function restaurantNameFor(restaurantId: string) {
  const { data, error } = await db()
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .maybeSingle();
  throwIf(error);
  return stringFrom(data?.name) || restaurantId;
}

async function outletNameFor(outletId: string) {
  const { data, error } = await db()
    .from('outlets')
    .select('name')
    .eq('id', outletId)
    .maybeSingle();
  throwIf(error);
  return stringFrom(data?.name) || outletId;
}

async function bootstrapTenant(request: Request): Promise<ActionResult> {
  const body = await readJson(request);
  const serverId = requireString(body.serverId, 'serverId');
  const restaurantName = requireString(body.restaurantName, 'restaurantName');
  const outletName = requireString(body.outletName, 'outletName');
  const restaurantId = optionalString(body.restaurantId, 'restaurantId') ??
    makePublicId('rest');
  const outletId = optionalString(body.outletId, 'outletId') ??
    makePublicId('outlet');
  const now = new Date().toISOString();
  const deviceToken = makeDeviceToken();
  const tokenHash = await sha256Hex(deviceToken);

  await ensureRestaurantOutlet({
    restaurantId,
    outletId,
    restaurantName,
    outletName,
  });

  const device = await upsertSingle('devices', {
    id: serverId,
    restaurant_id: restaurantId,
    outlet_id: outletId,
    restaurant_name: restaurantName,
    outlet_name: outletName,
    device_token_hash: tokenHash,
    token_issued_at: now,
    is_active: true,
    updated_at: now,
  });

  const payload = {
    serverId,
    restaurantId,
    outletId,
    restaurantName,
    outletName,
    deviceToken,
    cloudSyncEnabled: true,
    device,
  };

  await broadcastToOutlet(outletId, 'device_registered', {
    ...device,
    device_token_hash: undefined,
  });
  return { statusCode: 201, body: { ok: true, data: payload } };
}

async function registerDevice(request: Request): Promise<ActionResult> {
  const body = await readJson(request);
  const input = {
    serverId: requireString(body.serverId, 'serverId'),
    restaurantId: requireString(body.restaurantId, 'restaurantId'),
    outletId: requireString(body.outletId, 'outletId'),
    restaurantName: requireString(body.restaurantName, 'restaurantName'),
    outletName: requireString(body.outletName, 'outletName'),
  };
  await requireAdminForOutlet(request, input.outletId, input.serverId);
  await ensureRestaurantOutlet(input);
  const row = await upsertSingle('devices', {
    id: input.serverId,
    restaurant_id: input.restaurantId,
    outlet_id: input.outletId,
    restaurant_name: input.restaurantName,
    outlet_name: input.outletName,
    is_active: true,
    updated_at: new Date().toISOString(),
  });
  await broadcastToOutlet(input.outletId, 'device_registered', row);
  return { statusCode: 200, body: { ok: true, data: row } };
}

async function heartbeatDevice(request: Request): Promise<ActionResult> {
  const body = await readJson(request);
  const input = {
    serverId: requireString(body.serverId, 'serverId'),
    restaurantId: requireString(body.restaurantId, 'restaurantId'),
    outletId: requireString(body.outletId, 'outletId'),
    localIp: nullableString(body.localIp),
    port: nullableNumber(body.port),
    localServerRunning: booleanOr(body.localServerRunning, false),
  };
  await requireAdminForOutlet(request, input.outletId, input.serverId);
  await ensureRestaurantOutlet({
    restaurantId: input.restaurantId,
    outletId: input.outletId,
    restaurantName: input.restaurantId,
    outletName: input.outletId,
    updateNames: false,
  });
  const patch = {
    restaurant_id: input.restaurantId,
    outlet_id: input.outletId,
    local_ip: input.localIp,
    local_port: input.port,
    local_server_running: input.localServerRunning,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const existing = await maybeDeviceRow(input.serverId);
  const row = existing
    ? await updateSingle('devices', patch, { id: input.serverId })
    : await upsertSingle('devices', {
      id: input.serverId,
      ...patch,
      restaurant_name: input.restaurantId,
      outlet_name: input.outletId,
    });
  await broadcastToOutlet(input.outletId, 'device_heartbeat', row);
  return { statusCode: 200, body: { ok: true, data: row } };
}

async function listMenu(outletId: string, url: URL) {
  const includeUnavailable = url.searchParams.get('includeUnavailable') === 'true';
  const since = parseOptionalDate(url.searchParams.get('since'));
  let query = db()
    .from('menu_items')
    .select('*')
    .eq('outlet_id', outletId)
    .is('deleted_at', null);

  if (!includeUnavailable) query = query.eq('is_available', true);
  if (since) query = query.gte('updated_at', since.toISOString());

  const { data, error } = await query
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  throwIf(error);
  const items = (data ?? []).map(mapMenuRow);
  return { ok: true, count: items.length, data: items };
}

async function getOutletBootstrap(outletId: string) {
  const { data: outlet, error: outletError } = await db()
    .from('outlets')
    .select('id, name, restaurant_id')
    .eq('id', outletId)
    .maybeSingle();
  throwIf(outletError);
  if (!outlet) throw new ApiError(404, 'Outlet not found.');

  const restaurantId = String(outlet.restaurant_id);
  const { data: restaurant, error: restaurantError } = await db()
    .from('restaurants')
    .select('id, name')
    .eq('id', restaurantId)
    .maybeSingle();
  throwIf(restaurantError);

  return {
    ok: true,
    data: {
      restaurant: {
        id: restaurant?.id ?? restaurantId,
        name: restaurant?.name ?? 'Restaurant',
      },
      outlet: {
        id: outlet.id,
        name: outlet.name ?? 'Restaurant',
        currency: 'BDT',
        taxRate: 0,
        prepTimeMinutes: null,
      },
      geofence: {
        gpsEnforcementEnabled: false,
        gpsConfigured: false,
        gpsLatitude: null,
        gpsLongitude: null,
        gpsRadiusMeters: null,
      },
    },
  };
}

async function createMenuItem(
  outletId: string,
  request: Request,
): Promise<ActionResult> {
  const input = parseMenuInput(await readJson(request), false);
  const item = await upsertMenuItem(outletId, input);
  await broadcastToOutlet(outletId, 'menu_updated', item);
  return { statusCode: 200, body: { ok: true, data: item } };
}

async function uploadMenuImage(
  outletId: string,
  request: Request,
): Promise<ActionResult> {
  const body = await readJson(request);
  const dataUrl = optionalString(body.dataUrl, 'dataUrl');
  const rawBase64 = optionalString(body.base64, 'base64');
  if (!dataUrl && !rawBase64) {
    throw new ApiError(400, 'dataUrl or base64 is required.');
  }

  const parsed = dataUrl
    ? parseImageDataUrl(dataUrl)
    : {
      contentType: optionalString(body.contentType, 'contentType') ??
        'image/jpeg',
      base64: rawBase64!,
    };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(parsed.contentType)) {
    throw new ApiError(400, 'Only JPEG, PNG, and WEBP images are allowed.');
  }

  const bytes = decodeBase64(parsed.base64);
  if (bytes.length === 0) throw new ApiError(400, 'Image payload is empty.');
  if (bytes.length > 5 * 1024 * 1024) {
    throw new ApiError(400, 'Image must be 5MB or smaller.');
  }

  const fileName = optionalString(body.fileName, 'fileName') ??
    `${crypto.randomUUID()}${extensionForContentType(parsed.contentType)}`;
  const objectPath = `${outletId}/${Date.now()}-${sanitizeFileName(fileName)}`;
  const { error } = await db().storage
    .from(menuImageBucket)
    .upload(objectPath, new Blob([bytes], { type: parsed.contentType }), {
      contentType: parsed.contentType,
      upsert: true,
    });
  throwIf(error);

  const { data } = db().storage.from(menuImageBucket).getPublicUrl(objectPath);
  return {
    statusCode: 201,
    body: {
      ok: true,
      data: {
        bucket: menuImageBucket,
        path: objectPath,
        publicUrl: data.publicUrl,
        contentType: parsed.contentType,
        size: bytes.length,
      },
    },
  };
}

async function patchMenuItem(
  outletId: string,
  id: string,
  request: Request,
): Promise<ActionResult> {
  const patch = parseMenuInput(await readJson(request), true);
  const existing = await getMenuItemRow(outletId, id);
  const current = mapMenuRow(existing) as MenuInput;
  const item = await upsertMenuItem(outletId, {
    ...current,
    ...patch,
    id,
    version: Math.max(
      Number(current.version ?? 1),
      Number(patch.version ?? 1),
    ),
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  });
  await broadcastToOutlet(outletId, 'menu_updated', item);
  return { statusCode: 200, body: { ok: true, data: item } };
}

async function deleteMenuItem(
  outletId: string,
  id: string,
): Promise<ActionResult> {
  const existing = await getMenuItemRow(outletId, id);
  const row = await updateSingle(
    'menu_items',
    {
      deleted_at: new Date().toISOString(),
      is_available: false,
      version: Number(existing.version ?? 1) + 1,
      app_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { id, outlet_id: outletId },
  );
  const item = mapMenuRow(row);
  await broadcastToOutlet(outletId, 'menu_updated', item);
  return { statusCode: 200, body: { ok: true, data: item } };
}

async function upsertMenuItem(outletId: string, input: MenuInput) {
  const existing = await maybeMenuItemRow(outletId, input.id);
  const incomingUpdatedAt = parseOptionalDate(input.updatedAt);
  const existingUpdatedAt = parseOptionalDate(
    existing?.app_updated_at?.toString() ?? null,
  );

  if (
    existing &&
    incomingUpdatedAt &&
    existingUpdatedAt &&
    incomingUpdatedAt < existingUpdatedAt
  ) {
    return mapMenuRow(existing);
  }

  const row = await upsertSingle('menu_items', {
    id: input.id,
    outlet_id: outletId,
    name: input.name,
    description: input.description ?? '',
    category: input.category ?? 'General',
    price: input.price,
    image_url: input.imageUrl ?? null,
    is_available: input.isAvailable ?? true,
    preparation_time_minutes: input.preparationTimeMinutes ?? null,
    tags: input.tags ?? [],
    sync_status: input.syncStatus ?? 'synced',
    version: Math.max(
      Number(existing?.version ?? 1),
      Number(input.version ?? 1),
    ),
    deleted_at: input.deletedAt ?? null,
    app_created_at: input.createdAt ?? existing?.app_created_at ?? null,
    app_updated_at: input.updatedAt ?? new Date().toISOString(),
    raw_payload: input,
    updated_at: new Date().toISOString(),
  });
  return mapMenuRow(row);
}

async function listOrders(outletId: string, url: URL) {
  const since = parseOptionalDate(url.searchParams.get('since'));
  let query = db().from('orders').select('*').eq('outlet_id', outletId);
  if (since) query = query.gte('updated_at', since.toISOString());
  const status = url.searchParams.get('status');
  if (status) query = query.eq('status', status);
  const source = url.searchParams.get('source');
  if (source) query = query.eq('source', source);

  const { data, error } = await query.order('created_at', { ascending: false });
  throwIf(error);
  const orders = [];
  for (const row of data ?? []) {
    orders.push(await hydrateOrder(row));
  }
  return { ok: true, count: orders.length, data: orders };
}

async function createOrder(
  outletId: string,
  request: Request,
): Promise<ActionResult> {
  const input = parseOrderInput(await readJson(request));
  const order = await upsertOrder(outletId, input);
  await broadcastToOutlet(outletId, 'order_created', order);
  return { statusCode: 201, body: { ok: true, data: order } };
}

async function getOrderById(outletId: string, id: string) {
  const row = await getOrderRow(outletId, id);
  return hydrateOrder(row);
}

async function patchOrderStatus(
  outletId: string,
  id: string,
  request: Request,
): Promise<ActionResult> {
  const body = await readJson(request);
  const status = requireString(body.status, 'status');
  const order = await updateOrderStatus(outletId, id, status);
  await broadcastToOutlet(outletId, 'order_status_updated', order);
  return { statusCode: 200, body: { ok: true, data: order } };
}

async function upsertOrder(outletId: string, input: OrderInput) {
  if (!input.items.length) {
    throw new ApiError(400, 'Order must include at least one item.');
  }

  const orderId = input.id ?? crypto.randomUUID();
  const existing = await maybeOrderRow(outletId, orderId);
  if (existing) return hydrateOrder(existing);

  const preparedItems = await prepareOrderItems(outletId, orderId, input.items);
  const total = preparedItems.reduce((sum, item) => sum + item.line_total, 0);
  const orderRow = {
    id: orderId,
    outlet_id: outletId,
    order_no: input.orderNo ?? buildOrderNo(),
    source: input.source ?? 'cloud',
    customer_name: clean(input.customerName),
    table_no: clean(input.tableNo),
    note: clean(input.note),
    status: input.status ?? 'pending',
    total: input.total ?? total,
    sync_status: input.syncStatus ?? 'synced',
    version: input.version ?? 1,
    app_created_at: input.createdAt ?? null,
    app_updated_at: input.updatedAt ?? null,
    raw_payload: input,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db().from('orders').insert(orderRow).select('*')
    .single();
  throwIf(error);

  const { error: itemError } = await db().from('order_items').insert(
    preparedItems,
  );
  if (itemError) {
    await db().from('orders').delete().eq('id', orderId);
    throw new ApiError(400, itemError.message, itemError);
  }

  return hydrateOrder(data);
}

async function updateOrderStatus(outletId: string, id: string, status: string) {
  if (!orderStatuses.has(status)) {
    throw new ApiError(400, `Unknown order status: ${status}`);
  }
  const existing = await getOrderRow(outletId, id);
  const current = String(existing.status);
  if (!canTransitionOrderStatus(current, status)) {
    throw new ApiError(400, `Cannot change ${current} order to ${status}.`);
  }
  const row = await updateSingle(
    'orders',
    {
      status,
      version: Number(existing.version ?? 1) + 1,
      app_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { id, outlet_id: outletId },
  );
  return hydrateOrder(row);
}

async function pullSync(outletId: string, url: URL) {
  const since = parseOptionalDate(url.searchParams.get('since'));
  let menuQuery = db().from('menu_items').select('*').eq('outlet_id', outletId);
  let orderQuery = db().from('orders').select('*').eq('outlet_id', outletId);
  if (since) {
    menuQuery = menuQuery.gte('updated_at', since.toISOString());
    orderQuery = orderQuery.gte('updated_at', since.toISOString());
  }

  const [menuResult, orderResult] = await Promise.all([
    menuQuery.order('updated_at', { ascending: true }),
    orderQuery.order('updated_at', { ascending: true }),
  ]);
  throwIf(menuResult.error);
  throwIf(orderResult.error);

  const orders = [];
  for (const row of orderResult.data ?? []) {
    orders.push(await hydrateOrder(row));
  }

  return {
    ok: true,
    data: {
      menu: (menuResult.data ?? []).map(mapMenuRow),
      orders,
      timestamp: new Date().toISOString(),
    },
  };
}

async function pushSync(
  outletId: string,
  request: Request,
): Promise<ActionResult> {
  const body = await readJson(request);
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  const events = rawEvents.map((event) => parseSyncEvent(asMap(event)));
  const results = [];
  for (const event of events) {
    results.push(await applySyncEvent(outletId, event));
  }
  return {
    statusCode: 200,
    body: { ok: true, count: results.length, data: results },
  };
}

async function applySyncEvent(outletId: string, event: SyncEventInput) {
  const payload = readPayload(event);
  const { error } = await db().from('sync_events').upsert({
    id: event.id,
    outlet_id: outletId,
    entity_type: event.entityType,
    entity_id: event.entityId,
    action: event.action,
    payload,
    status: event.status ?? 'synced',
    retry_count: event.retryCount ?? 0,
    last_error: event.lastError ?? null,
    app_created_at: event.createdAt ?? null,
    app_updated_at: event.updatedAt ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  throwIf(error);

  if (event.entityType === 'menu_item') {
    if (event.action === 'delete') {
      const deleted = await deleteMenuItem(outletId, event.entityId);
      return {
        eventId: event.id,
        entityType: event.entityType,
        data: deleted.body.data,
      };
    }
    const item = await upsertMenuItem(outletId, parseMenuInput(payload, false));
    await broadcastToOutlet(outletId, 'menu_updated', item);
    return { eventId: event.id, entityType: event.entityType, data: item };
  }

  if (event.entityType === 'order') {
    const order = await upsertOrder(outletId, parseOrderInput(payload));
    await broadcastToOutlet(outletId, 'order_created', order);
    return { eventId: event.id, entityType: event.entityType, data: order };
  }

  if (event.entityType === 'order_status') {
    const status = requireString(payload.status, 'status');
    const order = await updateOrderStatus(outletId, event.entityId, status);
    await broadcastToOutlet(outletId, 'order_status_updated', order);
    return { eventId: event.id, entityType: event.entityType, data: order };
  }

  return { eventId: event.id, entityType: event.entityType, skipped: true };
}

function bkashCredentials(): BkashCredentials {
  const mode = Deno.env.get('BKASH_MODE')?.trim() || 'sandbox';
  const defaultSandboxUrl =
    'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout';
  const baseUrl = Deno.env.get('BKASH_BASE_URL')?.trim() ||
    (mode === 'sandbox' ? defaultSandboxUrl : '');
  const appKey = Deno.env.get('BKASH_APP_KEY')?.trim() ?? '';
  const appSecret = Deno.env.get('BKASH_APP_SECRET')?.trim() ?? '';
  const username = Deno.env.get('BKASH_USERNAME')?.trim() ?? '';
  const password = Deno.env.get('BKASH_PASSWORD')?.trim() ?? '';
  if (!baseUrl || !appKey || !appSecret || !username || !password) {
    throw new ApiError(
      503,
      'bKash sandbox secrets are not configured in Supabase.',
    );
  }
  return {
    mode,
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    appKey,
    appSecret,
    username,
    password,
  };
}

function bkashCallbackUrl(request: Request) {
  const configured = Deno.env.get('BKASH_CALLBACK_URL')?.trim();
  if (configured) return configured;
  const url = new URL(request.url);
  const marker = '/payments/bkash/create';
  const index = url.pathname.indexOf(marker);
  const basePath = index >= 0 ? url.pathname.slice(0, index) : '';
  return `${url.origin}${basePath}/payments/bkash/callback`;
}

function buildBkashInvoice(serverId: string) {
  const safeServer = serverId.replaceAll(/[^a-zA-Z0-9]/g, '').slice(0, 12) ||
    'server';
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const suffix = crypto.randomUUID().split('-')[0].toUpperCase();
  return `POS-${safeServer}-${stamp}-${suffix}`;
}

async function maybePaymentSession(paymentId: string) {
  const { data, error } = await db()
    .from('payment_sessions')
    .select('*')
    .eq('payment_id', paymentId)
    .maybeSingle();
  throwIf(error);
  return data;
}

async function updatePaymentSession(paymentId: string, patch: JsonMap) {
  return updateSingle('payment_sessions', patch, { payment_id: paymentId });
}

function mapPaymentSession(row: JsonMap) {
  return {
    id: row.id,
    serverId: row.server_id,
    provider: row.provider,
    mode: row.mode,
    purpose: row.purpose,
    amount: Number(row.amount),
    currency: row.currency,
    merchantInvoiceNumber: row.merchant_invoice_number,
    paymentId: row.payment_id,
    transactionId: row.transaction_id,
    checkoutUrl: row.checkout_url,
    status: row.status,
    paid: row.status === 'paid',
    lastError: row.last_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function readResponseJson(response: Response): Promise<JsonMap> {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    return asMap(JSON.parse(raw));
  } catch (_) {
    throw new ApiError(
      502,
      'Payment provider returned an invalid JSON response.',
      raw.slice(0, 500),
    );
  }
}

async function safeCallbackBody(request: Request): Promise<JsonMap> {
  if (request.method === 'GET') return {};
  try {
    return await readJson(request);
  } catch (_) {
    return {};
  }
}

function stringFrom(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function paymentHtml(message: string, success: boolean) {
  const color = success ? '#008C76' : '#E0264D';
  const title = success ? 'Payment Successful' : 'Payment Incomplete';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f8f5; color: #111b20; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { max-width: 440px; width: 100%; background: #fff; border: 1px solid #e3e8e4; border-radius: 24px; padding: 28px; box-shadow: 0 18px 48px rgba(15,42,31,.12); text-align: center; }
    .mark { width: 64px; height: 64px; border-radius: 20px; margin: 0 auto 18px; display: grid; place-items: center; background: ${color}; color: white; font-size: 34px; font-weight: 900; }
    h1 { margin: 0 0 10px; font-size: 24px; }
    p { margin: 0; color: #5c6b6b; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <div class="mark">${success ? '&check;' : '!'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;
}

async function ensureRestaurantOutlet(input: {
  restaurantId: string;
  outletId: string;
  restaurantName: string;
  outletName: string;
  updateNames?: boolean;
}) {
  const { error: restaurantError } = await db().from('restaurants').upsert({
    id: input.restaurantId,
    name: input.restaurantName,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'id',
    ignoreDuplicates: input.updateNames === false,
  });
  throwIf(restaurantError);

  const { error: outletError } = await db().from('outlets').upsert({
    id: input.outletId,
    restaurant_id: input.restaurantId,
    name: input.outletName,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'id',
    ignoreDuplicates: input.updateNames === false,
  });
  throwIf(outletError);
}

async function broadcastToOutlet(
  outletId: string,
  type: string,
  data: unknown,
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;

  try {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `${realtimeTopicPrefix}${outletId}`,
            event: type,
            payload: {
              type,
              data,
              outletId,
              timestamp: new Date().toISOString(),
            },
          },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(
        `Realtime broadcast failed: ${response.status} ${await response.text()}`,
      );
    }
  } catch (error) {
    console.warn('Realtime broadcast failed:', error);
  }
}

async function withIdempotency(
  request: Request,
  action: () => Promise<ActionResult>,
) {
  const key = request.headers.get('Idempotency-Key')?.trim();
  if (!key) {
    const result = await action();
    return json(result.body, result.statusCode);
  }

  const { data: existing, error: existingError } = await db()
    .from('idempotency_keys')
    .select('status_code, response_body')
    .eq('key', key)
    .maybeSingle();
  throwIf(existingError);
  if (existing) {
    return json(existing.response_body as JsonMap, Number(existing.status_code));
  }

  const result = await action();
  const { error } = await db().from('idempotency_keys').insert({
    key,
    status_code: result.statusCode,
    response_body: result.body,
  });
  if (error && error.code !== '23505') throwIf(error);

  return json(result.body, result.statusCode);
}

async function prepareOrderItems(
  outletId: string,
  orderId: string,
  items: OrderInputItem[],
) {
  const prepared = [];
  for (const item of items) {
    if (item.qty <= 0) {
      throw new ApiError(400, 'Item quantity must be greater than zero.');
    }

    if (item.name && item.price != null) {
      const lineTotal = item.lineTotal ?? item.price * item.qty;
      prepared.push({
        id: item.id ?? crypto.randomUUID(),
        order_id: orderId,
        menu_item_id: item.menuItemId,
        name: item.name,
        qty: item.qty,
        price: item.price,
        line_total: lineTotal,
      });
      continue;
    }

    const { data: menuItem, error } = await db()
      .from('menu_items')
      .select('*')
      .eq('id', item.menuItemId)
      .eq('outlet_id', outletId)
      .is('deleted_at', null)
      .eq('is_available', true)
      .maybeSingle();
    throwIf(error);
    if (!menuItem) {
      throw new ApiError(400, `Menu item ${item.menuItemId} is not available.`);
    }
    const price = Number(menuItem.price);
    prepared.push({
      id: item.id ?? crypto.randomUUID(),
      order_id: orderId,
      menu_item_id: item.menuItemId,
      name: String(menuItem.name),
      qty: item.qty,
      price,
      line_total: price * item.qty,
    });
  }
  return prepared;
}

async function hydrateOrder(row: JsonMap) {
  const { data, error } = await db()
    .from('order_items')
    .select('*')
    .eq('order_id', row.id)
    .order('name', { ascending: true });
  throwIf(error);
  return mapOrderRow(row, data ?? []);
}

async function maybeMenuItemRow(outletId: string, id: string) {
  const { data, error } = await db()
    .from('menu_items')
    .select('*')
    .eq('id', id)
    .eq('outlet_id', outletId)
    .maybeSingle();
  throwIf(error);
  return data;
}

async function getMenuItemRow(outletId: string, id: string) {
  const data = await maybeMenuItemRow(outletId, id);
  if (!data) throw new ApiError(404, 'Menu item was not found.');
  return data;
}

async function maybeOrderRow(outletId: string, id: string) {
  const { data, error } = await db()
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('outlet_id', outletId)
    .maybeSingle();
  throwIf(error);
  return data;
}

async function getOrderRow(outletId: string, id: string) {
  const data = await maybeOrderRow(outletId, id);
  if (!data) throw new ApiError(404, 'Order was not found.');
  return data;
}

async function upsertSingle(table: string, row: JsonMap) {
  const { data, error } = await db().from(table).upsert(row, {
    onConflict: 'id',
  }).select('*').single();
  throwIf(error);
  return data;
}

async function updateSingle(
  table: string,
  patch: JsonMap,
  conditions: JsonMap,
) {
  let query = db().from(table).update(patch).select('*');
  for (const [key, value] of Object.entries(conditions)) {
    query = query.eq(key, value);
  }
  const { data, error } = await query.single();
  throwIf(error);
  return data;
}

function mapMenuRow(row: JsonMap) {
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

function mapOrderRow(row: JsonMap, items: JsonMap[]) {
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

function mapOrderItemRow(row: JsonMap) {
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

function parseMenuInput(body: JsonMap, partial: boolean): MenuInput {
  const input: Partial<MenuInput> = {};
  if (!partial || body.id != null) input.id = requireString(body.id, 'id');
  if (!partial || body.name != null) {
    input.name = requireString(body.name, 'name');
  }
  if (body.description !== undefined) input.description = nullableString(body.description);
  if (body.category !== undefined) input.category = nullableString(body.category);
  if (!partial || body.price != null) input.price = requireNumber(body.price, 'price');
  if (body.imageUrl !== undefined) input.imageUrl = nullableString(body.imageUrl);
  if (body.isAvailable !== undefined) input.isAvailable = requireBoolean(body.isAvailable, 'isAvailable');
  if (body.preparationTimeMinutes !== undefined) {
    input.preparationTimeMinutes = nullableNumber(body.preparationTimeMinutes);
  }
  if (body.tags !== undefined) input.tags = stringArray(body.tags, 'tags');
  if (body.syncStatus !== undefined) input.syncStatus = requireString(body.syncStatus, 'syncStatus');
  if (body.version !== undefined) input.version = requireInteger(body.version, 'version');
  if (body.deletedAt !== undefined) input.deletedAt = nullableString(body.deletedAt);
  if (body.createdAt !== undefined) input.createdAt = nullableString(body.createdAt);
  if (body.updatedAt !== undefined) input.updatedAt = nullableString(body.updatedAt);
  return input as MenuInput;
}

async function maybeDeviceRow(id: string) {
  const { data, error } = await db()
    .from('devices')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  throwIf(error);
  return data;
}

async function requireAdminForOutlet(
  request: Request,
  outletId: string,
  serverId?: string,
) {
  const token = bearerToken(request);
  if (!token) {
    throw new ApiError(401, 'Admin device token is required.');
  }
  const tokenHash = await sha256Hex(token);
  let query = db()
    .from('devices')
    .select('id, restaurant_id, outlet_id, is_active')
    .eq('outlet_id', outletId)
    .eq('device_token_hash', tokenHash)
    .eq('is_active', true);
  if (serverId) query = query.eq('id', serverId);
  const { data, error } = await query.maybeSingle();
  throwIf(error);
  if (!data) {
    throw new ApiError(403, 'Admin device is not authorized for this outlet.');
  }
  return data;
}

function bearerToken(request: Request) {
  const header = request.headers.get('Authorization')?.trim() ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function makePublicId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
}

function makeDeviceToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `posdt_${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`;
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseOrderInput(body: JsonMap): OrderInput {
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError(400, 'Order must include at least one item.');
  }
  const status = optionalString(body.status, 'status');
  if (status && !orderStatuses.has(status)) {
    throw new ApiError(400, `Unknown order status: ${status}`);
  }
  return {
    id: optionalString(body.id, 'id'),
    orderNo: optionalString(body.orderNo, 'orderNo'),
    source: optionalString(body.source, 'source'),
    customerName: nullableString(body.customerName),
    tableNo: nullableString(body.tableNo),
    note: nullableString(body.note),
    status,
    total: body.total == null ? undefined : requireNumber(body.total, 'total'),
    syncStatus: optionalString(body.syncStatus, 'syncStatus'),
    version: body.version == null ? undefined : requireInteger(body.version, 'version'),
    createdAt: nullableString(body.createdAt),
    updatedAt: nullableString(body.updatedAt),
    items: rawItems.map((item, index) => parseOrderItem(asMap(item), index)),
  };
}

function parseOrderItem(body: JsonMap, index: number): OrderInputItem {
  return {
    id: optionalString(body.id, `items[${index}].id`),
    orderId: optionalString(body.orderId, `items[${index}].orderId`),
    menuItemId: requireString(body.menuItemId, `items[${index}].menuItemId`),
    name: optionalString(body.name, `items[${index}].name`),
    qty: requireInteger(body.qty, `items[${index}].qty`),
    price: body.price == null ? undefined : requireNumber(body.price, `items[${index}].price`),
    lineTotal: body.lineTotal == null ? undefined : requireNumber(body.lineTotal, `items[${index}].lineTotal`),
  };
}

function parseSyncEvent(body: JsonMap): SyncEventInput {
  return {
    id: requireString(body.id, 'id'),
    entityType: requireString(body.entityType, 'entityType'),
    entityId: requireString(body.entityId, 'entityId'),
    action: requireString(body.action, 'action'),
    payload: body.payload == null ? undefined : asMap(body.payload),
    payloadJson: optionalString(body.payloadJson, 'payloadJson'),
    status: optionalString(body.status, 'status'),
    retryCount: body.retryCount == null ? undefined : requireInteger(body.retryCount, 'retryCount'),
    lastError: nullableString(body.lastError),
    createdAt: nullableString(body.createdAt),
    updatedAt: nullableString(body.updatedAt),
  };
}

function readPayload(event: SyncEventInput) {
  if (event.payload) return event.payload;
  if (event.payloadJson) {
    try {
      return asMap(JSON.parse(event.payloadJson));
    } catch (_) {
      throw new ApiError(400, 'Invalid payloadJson.');
    }
  }
  return {};
}

async function readJson(request: Request): Promise<JsonMap> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    return asMap(JSON.parse(raw));
  } catch (_) {
    throw new ApiError(400, 'Invalid JSON payload.');
  }
}

function asMap(value: unknown): JsonMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Expected a JSON object.');
  }
  return value as JsonMap;
}

function requiredSegment(value: string | undefined, name: string) {
  if (!value) throw new ApiError(400, `${name} is required.`);
  return value;
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, `${name} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string) {
  if (value == null || value === '') return undefined;
  return requireString(value, name);
}

function nullableString(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireNumber(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new ApiError(400, `${name} must be a valid non-negative number.`);
  }
  return number;
}

function requireInteger(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new ApiError(400, `${name} must be a valid integer.`);
  }
  return number;
}

function nullableNumber(value: unknown) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function requireBoolean(value: unknown, name: string) {
  if (typeof value !== 'boolean') {
    throw new ApiError(400, `${name} must be true or false.`);
  }
  return value;
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringArray(value: unknown, name: string) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ApiError(400, `${name} must be an array.`);
  return value.map((item) => String(item));
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseImageDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) {
    throw new ApiError(400, 'Invalid image data URL.');
  }
  return {
    contentType: match[1],
    base64: match[2],
  };
}

function decodeBase64(value: string) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new ApiError(400, 'Invalid base64 image payload.');
  }
}

function extensionForContentType(contentType: string) {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function sanitizeFileName(value: string) {
  const fallback = `menu-image${extensionForContentType('image/jpeg')}`;
  const cleanName = value
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
    .replaceAll(/-+/g, '-')
    .slice(0, 96);
  return cleanName || fallback;
}

function buildOrderNo() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  return `ORD-${stamp}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function canTransitionOrderStatus(current: string, next: string) {
  if (current === next) return true;
  if (current === 'served') return next === 'served';
  if (next === 'cancelled') return current !== 'served';
  if (current === 'cancelled') return next === 'cancelled';
  return statusPriority[next] >= statusPriority[current];
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: unknown) {
  if (value == null) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePath(pathname: string) {
  let path = pathname;
  for (const prefix of ['/functions/v1/pos-api', '/pos-api']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length);
      break;
    }
  }
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function json(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: responseHeaders(),
  });
}

function html(body: string, statusCode = 200) {
  return new Response(body, {
    status: statusCode,
    headers: {
      ...responseHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

function errorJson(error: unknown) {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  return json({
    ok: false,
    error: error instanceof Error ? error.message : 'Internal server error.',
    details: error instanceof ApiError ? error.details : undefined,
  }, statusCode);
}

function responseHeaders() {
  return {
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Origin, Content-Type, Accept, Authorization, Idempotency-Key, apikey, x-client-info',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function throwIf(error: unknown) {
  if (!error) return;
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message: unknown }).message)
    : 'Database request failed.';
  throw new ApiError(500, message, error);
}
