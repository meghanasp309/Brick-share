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

Coming next (see the plan): trading, rent payouts, and `frontend/` (Next.js).

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
git checkout claude/project-thread-2rs36c
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

The tests use their own database (`brickshare_test`), so your data is safe. They take about 1-2 minutes, because each blockchain step waits for a new block.

### If something goes wrong

- **"docker: command not found" or "cannot connect"**: Docker Desktop isn't running. Open it first.
- **"port is already allocated"**: something else uses port 8545. Close it, or change the port in `network/docker-compose.yml`.
- **Nodes stuck on block 0**: run `docker compose down -v` and then `docker compose up -d` again.
- **Backend says "Can't reach the database"**: run `docker compose up -d` inside `backend`.
- **"Razorpay refused the order"**: check `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `backend/.env`, or delete both to use fake payments.
- **Port 5432 already in use**: you have another PostgreSQL installed. Stop it, or change the port in `backend/docker-compose.yml` and `DATABASE_URL` in `.env`.
- **You reset the blockchain** (`down -v`) but not the database: old properties point to contracts that no longer exist. Reset the database too: `cd backend` then `docker compose down -v` and `docker compose up -d`.

## The backend, in simple words

The backend is the middle part between the app and the blockchain.

- **Login with roles**: investor, owner, admin, land authority. Anyone can sign up as an investor or owner.
- **Custodial wallets**: every user gets a blockchain wallet when they sign up. The server keeps its key locked (encrypted), so users never touch crypto.
- **KYC (simulated)**: a user uploads a photo of their ID. An admin approves it, and the server adds the user's wallet to the whitelist of every property on the chain.
- **Listing**: an owner with approved KYC lists a property. The server deploys a new `PropertyToken` contract for it (Pending). The Land Authority approves it, and all shares go to the owner. The Land Authority can also freeze it.
- **Buying shares**: a verified investor picks a property and a number of shares, and pays in rupees with Razorpay (test mode). When the payment is confirmed, the server moves the shares from the owner's wallet to the investor's wallet on the blockchain.
- **Portfolio**: shows your shares (read from the blockchain), what they're worth, and your full history.
- **The database** only keeps things like names, emails, photos and orders. Who owns which shares is always read from the blockchain.

### How buying works

1. `POST /orders` with `{ propertyId, shares }`. The shares are held for you for 15 minutes.
2. You pay. The app gets 3 values back from Razorpay: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
3. `POST /orders/:id/verify` with those 3 values. The server checks the signature (proof that you really paid), then sends the shares to your wallet.
4. If the blockchain refuses (for example, the property got frozen), the order becomes `failed`. You already paid, so your shares stay held. Try again later with `POST /orders/:id/retry`.

**No Razorpay account? No problem.** Without keys the server uses fake payments ("mock" mode). Skip step 2 and call `POST /orders/:id/mock-pay` instead of `verify`.

**Want real Razorpay test mode?** Sign up at https://dashboard.razorpay.com, switch to **Test Mode**, and create API keys. Put them in `backend/.env` as `RAZORPAY_KEY_ID` (starts with `rzp_test_`) and `RAZORPAY_KEY_SECRET`. The server refuses live keys, so no real money can move. The payment screen itself (Razorpay Checkout) comes with the frontend.

Try it in PowerShell (after an investor has passed KYC and a property is approved):

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType "application/json" -Body '{"email":"you@example.com","password":"password123"}'
$h = @{ Authorization = "Bearer $($login.token)" }
$o = Invoke-RestMethod -Method Post -Uri http://localhost:4000/orders -Headers $h -ContentType "application/json" -Body '{"propertyId":1,"shares":50}'
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/orders/$($o.order.id)/mock-pay" -Headers $h
Invoke-RestMethod -Uri http://localhost:4000/portfolio -Headers $h | ConvertTo-Json -Depth 5
```

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
| GET | `/properties/:id` | anyone | One listing, its live state from the chain, and `sharesForSale` |
| POST | `/properties` | owner (KYC done) | Form: `name`, `symbol`, `location`, `description`, `totalShares`, `pricePerShare`, optional file `papers` |
| POST | `/properties/:id/approve` | land authority | Approve on-chain, shares go to the owner |
| POST | `/properties/:id/freeze` | land authority | `{ reason }` |
| POST | `/properties/:id/unfreeze` | land authority | Lift the freeze |
| POST | `/orders` | investor (KYC done) | `{ propertyId, shares }`, returns the order and the Razorpay Checkout details |
| GET | `/orders` | logged in | Your orders |
| GET | `/orders/:id` | buyer, admin | One order |
| POST | `/orders/:id/verify` | buyer | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`, then shares are sent |
| POST | `/orders/:id/mock-pay` | buyer | Fake payment (only when no Razorpay keys are set) |
| POST | `/orders/:id/retry` | buyer, admin | Send the shares again for a `failed` order |
| GET | `/admin/orders?status=failed` | admin | All orders, optionally by status |
| GET | `/portfolio` | logged in | Your shares, their value and what you paid |
| GET | `/transactions` | logged in | Every share movement in or out of your wallet (from the chain) |

If you change the contract, copy the new version into the backend: `cd contracts`, then `npm run compile` and `npm run export-abi`.

## Test accounts

The 5 accounts in `contracts/hardhat.config.js` (BrickShare admin, Land Authority, property owner, 2 investors) are **for testing only**. Their keys are public. Never put real money on them.
