CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  artist_name TEXT,
  artist_email TEXT,
  normalized_artist_email TEXT,
  plan_label TEXT NOT NULL DEFAULT 'Full license',
  max_redemptions INTEGER NOT NULL DEFAULT 1,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS promo_codes_status_idx
  ON promo_codes (status, expires_at, created_at);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id TEXT PRIMARY KEY,
  promo_code_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  recipient_name TEXT,
  redeemed_at TEXT NOT NULL,
  FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_code_email_idx
  ON promo_redemptions (promo_code_id, normalized_email);

CREATE INDEX IF NOT EXISTS promo_redemptions_purchase_idx
  ON promo_redemptions (purchase_id);
