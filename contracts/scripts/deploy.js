// Deploys one sample property to the network.
// Run: npx hardhat run scripts/deploy.js --network besu
const { ethers } = require("hardhat");

async function main() {
  const [platform, landAuthority, owner] = await ethers.getSigners();

  const PropertyToken = await ethers.getContractFactory("PropertyToken", platform);
  const token = await PropertyToken.deploy(
    "Whitefield Villa Shares",
    "WFV",
    "BLR-WHITEFIELD-001",
    "ipfs://demo-hash",
    10_000, // total shares
    owner.address,
    platform.address,
    landAuthority.address
  );
  await token.waitForDeployment();

  console.log("PropertyToken deployed at:", await token.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
