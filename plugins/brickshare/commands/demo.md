---
description: Start the whole BrickShare demo (blockchain, database, IPFS, backend, website)
allowed-tools: Bash(docker:*), Bash(npm:*), Bash(node:*), Bash(curl:*)
---

Start the full BrickShare demo, in this order. Run every command from the
repository root (the folder with `docker-compose.yml`). The user may be on
Windows PowerShell, so use commands that work there too (`cd backend`, not
`cd ./backend && ...` chains that need bash).

1. Check Docker is running with `docker info`. If it fails, tell the user to
   open Docker Desktop and stop here.
2. Run `docker compose up -d`. This starts the 4 blockchain nodes, PostgreSQL
   and IPFS.
3. Wait until the blockchain makes blocks: run `node contracts/scripts/check-nodes.js`
   (needs `npm install` in `contracts` the first time). Retry a few times if
   the block number is still 0.
4. In `backend`: run `npm install` if `node_modules` is missing, then start
   `npm start` **in the background** (it keeps running). Check
   http://localhost:4000/health returns `"ok": true`.
5. If the user passed `fresh` or the database is empty, run `npm run demo-data`
   in `backend`. If it says the data is "already there", that is fine.
6. In `frontend`: run `npm install` if `node_modules` is missing, then start
   `npm run dev` **in the background**.
7. Tell the user, in simple words:
   - Open http://localhost:3000
   - Logins: owner@demo.test, alice@demo.test, bob@demo.test (password
     `demo1234`), admin@brickshare.test / admin123, land@brickshare.test / land123
   - The 5-minute walk-through is in `DEMO.md`.

If a step fails, look in the "If something goes wrong" part of `README.md`
for the fix before trying anything else.

Extra words from the user: $ARGUMENTS
