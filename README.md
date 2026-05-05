# Hybrid POS Cloud Backend API

Cloud backend for the Hybrid Restaurant POS Admin app.

This repo now supports two deployment paths:

- **Supabase Edge Function**: recommended for the no-manual-API-key app flow.
- **Express + PostgreSQL**: legacy Node server path for Render/Railway/VPS hosting.

## Recommended: Supabase Edge Function

The Admin app can call this public function URL without manually entering an API
key:

```txt
https://YOUR_PROJECT_REF.supabase.co/functions/v1/pos-api
```

Secrets stay inside Supabase Edge Functions. Do not put the Supabase service role
key, database password, or database URL inside the Flutter app.

### Supabase setup

1. Create a Supabase project from the Supabase dashboard.
2. Install the Supabase CLI.
3. Login and link this repo:

```sh
cd /home/moon-ahmed/Documents/GitHub/cloud-backend-API-for-Hybrid-Restaurant-POS-Admin-app
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

4. Push the database schema:

```sh
supabase db push
```

5. Deploy the Edge Function:

```sh
supabase functions deploy pos-api --no-verify-jwt
```

`--no-verify-jwt` is intentional because the Admin APK does not use Supabase
user JWT login. Production tenant security is handled by the Edge Function:
the app calls `POST /tenants/bootstrap` once, receives a private device token,
and then sends that token as `Authorization: Bearer <deviceToken>` for Admin
sync/write APIs. Restaurant owners never paste API keys manually.

6. Test the live function:

```sh
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/pos-api/health
```

Expected shape:

```json
{
  "ok": true,
  "server": "hybrid-pos-cloud",
  "mode": "cloud",
  "database": true
}
```

7. Build the Admin APK with the function URL built in:

```sh
cd /home/moon-ahmed/Documents/GitHub/Restuarent_POS_Admin_APP
flutter build apk --release \
  --dart-define=POS_CLOUD_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/pos-api \
  --dart-define=POS_CLOUD_SYNC_ENABLED=true
```

The production Supabase URL can also be built into the app as the default. After
first launch, the Admin app creates the restaurant/outlet identity automatically.

### Cloud realtime

`pos-api` uses Supabase Realtime Broadcast for cloud WebSocket updates. The
function publishes these events to:

```txt
pos:outlet:<outletId>
```

Events:

- `device_registered`
- `device_heartbeat`
- `menu_updated`
- `order_created`
- `order_status_updated`

The Admin app reads the realtime configuration from:

```txt
GET /health
```

So the APK build still only needs:

```sh
--dart-define=POS_CLOUD_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/pos-api
--dart-define=POS_CLOUD_SYNC_ENABLED=true
```

No manual API key is required inside the app. The migration
`20260503001000_enable_rls_for_public_tables.sql` enables RLS on app tables so
the public/publishable key cannot directly read or write POS tables; all table
writes still go through the Edge Function service role.

### bKash sandbox activation

The Admin APK uses a payment gate before restaurant setup:

```txt
Splash -> bKash Sandbox Payment -> Restaurant Setup -> Dashboard
```

bKash credentials must stay in Supabase secrets, never inside the Flutter APK.
After bKash gives sandbox PGW credentials, set them like this:

```sh
cd /home/moon-ahmed/Documents/GitHub/cloud-backend-API-for-Hybrid-Restaurant-POS-Admin-app

npx supabase secrets set \
  BKASH_MODE=sandbox \
  BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout \
  BKASH_APP_KEY=YOUR_SANDBOX_APP_KEY \
  BKASH_APP_SECRET=YOUR_SANDBOX_APP_SECRET \
  BKASH_USERNAME=YOUR_SANDBOX_USERNAME \
  BKASH_PASSWORD=YOUR_SANDBOX_PASSWORD \
  BKASH_CALLBACK_URL=https://vnhxfvtpkgykatvbrczn.supabase.co/functions/v1/pos-api/payments/bkash/callback

