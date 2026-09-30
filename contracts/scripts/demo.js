// Plays the whole story of one property on the network, step by step.
// Run: npx hardhat run scripts/demo.js --network besu
const { ethers } = require("hardhat");

async function main() {
  const [platform, landAuthority, owner, investor1] = await ethers.getSigners();
  const wait = (tx) => tx.then((t) => t.wait());

  console.log("1. BrickShare lists a new property (Pending)...");
  const token = await (
    await ethers.getContractFactory("PropertyToken", platform)
  ).deploy(
    "Whitefield Villa Shares", "WFV", "BLR-WHITEFIELD-001", "ipfs://demo-hash",
    10_000, owner.address, platform.address, landAuthority.address
  );
  await token.waitForDeployment();
  console.log("   Contract address:", await token.getAddress());

  console.log("2. Land Authority checks the papers and approves it...");
  await wait(token.connect(landAuthority).approveProperty());
  console.log("   Owner now has", (await token.balanceOf(owner.address)).toString(), "shares");

  console.log("3. BrickShare finishes the investor's KYC and whitelists them...");
  await wait(token.connect(platform).addToWhitelist(investor1.address));

  console.log("4. Investor buys 50 shares from the owner...");
  await wait(token.connect(owner).transfer(investor1.address, 50));
  console.log("   Investor has", (await token.balanceOf(investor1.address)).toString(), "shares");

  console.log("5. Land Authority freezes the property (legal dispute)...");
  await wait(token.connect(landAuthority).freeze("Legal dispute"));
  try {
    await wait(token.connect(investor1).transfer(owner.address, 10));
    console.log("   ERROR: transfer should have been blocked!");
  } catch {
    console.log("   Transfer blocked by the contract, as expected.");
  }

  console.log("6. Land Authority unfreezes it. Trading works again...");
  await wait(token.connect(landAuthority).unfreeze());
  await wait(token.connect(investor1).transfer(owner.address, 10));
  console.log("   Investor has", (await token.balanceOf(investor1.address)).toString(), "shares");

  console.log("7. BrickShare pays this month's rent: Rs 10,000 (1,000,000 paise)...");
  await wait(token.connect(platform).distributeRent(1_000_000, "demo-rent-" + Date.now()));
  const payoutId = await token.payoutCount();
  console.log("   Investor gets", (await token.rentOwed(payoutId, investor1.address)).toString(), "paise (they hold 0.4%)");
  console.log("   Owner gets", (await token.rentOwed(payoutId, owner.address)).toString(), "paise");

  console.log("\nDone! Every node (BrickShare, property company, Land Authority) now has this history.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
