CREATE TABLE IF NOT EXISTS payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'bkash',
  mode TEXT NOT NULL DEFAULT 'sandbox',
  purpose TEXT NOT NULL DEFAULT 'admin_activation',
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  merchant_invoice_number TEXT NOT NULL UNIQUE,
  payment_id TEXT UNIQUE,
  transaction_id TEXT,
  checkout_url TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  raw_create JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_execute JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_server_created
  ON payment_sessions(server_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_payment_id
  ON payment_sessions(payment_id)
  WHERE payment_id IS NOT NULL;

ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
