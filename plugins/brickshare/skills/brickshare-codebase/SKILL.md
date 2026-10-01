---
name: brickshare-codebase
description: Map of the BrickShare repo (Besu blockchain, PropertyToken contract, Express backend, Next.js website) and its rules. Use when answering questions about BrickShare or finding where something lives.
---

# BrickShare codebase

BrickShare is a marketplace for **fractional real estate**. An owner splits a
property into shares (tokens). Verified investors buy, hold and trade them,
and get rent. Users pay in rupees (Razorpay test mode or fake payments);
they never see crypto.

## Where things live

| Folder | What it is | Main files |
|---|---|---|
| `network/` | Private blockchain: 4 Besu nodes in Docker (2 BrickShare, 1 property company, 1 Land Authority) | `docker-compose.yml` |
| `contracts/` | Solidity + Hardhat. One `PropertyToken` contract per property, one token per share | `contracts/PropertyToken.sol`, `test/`, `scripts/export-abi.js` |
| `backend/` | Node + Express API on port 4000, PostgreSQL, IPFS | `src/app.js` (all routes), `src/routes/*.js`, `src/db/schema.sql`, `tests/` |
| `frontend/` | Next.js website on port 3000 | `src/app/<page>/page.js`, `src/components/`, `src/lib/api.js` |
| `docker-compose.yml` (root) | Starts network + database + IPFS together | |

## Rules that must not break

- **Who owns which shares is read from the blockchain**, never stored as the
  truth in PostgreSQL. The database holds off-chain data only (users, KYC,
  orders, rupee wallet, trades history).
- The contract enforces: only whitelisted (KYC-approved) wallets hold shares;
  the Land Authority approves and can `freeze()` a property; a frozen
  property moves no shares and pays no rent.
- Wallets are **custodial**: the backend keeps each user's key encrypted
  (`WALLET_SECRET`). Never log or return private keys.
- Money is stored in **paise** (whole numbers), shown as rupees.
- Roles: `investor`, `owner`, `admin`, `land_authority`.

## Gotchas

- Besu only searches 5000 blocks of logs at a time. Read events in chunks
  (see how `src/chain.js` does it).
- After changing `PropertyToken.sol`: `npm run compile` then
  `npm run export-abi` in `contracts`. That rewrites
  `backend/src/chain/PropertyToken.json`. Don't edit that file by hand.
- Backend tests use a separate `brickshare_test` database and need Docker
  running. A new table must also be added to the `DROP TABLE` list in
  `backend/tests/setup.js`.
- Code and docs are written in **simple, plain English** for a student
  reader. Keep comments short and friendly like the existing ones.

For running things, see the `/brickshare:demo`, `/brickshare:test` and
`/brickshare:status` commands, or `README.md`.
