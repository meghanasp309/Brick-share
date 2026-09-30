# BrickShare

A peer-to-peer marketplace for **fractional real estate**. An owner splits a property into digital shares (tokens), and verified investors buy, hold and trade them.

> Demo project. Test money only.

## What's in here

```
brick-share/
├── network/     Private blockchain: 4 Besu nodes in Docker
├── contracts/   Smart contracts (Solidity + Hardhat)
├── backend/     API server (Node + Express + PostgreSQL)
└── frontend/    Website (Next.js + Tailwind)
```

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
6. **Rent**: BrickShare calls `distributeRent()`. The contract takes a snapshot of who holds how many shares right then, and `rentOwed()` says each holder's part. A frozen property pays no rent.
7. **Papers**: the property papers are on IPFS. Their fingerprint (CID) is saved in the contract (`documentHash`, and `addDocument()` for more papers later), so anyone can check they were never changed.

The contract itself checks these rules, so no app or person can skip them.

## Quick start: the full demo in 5 steps

Install **Docker Desktop** and **Node.js 22** first (links in step 1 below). Then, in PowerShell, inside your `brick-share` folder:

```powershell
# 1. Start the 4 blockchain nodes, the database and IPFS (one command)
docker compose up -d

# 2. Start the backend (keep this window open)
cd backend
npm install
npm start
```

Open a **second** PowerShell window:

```powershell
# 3. Fill the app with demo data (people, 3 properties, trades, rent, a freeze)
cd backend
npm run demo-data

# 4. Start the website (keep this window open)
cd ..\frontend
npm install
npm run dev
```

5. Open http://localhost:3000 and log in with any of these:

| Who | Email | Password |
|---|---|---|
| Owner (Priya) | owner@demo.test | demo1234 |
| Investor (Alice) | alice@demo.test | demo1234 |
| Investor (Bob) | bob@demo.test | demo1234 |
| Admin | admin@brickshare.test | admin123 |
| Land Authority | land@brickshare.test | land123 |

**What to show, and what to say:** see [DEMO.md](DEMO.md). It is a 5-minute walk-through.

**Start over:** stop the backend (Ctrl+C), run `docker compose down -v` in the `brick-share` folder, then do the steps again.

The steps below explain each part on its own, in more detail.

## How to run it on your laptop (Windows)

### 1. Install these once

- **Docker Desktop**: https://www.docker.com/products/docker-desktop/ (keep the default "WSL 2" option). Open it and wait until it says "Engine running".
- **Node.js 22 LTS**: https://nodejs.org
- **Git**: you already have it.

### 2. Get the code

In PowerShell, inside your `brick-share` folder:

```powershell
git checkout main
git pull
```

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
npm test       # runs 13 tests on a quick built-in test chain
npm run demo   # plays the full story on YOUR Besu network
```

The demo lists a property, has the Land Authority approve it, whitelists an investor, sells them 50 shares, freezes the property (the next transfer is blocked), unfreezes it, and pays out rent.

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
docker compose up -d     # starts the database (PostgreSQL) and IPFS (for property papers)
npm install
npm start
```

The first time, Docker downloads PostgreSQL and IPFS (about 200 MB).

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

The tests use their own database (`brickshare_test`), so your data is safe. They take about 3-4 minutes, because each blockchain step waits for a new block.

### 9. Start the website

Keep the blockchain (step 3) and the backend (step 7) running. Open a **new** PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The footer shows a green dot and the block number when everything is connected.

Try the whole story (use 4 browser windows, or log out and in):

