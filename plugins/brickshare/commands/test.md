---
description: Run BrickShare's checks (contracts, backend, website). Pass contracts, backend or frontend to run just one.
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(docker:*), Bash(node:*)
---

Run the BrickShare checks. Which ones: "$ARGUMENTS" (empty means all three).

- **contracts**: in `contracts`, run `npm test` (Hardhat tests, no Docker needed).
- **frontend**: in `frontend`, run `npm run lint` and then `npm run build`.
- **backend**: needs the blockchain, database and IPFS. First make sure
  `docker compose up -d` has been run from the repository root. Then in
  `backend`, run `npm test`. It takes 3-4 minutes because every blockchain
  step waits for a new block, so tell the user that before starting.

Run `npm install` first in any folder that has no `node_modules`.

At the end, give a short table: part, passed or failed, and for each failure
the test name and a one-line reason in simple words. Don't fix anything
unless the user asks.
