# BrickShare

A peer-to-peer marketplace for **fractional real estate**. An owner splits a property into digital shares (tokens), and verified investors buy, hold and trade them.

> Demo project. Test money only.

## What's in here (so far)

```
brick-share/
├── network/     Private blockchain: 4 Besu nodes in Docker
├── contracts/   Smart contracts (Solidity + Hardhat)
└── backend/     API server (Node + Express + PostgreSQL)
```

Coming next (see the plan): Razorpay buying, trading, and `frontend/` (Next.js).

### The blockchain, in simple words

- A **blockchain** is a shared record book. Every node keeps a full copy, so nobody can secretly change who owns what.
- Ours is **private**: only 4 approved nodes can join. Two are run by BrickShare, one by a property company, and one by the Land Authority.
- Every 2 seconds the nodes vote on a new page (block) of the book. If one node goes down, the other 3 keep going.

### The smart contract: `PropertyToken`

One contract = one property. One token = one share. It follows these rules:

1. When a property is listed, it is **Pending** and has no shares.
2. The **Land Authority** checks the papers and calls `approveProperty()`. All shares (e.g. 10,000) go to the owner.
3. **BrickShare** does KYC and adds investors to a **whitelist**. Only whitelisted people can hold shares.
4. Whitelisted people can transfer (buy/sell) shares.
5. If there's a legal dispute, the Land Authority can `freeze()` the property. Then **nobody** can move shares, not even BrickShare. `unfreeze()` lifts it.

The contract itself checks these rules, so no app or person can skip them.

## How to run it on your laptop (Windows)

### 1. Install these once

- **Docker Desktop**: https://www.docker.com/products/docker-desktop/ (keep the default "WSL 2" option). Open it and wait until it says "Engine running".
- **Node.js 22 LTS**: https://nodejs.org
- **Git**: you already have it.

### 2. Get the code

In PowerShell, inside your `brick-share` folder:

```powershell
git fetch
git checkout claude/project-thread-7czfxz
```

(Once this is merged, just use `git checkout main` and `git pull`.)

### 3. Start the blockchain

```powershell
cd network
docker compose up -d
```

The first time, Docker downloads Besu (about 500 MB). Then wait about 20 seconds.

### 4. Check that all 4 nodes agree

```powershell
cd ..\contracts
npm install
npm run nodes
```

You should see all 4 nodes on the **same block number and hash**. Run it again: the number goes up.

### 5. Test and try the contract

```powershell
npm test       # runs 8 tests on a quick built-in test chain
npm run demo   # plays the full story on YOUR Besu network
```

The demo lists a property, has the Land Authority approve it, whitelists an investor, sells them 50 shares, freezes the property (the next transfer is blocked), then unfreezes it.

### 6. Stop it

```powershell
cd ..\network
docker compose stop      # pause, keep the chain
docker compose down -v   # delete everything and start fresh next time
```

### 7. Start the backend (API server)

Keep the blockchain running (step 3). Then:

```powershell
cd ..\backend
docker compose up -d     # starts the database (PostgreSQL)
npm install
npm start
```

Open http://localhost:4000/health in your browser. You should see `"ok": true` and the block number.

The first start creates two accounts for you:

| Role | Email | Password |
|---|---|---|
| Admin | admin@brickshare.test | admin123 |
| Land Authority | land@brickshare.test | land123 |

To change settings (port, passwords), copy `.env.example` to `.env` and edit it.

### 8. Run the backend tests

With the blockchain and the database both running:

```powershell
npm test
```

The tests use their own database (`brickshare_test`), so your data is safe. They take about 40 seconds, because each blockchain step waits for a new block.

### If something goes wrong

- **"docker: command not found" or "cannot connect"**: Docker Desktop isn't running. Open it first.
- **"port is already allocated"**: something else uses port 8545. Close it, or change the port in `network/docker-compose.yml`.
- **Nodes stuck on block 0**: run `docker compose down -v` and then `docker compose up -d` again.
- **Backend says "Can't reach the database"**: run `docker compose up -d` inside `backend`.
- **Port 5432 already in use**: you have another PostgreSQL installed. Stop it, or change the port in `backend/docker-compose.yml` and `DATABASE_URL` in `.env`.
- **You reset the blockchain** (`down -v`) but not the database: old properties point to contracts that no longer exist. Reset the database too: `cd backend` then `docker compose down -v` and `docker compose up -d`.

## The backend, in simple words

The backend is the middle part between the app and the blockchain.

- **Login with roles**: investor, owner, admin, land authority. Anyone can sign up as an investor or owner.
- **Custodial wallets**: every user gets a blockchain wallet when they sign up. The server keeps its key locked (encrypted), so users never touch crypto.
- **KYC (simulated)**: a user uploads a photo of their ID. An admin approves it, and the server adds the user's wallet to the whitelist of every property on the chain.
- **Listing**: an owner with approved KYC lists a property. The server deploys a new `PropertyToken` contract for it (Pending). The Land Authority approves it, and all shares go to the owner. The Land Authority can also freeze it.
- **The database** only keeps things like names, emails and photos. Who owns which shares is always read from the blockchain.

### API list

Send the login token as a header: `Authorization: Bearer <token>`.

| Method | URL | Who | What it does |
|---|---|---|---|
| GET | `/health` | anyone | Is everything running? |
| POST | `/auth/signup` | anyone | `{ email, password, fullName, role: "investor" or "owner" }` |
| POST | `/auth/login` | anyone | `{ email, password }`, returns a token |
| GET | `/me` | logged in | Your profile, wallet and KYC status |
| POST | `/kyc` | investor, owner | Form: `idType` (aadhaar/pan/passport), `idNumber`, file `document` |
| GET | `/kyc` | logged in | Your KYC status |
| GET | `/admin/kyc?status=pending` | admin | KYC waiting for review |
| GET | `/admin/kyc/:id/document` | admin | See the uploaded ID |
| POST | `/admin/kyc/:id/approve` | admin | Approve, and whitelist the wallet on-chain |
| POST | `/admin/kyc/:id/reject` | admin | `{ note }` |
| GET | `/admin/users` | admin | All users |
| GET | `/properties` | anyone | All listings (`?status=pending` or `approved`) |
| GET | `/properties/:id` | anyone | One listing, plus its live state from the chain |
| POST | `/properties` | owner (KYC done) | Form: `name`, `symbol`, `location`, `description`, `totalShares`, `pricePerShare`, optional file `papers` |
| POST | `/properties/:id/approve` | land authority | Approve on-chain, shares go to the owner |
| POST | `/properties/:id/freeze` | land authority | `{ reason }` |
| POST | `/properties/:id/unfreeze` | land authority | Lift the freeze |

If you change the contract, copy the new version into the backend: `cd contracts`, then `npm run compile` and `npm run export-abi`.

## Test accounts

The 5 accounts in `contracts/hardhat.config.js` (BrickShare admin, Land Authority, property owner, 2 investors) are **for testing only**. Their keys are public. Never put real money on them.
