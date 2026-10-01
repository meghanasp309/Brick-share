// Runs AFTER Claude edits a file. A quick check of just that file, so
// mistakes are caught right away instead of at the end:
//   backend/*.js   -> syntax check (node --check)
//   frontend/*.js  -> ESLint on that file
//   contracts/*.sol -> Hardhat compile
// Exit code 2 sends the problem back to Claude to fix.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { readInput } = require("./read-input");

function run(cmd, args, cwd) {
  // shell: true so "npx" also works on Windows (npx.cmd).
  return spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

function pick(rel, root) {
  const has = (dir) => fs.existsSync(path.join(root, dir, "node_modules"));
  if (/^backend\/.*\.js$/.test(rel)) {
    return { name: "Syntax check", cmd: process.execPath, args: ["--check", rel], cwd: root };
  }
  if (/^frontend\/src\/.*\.(js|jsx|mjs)$/.test(rel) && has("frontend")) {
    return { name: "ESLint", cmd: "npx", args: ["eslint", rel.replace(/^frontend\//, "")], cwd: path.join(root, "frontend") };
  }
  if (/^contracts\/contracts\/.*\.sol$/.test(rel) && has("contracts")) {
    return { name: "Hardhat compile", cmd: "npx", args: ["hardhat", "compile", "--quiet"], cwd: path.join(root, "contracts") };
  }
  return null; // Other files, or packages not installed yet: nothing to check.
}

readInput().then(({ rel, root }) => {
  const check = rel && pick(rel, root);
  if (!check) return;
  const res = run(check.cmd, check.args, check.cwd);
  if (res.status !== 0) {
    const out = `${res.stdout || ""}${res.stderr || ""}`.trim().split("\n").slice(-30).join("\n");
    console.error(`BrickShare: ${check.name} failed for ${rel}. Please fix it:\n${out}`);
    process.exit(2);
  }
  if (rel.endsWith(".sol")) {
    console.log("Contract compiled. Remember: `npm run export-abi` in contracts so the backend gets the new ABI.");
  }
});
