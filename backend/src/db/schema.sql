-- BrickShare database. Only off-chain data lives here.
-- Who owns which shares is always read from the blockchain.
-- Safe to run many times: it only creates what is missing.

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('investor', 'owner', 'admin', 'land_authority')),
  -- Custodial wallet: BrickShare holds the key, encrypted, so users never touch crypto.
  wallet_address TEXT NOT NULL UNIQUE,
  wallet_key_enc TEXT NOT NULL,
  kyc_status     TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id_type       TEXT NOT NULL CHECK (id_type IN ('aadhaar', 'pan', 'passport')),
  id_last4      TEXT NOT NULL, -- we keep only the last 4 characters of the ID number
  document_path TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note   TEXT,
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS properties (
  id               SERIAL PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE, -- e.g. "BS-3F9A1C2E", also saved in the contract
  owner_id         INTEGER NOT NULL REFERENCES users(id),
  name             TEXT NOT NULL,
  symbol           TEXT NOT NULL,
  location         TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  total_shares     INTEGER NOT NULL CHECK (total_shares > 0),
  price_per_share  NUMERIC(12, 2) NOT NULL CHECK (price_per_share > 0), -- in INR
  document_hash    TEXT NOT NULL,
  document_path    TEXT,
  contract_address TEXT NOT NULL UNIQUE,
  -- Copies of the on-chain state, kept for fast listing and search.
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  frozen           BOOLEAN NOT NULL DEFAULT false,
  freeze_reason    TEXT,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A primary purchase: an investor buys shares from the property owner.
--   created   -> waiting for payment (shares are held for a few minutes)
--   paid      -> payment checked, shares are being moved on the chain
--   completed -> shares are in the investor's wallet
--   failed    -> paid, but the chain transfer failed. Can be retried.
CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  property_id         INTEGER NOT NULL REFERENCES properties(id),
  shares              INTEGER NOT NULL CHECK (shares > 0),
  price_per_share     NUMERIC(12, 2) NOT NULL,       -- in INR, at the time of the order
  amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0), -- 1 rupee = 100 paise
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'paid', 'completed', 'failed')),
  payment_mode        TEXT NOT NULL CHECK (payment_mode IN ('razorpay', 'mock')),
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  tx_hash             TEXT,
  failure_reason      TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  paid_at             TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_property_idx ON orders (property_id);
