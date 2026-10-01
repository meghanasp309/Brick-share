---
name: add-a-feature
description: Step-by-step recipe for adding a feature to BrickShare across contract, database, API, website and tests. Use when the user asks to add or change something in BrickShare.
---

# Adding a feature to BrickShare

Work through only the layers the feature needs, in this order.

## 1. Smart contract (only if the rule must be enforced on-chain)

1. Edit `contracts/contracts/PropertyToken.sol`.
2. Add a test in `contracts/test/PropertyToken.test.js`. Run `npm test` in `contracts`.
3. Run `npm run compile` and `npm run export-abi` so the backend gets the new ABI.
4. Old properties keep the old contract. If the backend calls a new function,
   check first that the contract has it (like `chain.hasPhase5Features`) and
   give a clear error if not.

## 2. Database

1. Add the table or column in `backend/src/db/schema.sql`. Use
   `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, because it runs
   on every start.
2. Add any new table to the `DROP TABLE` list in `backend/tests/setup.js`.

## 3. API (backend)

1. Put the logic in a module in `backend/src/` and the URLs in
   `backend/src/routes/<name>.js` (an `express.Router()`).
2. Register the router in `backend/src/app.js`.
3. Protect it with `requireAuth` and `requireRole(...)` from `src/auth.js`.
4. Check input with `src/validate.js`. Throw `new HttpError(status, "simple message")`
   from `src/errors.js` for user errors.
5. Money in paise. Shares are read from the chain, not the database.
6. Add a test in `backend/tests/` using `supertest` (copy the style of
   `api.test.js`). Run `npm test` in `backend` (Docker must be running).

## 4. Website (frontend)

1. A new page is `frontend/src/app/<name>/page.js`. Shared parts go in
   `frontend/src/components/`.
2. Call the API with the helpers in `frontend/src/lib/api.js`, and load data
   with `useLoad` from `src/lib/useLoad.js`.
3. Wrap logged-in pages in `RequireLogin`. Add a link in `components/Nav.js`
   if users need to find it.
4. Run `npm run lint` in `frontend`.

## 5. Docs

Add a short section to `README.md` in simple words: what it does and how to
try it (PowerShell commands). If the demo should show it, update
`backend/scripts/demo-data.js` and `DEMO.md`.
