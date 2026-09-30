# BrickShare

A peer-to-peer marketplace for **fractional real estate**. An owner splits a property into digital shares (tokens), and verified investors buy, hold and trade them.

> Demo project. Test money only.

## What's in here (so far)

```
brick-share/
├── network/     Private blockchain: 4 Besu nodes in Docker
└── contracts/   Smart contracts (Solidity + Hardhat)
```

Coming next (see the plan): `backend/` (Node + Express), `frontend/` (Next.js).

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
git checkout claude/project-thread-35491s
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

### If something goes wrong

- **"docker: command not found" or "cannot connect"**: Docker Desktop isn't running. Open it first.
- **"port is already allocated"**: something else uses port 8545. Close it, or change the port in `network/docker-compose.yml`.
- **Nodes stuck on block 0**: run `docker compose down -v` and then `docker compose up -d` again.

## Test accounts

The 5 accounts in `contracts/hardhat.config.js` (BrickShare admin, Land Authority, property owner, 2 investors) are **for testing only**. Their keys are public. Never put real money on them.