npx supabase functions deploy pos-api --no-verify-jwt
```

Payment endpoints:

- `POST /payments/bkash/create`
- `GET /payments/bkash/:paymentId/status`
- `POST /payments/bkash/:paymentId/verify`
- `GET /payments/bkash/callback`

The callback executes the bKash payment server-side, stores the session in
`payment_sessions`, and the app verifies the payment before opening restaurant
setup.

Sandbox checkout test values after bKash returns a fresh checkout page:

```txt
Wallet: 01770618575
OTP: 123456
PIN: 12121
```

The sample checkout URL from the bKash demo page is not stored because it is a
single generated payment session. Production code must always call
`POST /payments/bkash/create` and use the fresh `bkashURL` returned by bKash.

### Supabase API endpoints

- `GET /health`
- `POST /payments/bkash/create`
- `GET /payments/bkash/:paymentId/status`
- `POST /payments/bkash/:paymentId/verify`
- `GET /payments/bkash/callback`
- `POST /tenants/bootstrap`
- `POST /devices/register`
- `POST /devices/heartbeat`
- `GET /outlets/:outletId/menu`
- `POST /outlets/:outletId/menu/images`
- `POST /outlets/:outletId/menu`
- `PATCH /outlets/:outletId/menu/:id`
- `DELETE /outlets/:outletId/menu/:id`
- `GET /outlets/:outletId/orders`
- `POST /outlets/:outletId/orders`
- `GET /outlets/:outletId/orders/:id`
- `PATCH /outlets/:outletId/orders/:id/status`
- `GET /outlets/:outletId/sync/pull`
- `POST /outlets/:outletId/sync/push`

All write endpoints accept `Idempotency-Key`.

Admin-only endpoints require the device token issued by
`POST /tenants/bootstrap`:

- `POST/PATCH/DELETE /outlets/:outletId/menu`
- `POST /outlets/:outletId/menu/images`
- `GET /outlets/:outletId/orders`
- `PATCH /outlets/:outletId/orders/:id/status`
- `GET /outlets/:outletId/sync/pull`
- `POST /outlets/:outletId/sync/push`
- `POST /devices/register`
- `POST /devices/heartbeat`

Customer-facing endpoints remain public by `outletId`:

- `GET /outlets/:outletId/menu`
- `POST /outlets/:outletId/orders`
- `GET /outlets/:outletId/orders/:id`

## Legacy: Express + PostgreSQL

### Legacy setup

```sh
cp .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run dev
```

API base URL:

```txt
http://localhost:4000
```

Swagger UI:

```txt
http://localhost:4000/api-docs
```

OpenAPI JSON:

```txt
http://localhost:4000/openapi.json
```

The Swagger document is generated with `swagger-jsdoc` and served by
`swagger-ui-express`. It documents the current Express routes, request bodies,
path/query/header parameters, response examples, error responses, idempotency
headers, and bearer auth. If `DEVICE_API_TOKEN` is set in `.env`, use the
Swagger **Authorize** button with:

```txt
Bearer YOUR_DEVICE_API_TOKEN
```

Admin WebSocket:

```txt
ws://localhost:4000/ws/admin
```

### Flutter Admin Settings for legacy Express

For local development on an Android emulator:

```txt
http://10.0.2.2:4000
```

For a physical phone, use your computer LAN IP or a tunnel:

```txt
http://YOUR_COMPUTER_LAN_IP:4000
```

If `DEVICE_API_TOKEN` is set in `.env`, put the same value in the Admin app
`Device token / API key` field.

### Legacy endpoints

- `GET /health`
- `POST /devices/register`
- `POST /devices/heartbeat`
- `GET /outlets/:outletId/menu`
- `POST /outlets/:outletId/menu`
- `PATCH /outlets/:outletId/menu/:id`
- `DELETE /outlets/:outletId/menu/:id`
- `GET /outlets/:outletId/orders`
- `POST /outlets/:outletId/orders`
- `PATCH /outlets/:outletId/orders/:id/status`
- `GET /outlets/:outletId/sync/pull`
- `POST /outlets/:outletId/sync/push`
- `WS /ws/admin`

All write endpoints accept `Idempotency-Key`.
