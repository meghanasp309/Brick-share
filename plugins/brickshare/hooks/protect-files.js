// Runs BEFORE Claude edits a file. Blocks edits that would leak secrets or
// break generated files. Exit code 2 = blocked, and Claude reads the reason.
const { readInput } = require("./read-input");

const RULES = [
  { test: (f) => /(^|\/)\.env(\.local)?$/.test(f), why: "it holds secrets (passwords, keys). Edit .env.example instead and tell the user what to change in their own .env" },
  { test: (f) => f === "backend/src/chain/PropertyToken.json", why: "it is generated. Change contracts/contracts/PropertyToken.sol, then run `npm run compile` and `npm run export-abi` in contracts" },
  { test: (f) => /(^|\/)package-lock\.json$/.test(f), why: "it is generated. Run `npm install <package>` in that folder instead" },
  { test: (f) => /^network\/.*(key|genesis)/.test(f), why: "it is part of the blockchain's identity. Changing it splits the 4 nodes. Ask the user first" },
];

readInput().then(({ rel }) => {
  const rule = rel && RULES.find((r) => r.test(rel));
  if (rule) {
    console.error(`BrickShare: don't edit ${rel} directly, because ${rule.why}.`);
    process.exit(2);
  }
});
