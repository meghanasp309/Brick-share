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

-- ---------- Phase 4: rupee wallet and stock-app trading ----------

-- Each investor's rupee balance inside the app (test money).
-- Money comes in through Razorpay (test mode) and is used to buy shares
-- from other investors. Every change is also written to cash_entries.
CREATE TABLE IF NOT EXISTS cash_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0)
);

-- Adding money to the wallet.
--   created -> waiting for payment
--   paid    -> money is in the wallet
CREATE TABLE IF NOT EXISTS deposits (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0),
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid')),
  payment_mode        TEXT NOT NULL CHECK (payment_mode IN ('razorpay', 'mock')),
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Buy and sell orders on the order book (limit orders).
--   open      -> waiting on the book (maybe partly filled)
--   filled    -> all shares traded
--   cancelled -> the investor cancelled the rest
CREATE TABLE IF NOT EXISTS book_orders (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  property_id   INTEGER NOT NULL REFERENCES properties(id),
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  price_paise   BIGINT NOT NULL CHECK (price_paise > 0), -- limit price per share
  shares        INTEGER NOT NULL CHECK (shares > 0),
  filled_shares INTEGER NOT NULL DEFAULT 0 CHECK (filled_shares >= 0 AND filled_shares <= shares),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_orders_open_idx ON book_orders (property_id, side, price_paise, id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS book_orders_user_idx ON book_orders (user_id);

-- A match between a buy order and a sell order.
--   settling -> matched; shares are moving on the chain
--   settled  -> shares moved; money moved from buyer to seller
--   failed   -> the chain said no (e.g. frozen). Money and shares stay held. Can be retried.
CREATE TABLE IF NOT EXISTS trades (
  id             SERIAL PRIMARY KEY,
  property_id    INTEGER NOT NULL REFERENCES properties(id),
  buy_order_id   INTEGER NOT NULL REFERENCES book_orders(id),
  sell_order_id  INTEGER NOT NULL REFERENCES book_orders(id),
  buyer_id       INTEGER NOT NULL REFERENCES users(id),
  seller_id      INTEGER NOT NULL REFERENCES users(id),
  shares         INTEGER NOT NULL CHECK (shares > 0),
  price_paise    BIGINT NOT NULL CHECK (price_paise > 0),
  amount_paise   BIGINT NOT NULL CHECK (amount_paise > 0),
  status         TEXT NOT NULL DEFAULT 'settling' CHECK (status IN ('settling', 'settled', 'failed')),
  tx_hash        TEXT,
  failure_reason TEXT,
  settled_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trades_property_idx ON trades (property_id, created_at);
CREATE INDEX IF NOT EXISTS trades_buyer_idx ON trades (buyer_id);
CREATE INDEX IF NOT EXISTS trades_seller_idx ON trades (seller_id);

-- Every change to a rupee balance: + money in, - money out.
CREATE TABLE IF NOT EXISTS cash_entries (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'buy', 'sell', 'rent')),
  amount_paise BIGINT NOT NULL,
  deposit_id   INTEGER REFERENCES deposits(id),
  trade_id     INTEGER REFERENCES trades(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_entries_user_idx ON cash_entries (user_id, id);

-- ---------- Phase 5: rent payouts and documents on IPFS ----------

-- Rent paid by an owner (or admin) for one property, then shared out to
-- everyone holding shares, in proportion to their shares.
--   created     -> waiting for payment
--   paid        -> money received; now recording it on the chain
--   distributed -> recorded on the chain, and every holder's wallet was credited
-- A paid payout on a frozen property waits (failure_reason says why) and is
-- shared out automatically when the Land Authority unfreezes it.
CREATE TABLE IF NOT EXISTS rent_payouts (
  id                  SERIAL PRIMARY KEY,
  property_id         INTEGER NOT NULL REFERENCES properties(id),
  paid_by             INTEGER NOT NULL REFERENCES users(id),
  amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0),
  period              TEXT NOT NULL DEFAULT '', -- e.g. "October 2026"
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'distributed')),
  payment_mode        TEXT NOT NULL CHECK (payment_mode IN ('razorpay', 'mock')),
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  tx_hash             TEXT,
  chain_payout_id     INTEGER, -- the payout's number in the property contract
  snapshot_id         INTEGER, -- share balances were counted at this snapshot
  failure_reason      TEXT,
  paid_at             TIMESTAMPTZ,
  distributed_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rent_payouts_property_idx ON rent_payouts (property_id, id);

-- Rent lands in the rupee wallet as a 'rent' entry.
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS rent_payout_id INTEGER REFERENCES rent_payouts(id);
-- Databases made before phase 5 don't allow 'rent' yet.
ALTER TABLE cash_entries DROP CONSTRAINT IF EXISTS cash_entries_kind_check;
ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_kind_check
  CHECK (kind IN ('deposit', 'withdrawal', 'buy', 'sell', 'rent'));

-- Property papers stored on IPFS. The CID (the file's fingerprint) is also
-- saved in the property contract, so anyone can check a file wasn't changed.
CREATE TABLE IF NOT EXISTS property_documents (
  id          SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  kind        TEXT NOT NULL,
  cid         TEXT NOT NULL,
  chain_index INTEGER, -- position in the contract's document list; NULL = the listing papers (documentHash)
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  tx_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_documents_property_idx ON property_documents (property_id, id);
