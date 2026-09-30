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
