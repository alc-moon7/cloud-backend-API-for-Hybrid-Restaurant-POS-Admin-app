CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
  outlet_id TEXT REFERENCES outlets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_otps (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_otps_phone_created
  ON owner_otps(phone, created_at DESC);

CREATE TABLE IF NOT EXISTS owner_payment_sessions (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BDT',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restaurant_subscriptions (
  restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  plan_code TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BDT',
  payment_method TEXT NOT NULL,
  payment_session_id TEXT NOT NULL,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restaurant_admin_credentials (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin',
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_credentials_restaurant_role
  ON restaurant_admin_credentials(restaurant_id, role);

CREATE TABLE IF NOT EXISTS outlet_configs (
  outlet_id TEXT PRIMARY KEY REFERENCES outlets(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'BDT',
  tax_rate NUMERIC(6, 2) NOT NULL DEFAULT 0,
  prep_time_minutes INTEGER NOT NULL DEFAULT 20,
  table_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  customer_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  printer_device_id TEXT,
  printer_connection_type TEXT NOT NULL DEFAULT 'none',
  printer_address TEXT,
  printer_paper_width INTEGER NOT NULL DEFAULT 80,
  auto_print_kitchen BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
