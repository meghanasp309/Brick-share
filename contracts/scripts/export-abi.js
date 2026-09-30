// Copies the compiled PropertyToken (ABI + bytecode) into the backend,
// so the server can deploy and talk to it.
// Run after changing the contract: npm run compile && npm run export-abi
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "artifacts", "contracts", "PropertyToken.sol", "PropertyToken.json");
const dest = path.join(__dirname, "..", "..", "backend", "src", "chain", "PropertyToken.json");

const { contractName, abi, bytecode } = JSON.parse(fs.readFileSync(src, "utf8"));
fs.writeFileSync(dest, JSON.stringify({ contractName, abi, bytecode }, null, 2) + "\n");
console.log("Updated", path.relative(process.cwd(), dest));
