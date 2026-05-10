CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_email_lower
  ON admin_accounts (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_username_lower
  ON admin_accounts (lower(username));

CREATE INDEX IF NOT EXISTS idx_admin_accounts_outlet
  ON admin_accounts (outlet_id)
  WHERE is_active = true;

ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name, updated_at)
VALUES ('rest_c46f1be2fa034b11b0', 'Moon Test 4', now())
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = now();

INSERT INTO outlets (id, restaurant_id, name, updated_at)
VALUES (
  'outlet_0884a3c2b8314bfb9c',
  'rest_c46f1be2fa034b11b0',
  'Moon Test 4 Outlet',
  now()
)
ON CONFLICT (id) DO UPDATE
SET restaurant_id = EXCLUDED.restaurant_id,
    name = EXCLUDED.name,
    updated_at = now();

INSERT INTO admin_accounts (
  id,
  restaurant_id,
  outlet_id,
  email,
  username,
  password_salt,
  password_hash,
  role,
  is_active,
  updated_at
)
VALUES (
  'admin_moon_test_4_owner',
  'rest_c46f1be2fa034b11b0',
  'outlet_0884a3c2b8314bfb9c',
  'zero@moonx.dev',
  'moonx',
  '3f72596131f9e071297924cf6b8a747a',
  '6d5a87083f27ad6fad69dc70a8be5ab70d5de2cf2d1e7fab075166734944b0bc',
  'owner',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE
SET restaurant_id = EXCLUDED.restaurant_id,
    outlet_id = EXCLUDED.outlet_id,
    email = EXCLUDED.email,
    username = EXCLUDED.username,
    password_salt = EXCLUDED.password_salt,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    updated_at = now();
