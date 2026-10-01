---
description: Delete all BrickShare data and start fresh (asks first)
allowed-tools: Bash(docker:*)
---

This deletes the blockchain, the database and all IPFS files.

1. First ask the user to confirm, in one short line. Do nothing until they
   say yes.
2. Tell them to stop the backend and website if they are running (Ctrl+C in
   their windows), or stop the background ones you started.
3. From the repository root run `docker compose down -v`.
4. Say that `/brickshare:demo fresh` starts everything again with demo data.
