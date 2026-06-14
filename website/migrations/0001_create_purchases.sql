CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent TEXT,
  stripe_customer_id TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  amount_total INTEGER,
  currency TEXT,
  license_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS purchases_normalized_email_idx
  ON purchases (normalized_email, license_status, created_at);

CREATE INDEX IF NOT EXISTS purchases_stripe_customer_idx
  ON purchases (stripe_customer_id);
