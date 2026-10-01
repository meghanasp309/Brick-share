---
description: Check which parts of BrickShare are running right now
allowed-tools: Bash(docker:*), Bash(curl:*), Bash(node:*)
---

Check what is running and report it as a short list with ✅ or ❌:

1. **Docker containers**: `docker compose ps` from the repository root.
   Expect 4 Besu nodes, `brickshare-db` and `brickshare-ipfs`.
2. **Blockchain**: `node contracts/scripts/check-nodes.js`. All 4 nodes
   should show the same, growing block number.
3. **Backend**: `curl -s http://localhost:4000/health`. Expect `"ok": true`.
4. **Website**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`.
   Expect `200`.

For anything that is ❌, say the one command that fixes it (see
"If something goes wrong" in `README.md`). Don't start anything yourself.