1. **Sign up** as an owner, and as two investors. Each one sends an ID on the KYC page (any image works).
2. **Log in as admin** (admin@brickshare.test / admin123). Approve the IDs.
3. **As the owner**, go to "My properties" and list a property with its papers.
4. **Log in as the Land Authority** (land@brickshare.test / land123). Check the papers and approve it.
5. **As an investor**, open the property and buy shares from the owner (fake payment).
6. **As the other investor**, add money on the Wallet page. Then open "Trade on the market" and buy. The chart, order book and trades update live on both screens.
7. **As the owner**, add money on the Wallet page, then on "My properties" turn on **Monthly rent** (e.g. ₹20,000). The first month is paid within a minute; click **Pay next month now** to see another month without waiting. Each investor sees their part on the Wallet and Portfolio pages.
8. **As the Land Authority**, freeze the property. A red banner appears, and nobody can buy or sell until you unfreeze it.

If the backend runs somewhere else, copy `frontend/.env.example` to `frontend/.env.local` and change `NEXT_PUBLIC_API_URL`.

### If something goes wrong

- **"docker: command not found" or "cannot connect"**: Docker Desktop isn't running. Open it first.
- **"port is already allocated"**: something else uses port 8545. Close it, or change the port in `network/docker-compose.yml`.
- **Nodes stuck on block 0**: run `docker compose down -v` and then `docker compose up -d` again.
- **Backend says "Can't reach the database"**: run `docker compose up -d` inside `backend`.
- **"Razorpay refused the order"**: check `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `backend/.env`, or delete both to use fake payments.
- **Port 5432 already in use**: you have another PostgreSQL installed. Stop it, or change the port in `backend/docker-compose.yml` and `DATABASE_URL` in `.env`.
- **"Not enough money in your wallet"**: add money first with `POST /wallet/deposits`. Money in your open buy orders is held, so cancel one to free it.
- **A trade stays "failed"**: the property is probably frozen. It goes through by itself after the Land Authority unfreezes it, or call `POST /trading/trades/:id/retry`.
- **"Can't reach IPFS"**: run `docker compose up -d` inside `backend`. It starts IPFS next to the database.
- **Port 8080 already in use**: another program uses it. Change `"8080:8080"` to `"8081:8080"` in `backend/docker-compose.yml`, and set `IPFS_GATEWAY_URL=http://127.0.0.1:8081` in `.env`.
- **"This property was listed before rent payouts existed"**: properties listed before this update use the old contract, which can't pay rent or keep papers. List the property again.
- **Rent stays "paid" and isn't shared out**: the property is probably frozen. It is shared out by itself when the Land Authority unfreezes it. Or call `POST /rent/:id/retry`.
- **Website says "Can't reach the server"**: start the backend (step 7). The footer dot turns green when it works.
- **Port 3000 already in use**: run `npx next dev -p 3001` instead, and open http://localhost:3001.
- **"container name is already in use"**: you started some parts before from `network` or `backend`. Stop them there first (`docker compose down` inside each folder), then run `docker compose up -d` again.
- **Demo data says "already there"**: it only runs on a fresh database. To start over, see "Start over" in the Quick start.
- **An order stays "paid"** (the server stopped while sending the shares): just start the backend again. It finishes stuck orders by itself. An admin can also press "Try again" on the Admin page.
- **You reset the blockchain** (`down -v`) but not the database: old properties point to contracts that no longer exist. Reset the database too: `cd backend` then `docker compose down -v` and `docker compose up -d`.

## The backend, in simple words

The backend is the middle part between the app and the blockchain.

- **Login with roles**: investor, owner, admin, land authority. Anyone can sign up as an investor or owner.
- **Custodial wallets**: every user gets a blockchain wallet when they sign up. The server keeps its key locked (encrypted), so users never touch crypto.
- **KYC (simulated)**: a user uploads a photo of their ID. An admin approves it, and the server adds the user's wallet to the whitelist of every property on the chain.
- **Listing**: an owner with approved KYC lists a property, with its papers. The papers go to IPFS, and the server deploys a new `PropertyToken` contract for it (Pending) with the papers' fingerprint inside. The Land Authority approves it, and all shares go to the owner. The Land Authority can also freeze it.
- **Buying shares**: a verified investor picks a property and a number of shares, and pays in rupees with Razorpay (test mode). When the payment is confirmed, the server moves the shares from the owner's wallet to the investor's wallet on the blockchain.
- **Portfolio**: shows your shares (read from the blockchain), what they're worth at the latest market price, and your full history.
- **Rupee wallet**: investors add money with Razorpay (test mode) and use it to trade.
- **Trading, like a stock app**: investors buy and sell shares from each other with an order book. Prices, the order book and trades update live.
- **Rent payouts**: the owner pays the month's rent, and it is shared out automatically to everyone holding shares, into their rupee wallet.
- **The database** only keeps things like names, emails, photos and orders. Who owns which shares is always read from the blockchain.

