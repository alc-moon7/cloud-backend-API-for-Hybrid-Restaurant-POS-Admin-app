CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outlets (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  restaurant_name TEXT NOT NULL,
  outlet_name TEXT NOT NULL,
  local_ip TEXT,
  local_port INTEGER,
  local_server_running BOOLEAN NOT NULL DEFAULT false,
  device_token_hash TEXT,
  token_issued_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  price NUMERIC(12, 2) NOT NULL,
  image_url TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  preparation_time_minutes INTEGER,
  tags TEXT[] NOT NULL DEFAULT '{}',
  sync_status TEXT NOT NULL DEFAULT 'synced',
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  app_created_at TIMESTAMPTZ,
  app_updated_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  order_no TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cloud',
  customer_name TEXT,
  table_no TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  version INTEGER NOT NULL DEFAULT 1,
  app_created_at TIMESTAMPTZ,
  app_updated_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(outlet_id, order_no)
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'synced',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  app_created_at TIMESTAMPTZ,
  app_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4 CHECK (seats > 0),
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_outlet_updated
  ON menu_items(outlet_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_outlet_updated
  ON orders(outlet_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_outlet_status
  ON orders(outlet_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_events_outlet_updated
  ON sync_events(outlet_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_devices_outlet_token
  ON devices(outlet_id, device_token_hash)
  WHERE device_token_hash IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_tables_outlet_name
  ON tables(outlet_id, name);
