# Hybrid POS Cloud Backend API

Express + TypeScript + PostgreSQL backend for the Hybrid Restaurant POS Admin app.

## Setup

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

## Flutter Admin Settings

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

## Endpoints

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