### How buying works

1. `POST /orders` with `{ propertyId, shares }`. The shares are held for you for 15 minutes.
2. You pay. The app gets 3 values back from Razorpay: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
3. `POST /orders/:id/verify` with those 3 values. The server checks the signature (proof that you really paid), then sends the shares to your wallet.
4. If the blockchain refuses (for example, the property got frozen), the order becomes `failed`. You already paid, so your shares stay held. Try again later with `POST /orders/:id/retry`.

**No Razorpay account? No problem.** Without keys the server uses fake payments ("mock" mode). Skip step 2 and call `POST /orders/:id/mock-pay` instead of `verify`.

**Safe if the app closes.** If the server stops while sending the shares, the order waits as `paid`. When the server starts again, it checks the blockchain first (so shares never move twice) and then finishes the order. Orders that failed because of a freeze go through by themselves when the property is unfrozen.

**Want real Razorpay test mode?** Sign up at https://dashboard.razorpay.com, switch to **Test Mode**, and create API keys. Put them in `backend/.env` as `RAZORPAY_KEY_ID` (starts with `rzp_test_`) and `RAZORPAY_KEY_SECRET`. The server refuses live keys, so no real money can move. The payment screen itself (Razorpay Checkout) comes with the frontend.

Try it in PowerShell (after an investor has passed KYC and a property is approved):

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType "application/json" -Body '{"email":"you@example.com","password":"password123"}'
$h = @{ Authorization = "Bearer $($login.token)" }
$o = Invoke-RestMethod -Method Post -Uri http://localhost:4000/orders -Headers $h -ContentType "application/json" -Body '{"propertyId":1,"shares":50}'
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/orders/$($o.order.id)/mock-pay" -Headers $h
Invoke-RestMethod -Uri http://localhost:4000/portfolio -Headers $h | ConvertTo-Json -Depth 5
```

## Trading, in simple words

After the first sale, investors trade shares with each other, like on Zerodha or Groww.

- **Rupee wallet**: first add money (test money) to your in-app wallet. Buying spends from it, and selling pays into it. You can withdraw to your bank (simulated).
- **Order book**: a list of offers for one property.
  - A **buy order** (a "bid") says "I'll buy 10 shares at up to ₹105 each".
  - A **sell order** (an "ask") says "I'll sell 10 shares for at least ₹110 each".
- **Matching**: when a buy price is equal to or higher than a sell price, they trade automatically. The best price goes first. At the same price, the older order goes first. The trade uses the price of the order that was waiting.
- **Partly filled**: if only some shares match, the rest waits on the book. You can cancel what's left anytime.
- **Settlement on the blockchain**: each trade moves the shares from the seller's wallet to the buyer's wallet on the chain. Only after the chain confirms it does the money move from buyer to seller. Until then, both are "held", so nobody can spend them twice.
- **Frozen property**: no new orders. If a trade gets stuck because of a freeze, it goes through automatically when the Land Authority unfreezes the property.
- **Live updates**: the server pushes changes instantly using Socket.io (WebSockets).
- **Charts**: price history as candles (open, high, low, close), ready for TradingView Lightweight Charts in the frontend. Plus last price, 24h change, 24h volume and market cap.

Only investors trade. Owners sell their shares through the first sale (above).

### Try it in PowerShell

You need two investors who both passed KYC, and a property that is approved. Alice already owns some shares (she bought them in the first sale). Bob will buy some from her.

```powershell
function Login($email) {
  $r = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType "application/json" -Body (@{ email = $email; password = "password123" } | ConvertTo-Json)
  @{ Authorization = "Bearer $($r.token)" }
}
$alice = Login "alice@example.com"
$bob = Login "bob@example.com"

