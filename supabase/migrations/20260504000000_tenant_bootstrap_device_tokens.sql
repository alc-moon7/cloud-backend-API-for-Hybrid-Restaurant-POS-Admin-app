ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS device_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS token_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_devices_outlet_token
  ON devices(outlet_id, device_token_hash)
  WHERE device_token_hash IS NOT NULL AND is_active = true;
