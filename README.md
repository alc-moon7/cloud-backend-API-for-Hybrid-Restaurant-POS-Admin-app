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

`--no-verify-jwt` is intentional for this MVP because the Admin APK should not
need a manually pasted API key. Add restaurant/device authentication before
public multi-tenant production.

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

After this, the Admin app does not require a manual Device token / API key.

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

### Supabase API endpoints

- `GET /health`
- `POST /devices/register`
- `POST /devices/heartbeat`
- `GET /outlets/:outletId/menu`
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