# 1. Bob adds ₹10,000 to his wallet (fake payment)
$d = Invoke-RestMethod -Method Post -Uri http://localhost:4000/wallet/deposits -Headers $bob -ContentType "application/json" -Body '{"amount":10000}'
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/wallet/deposits/$($d.deposit.id)/mock-pay" -Headers $bob

# 2. Alice offers 20 shares at ₹110 each
Invoke-RestMethod -Method Post -Uri http://localhost:4000/trading/orders -Headers $alice -ContentType "application/json" -Body '{"propertyId":1,"side":"sell","shares":20,"price":110}'

# 3. Bob bids ₹112 for 10 shares. It matches at ₹110 right away.
Invoke-RestMethod -Method Post -Uri http://localhost:4000/trading/orders -Headers $bob -ContentType "application/json" -Body '{"propertyId":1,"side":"buy","shares":10,"price":112}' | ConvertTo-Json -Depth 5

# 4. A few seconds later: the trade is "settled", and the money has moved
Invoke-RestMethod -Uri http://localhost:4000/trading/trades -Headers $bob | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:4000/wallet -Headers $bob | ConvertTo-Json -Depth 5

# 5. The market: price, order book, latest trades, and chart candles
Invoke-RestMethod -Uri http://localhost:4000/market/1 | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:4000/market/1/candles?interval=1m" | ConvertTo-Json -Depth 5
```

### Live updates (for the frontend)

Connect with Socket.io to the same address as the API:

```js
import { io } from "socket.io-client";
const socket = io("http://localhost:4000", { auth: { token } }); // token is optional
socket.emit("watch", propertyId);          // follow one property's market
socket.on("orderbook", (book) => {});      // bids and asks changed
socket.on("trade", (trade) => {});         // a new trade (or yours changed)
socket.on("ticker", (t) => {});            // new price, 24h change, volume
socket.on("order", (order) => {});         // your order changed (needs token)
socket.on("wallet", (w) => {});            // your balance changed (needs token)
socket.on("rent", (r) => {});              // you received rent (needs token)
```

### Razorpay webhooks (optional)

Sometimes an investor pays, but closes the browser before the app can tell our server. A **webhook** fixes that: Razorpay calls our server directly to say "this payment went through". It works for share orders, wallet deposits and rent.

1. In the Razorpay dashboard (Test Mode), go to **Webhooks** and add one:
   - URL: `https://<your server>/payments/webhook` (Razorpay can't reach `localhost`, so use a tunnel like `ngrok http 4000` for testing)
   - Secret: any long random text
   - Events: `payment.captured` and `order.paid`
2. Put the same secret in `backend/.env` as `RAZORPAY_WEBHOOK_SECRET`.

Razorpay signs every webhook with that secret, so nobody else can fake one. If both the app and the webhook report the same payment, it still counts only once.

## Rent payouts, in simple words

1. The owner (or an admin) pays the month's rent for a property, say ₹1,00,000, with Razorpay (test mode).
2. BrickShare records the payout in the property's smart contract. The contract takes a **snapshot**: who holds how many shares at that exact moment.
3. The contract works out each holder's part: rent x (their shares / all shares). Hold 2% of the shares, get 2% of the rent (₹2,000).
4. Each part goes straight into that holder's rupee wallet. The owner gets the part for the shares they still hold, plus a few paise left over from rounding.
5. Buying or selling shares after the snapshot doesn't change that payout. The next month uses the new balances.
6. **Frozen property**: no rent is paid. Rent that was already paid waits, and is shared out by itself when the Land Authority unfreezes the property.

Investors see their rent in `GET /rent/received`, in their wallet history, and as `rentEarned` in their portfolio.

### Monthly rent (automatic)

The owner sets a monthly rent once on "My properties" (`PUT /properties/:id/rent-schedule` with `{ "amount": 20000 }`).

- The first month is paid within a minute, then once every month, by itself.
- The money comes from the owner's rupee wallet (owners can add money on the Wallet page). It shows there as "Monthly rent paid".
- Not enough money? Nothing is taken, the owner page says why, and it tries again every 30 seconds.
- Frozen property? Nothing is taken until it is unfrozen.
- For demos: **Pay next month now** (`POST /properties/:id/rent-schedule/pay-now`) pays straight away, or set `RENT_MONTH_SECONDS=120` in `backend/.env` so a "month" lasts 2 minutes.
- Stop it with `{ "amount": 20000, "active": false }`.

### Try it in PowerShell

As the owner of an approved property that investors already hold shares in:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType "application/json" -Body '{"email":"owner@example.com","password":"password123"}'
$h = @{ Authorization = "Bearer $($login.token)" }

# 1. Pay ₹10,000 rent for property 1 (fake payment)
$r = Invoke-RestMethod -Method Post -Uri http://localhost:4000/properties/1/rent -Headers $h -ContentType "application/json" -Body '{"amount":10000,"period":"October 2026"}'
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/rent/$($r.payout.id)/mock-pay" -Headers $h | ConvertTo-Json -Depth 5

# 2. Every payout of this property (anyone can see this)
Invoke-RestMethod -Uri http://localhost:4000/properties/1/rent | ConvertTo-Json -Depth 5
```

Then log in as an investor and look at `GET /rent/received` or `GET /wallet`.

## Property papers on IPFS

**IPFS** is a peer-to-peer file network, a bit like torrents. Every file gets a **CID**: a fingerprint made from the file's content. Change one letter and the CID changes.

- When an owner lists a property with papers, the server puts the file on IPFS and saves `ipfs://<CID>` in the new contract.
- Later, the owner, an admin or the Land Authority can add more papers (rent agreement, tax receipt...). Each CID is saved in the contract with `addDocument()`.
- `GET /properties/:id/documents` lists the papers and says `verified: true` when the CID matches the one in the contract.
- You can open a paper through the API (`url`) or straight from IPFS in your browser (`ipfsUrl`, like `http://localhost:8080/ipfs/<CID>`).
- Files on IPFS are **public**. That's fine for property papers, but ID cards from KYC are never put there: they stay private on the server.

Our IPFS node runs in Docker next to the database (`backend/docker-compose.yml`).

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
| POST | `/orders/:id/retry` | buyer, admin | Send the shares again for a `failed` order, or one stuck in `paid` |
| GET | `/admin/orders?status=failed` | admin | All orders, optionally by status |
| GET | `/portfolio` | logged in | Your shares, their value and what you paid |
| GET | `/transactions` | logged in | Every share movement in or out of your wallet (from the chain) |
| GET | `/wallet` | logged in | Your rupee balance (`balance`, `held`, `available`) and history |
| POST | `/wallet/deposits` | investor (KYC done) | `{ amount }` in rupees, returns the deposit and the Razorpay Checkout details |
| GET | `/wallet/deposits` | logged in | Your deposits |
| POST | `/wallet/deposits/:id/verify` | depositor | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`, then the money is added |
| POST | `/wallet/deposits/:id/mock-pay` | depositor | Fake payment (only when no Razorpay keys are set) |
| POST | `/wallet/withdraw` | investor, owner | `{ amount }`, send money back to your bank (simulated) |
| POST | `/trading/orders` | investor (KYC done) | `{ propertyId, side: "buy" or "sell", shares, price }`, matches right away |
| GET | `/trading/orders` | logged in | Your orders (`?status=open`, `?propertyId=1`) |
| GET | `/trading/orders/:id` | owner of the order | One order and its trades |
| DELETE | `/trading/orders/:id` | owner of the order | Cancel what's left of an open order |
| GET | `/trading/trades` | logged in | Your trades |
| POST | `/trading/trades/:id/retry` | buyer, seller, admin | Try a `failed` trade again |
| GET | `/admin/trades?status=failed` | admin | All trades, optionally by status |
| GET | `/market` | anyone | Every property's price, 24h change, volume and market cap |
| GET | `/market/:id` | anyone | One property's price, order book and latest trades |
| GET | `/market/:id/orderbook` | anyone | Bids and asks, grouped by price |
| GET | `/market/:id/trades` | anyone | Latest trades (`?limit=50`) |
| GET | `/market/:id/candles` | anyone | Chart candles. `?interval=1m`, `5m`, `15m`, `1h` or `1d`, and `?limit=200` |
| POST | `/properties/:id/rent` | the property's owner, admin | `{ amount, period }` in rupees, returns the payout and the Razorpay Checkout details |
| GET | `/properties/:id/rent` | anyone | Rent payouts that were shared out |
| GET | `/rent` | owner, admin | Payouts you paid (admin: all). `?status=paid` shows ones still waiting |
| GET | `/rent/:id` | payer, admin | One payout |
| POST | `/rent/:id/verify` | payer, admin | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`, then the rent is shared out |
| POST | `/rent/:id/mock-pay` | payer, admin | Fake payment (only when no Razorpay keys are set) |
| POST | `/rent/:id/retry` | payer, admin | Share out a `paid` payout again |
| GET | `/rent/received` | logged in | Rent you received, and the total |
| GET | `/properties/:id/documents` | anyone | The property's papers, each checked against the chain |
| POST | `/properties/:id/documents` | the property's owner, admin, land authority | Form: `kind` (sale-deed, title-report, tax-receipt, rent-agreement, valuation, photo, other) and file `document` |
| GET | `/properties/:id/documents/:docId/file` | anyone | Download a paper from IPFS |
| POST | `/payments/webhook` | Razorpay | Razorpay says a payment went through (signed). See "Razorpay webhooks" |
| GET | `/network` | anyone | Each of the 4 blockchain nodes: online, latest block, peers |

If you change the contract, copy the new version into the backend: `cd contracts`, then `npm run compile` and `npm run export-abi`.

## The website, in simple words

Each person sees the screens for their role:

| Screen | Who | What it shows |
|---|---|---|
| Market (`/`) | everyone | Every approved property with its live price and 24h change |
| Property (`/properties/:id`) | everyone | Details, a "buy from the owner" box, papers checked against the chain, rent history |
| Trade (`/trade/:id`) | everyone (investors can trade) | Candle chart, order book, latest trades, buy/sell form. All live |
| Portfolio | investor, owner | Your shares (from the blockchain), value, gain, rent earned, full history |
| Wallet | investor, owner | Rupee balance, add money, withdraw, every movement |
| KYC | investor, owner | Send your ID and see if it's approved |
| My properties | owner | List a property, pay rent, add papers |
| Admin | admin | Approve IDs, all users, retry stuck payments |
| Land Authority | land authority | Approve properties, freeze and unfreeze |
| Network (`/network`) | everyone | The 4 blockchain nodes live: are they online, and do they agree on the latest block? |

- The login token is kept in your browser, so you stay logged in.
- Payments open Razorpay Checkout when the backend has test keys. Without keys, they use fake payments.
- Live updates come from the backend with Socket.io.

## Automatic checks (CI)

Every pull request on GitHub runs these checks by itself:

- **Contracts**: the 13 smart contract tests.
- **Backend**: starts the real blockchain, database and IPFS with Docker, then runs every backend test.
- **Frontend**: lint and build the website.

## Test accounts

The 5 accounts in `contracts/hardhat.config.js` (BrickShare admin, Land Authority, property owner, 2 investors) are **for testing only**. Their keys are public. Never put real money on them.
