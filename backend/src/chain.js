// Everything that talks to the blockchain lives here.
const { ethers } = require("ethers");
const config = require("./config");
const artifact = require("./chain/PropertyToken.json");
const { unlockWallet } = require("./wallets");

const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: false });

// Gas is free on our private chain.
const TX = { gasPrice: 0 };

// One signer per address. NonceManager keeps transactions in order when
// several requests send transactions from the same wallet at once.
const signers = new Map();
function signerFor(wallet) {
  if (!signers.has(wallet.address)) signers.set(wallet.address, new ethers.NonceManager(wallet));
  return signers.get(wallet.address);
}

/** BrickShare's own wallet: deploys properties and manages the KYC whitelist. */
const platform = () => signerFor(new ethers.Wallet(config.platformKey, provider));

/** Signer for a user's custodial wallet (e.g. the Land Authority). */
const userSigner = (user) => signerFor(unlockWallet(user.wallet_key_enc, provider));

const token = (address, runner = provider) => new ethers.Contract(address, artifact.abi, runner);

const iface = new ethers.Interface(artifact.abi);

/** Calls a contract function as `signer` and returns the sent transaction (not yet in a block). */
async function submit(signer, address, fn, ...args) {
  try {
    return await token(address, signer)[fn](...args, TX);
  } catch (err) {
    // A failed call may have used up a nonce (the wallet's transaction
    // number) without sending anything. Re-read it, or the next one gets stuck.
    signer.reset();
    // Turn the contract's error code into its name, e.g. "PropertyFrozen".
    if (!err.revert && err.data) {
      const parsed = iface.parseError(err.data);
      if (parsed) err.revert = { name: parsed.name, args: [...parsed.args] };
    }
    throw err;
  }
}

/** Calls a contract function as `signer`, waits until it is in a block, returns the hash. */
async function send(signer, address, fn, ...args) {
  const tx = await submit(signer, address, fn, ...args);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Deploys a new PropertyToken contract (the property starts as Pending). */
async function deployProperty({ name, symbol, propertyId, documentHash, totalShares, owner, landAuthority }) {
  const signer = platform();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  try {
    const contract = await factory.deploy(
      name, symbol, propertyId, documentHash, totalShares,
      owner, await signer.getAddress(), landAuthority, TX
    );
    await contract.waitForDeployment();
    return contract.getAddress();
  } catch (err) {
    signer.reset();
    throw err;
  }
}

async function addToWhitelist(contractAddress, investor) {
  if (await token(contractAddress).isWhitelisted(investor)) return null;
  return send(platform(), contractAddress, "addToWhitelist", investor);
}

const approveProperty = (contractAddress, signer) => send(signer, contractAddress, "approveProperty");
const freeze = (contractAddress, signer, reason) => send(signer, contractAddress, "freeze", reason);
const unfreeze = (contractAddress, signer) => send(signer, contractAddress, "unfreeze");

/** Reads the live state of a property from the chain. */
async function readProperty(contractAddress, ownerAddress) {
  const t = token(contractAddress);
  const [status, frozen, freezeReason, totalSupply, ownerBalance] = await Promise.all([
    t.status(), t.frozen(), t.freezeReason(), t.totalSupply(), t.balanceOf(ownerAddress),
  ]);
  return {
    status: Number(status) === 1 ? "approved" : "pending",
    frozen,
    freezeReason: freezeReason || null,
    sharesIssued: Number(totalSupply),
    ownerShares: Number(ownerBalance),
  };
}

/** Moves `shares` from the signer's wallet (e.g. the property owner) to `to`. */
const transferShares = (contractAddress, signer, to, shares) => send(signer, contractAddress, "transfer", to, shares);

/**
 * Sends a share transfer from the signer's wallet to `to`. Calls
 * `onSent(hash)` as soon as it is sent, then waits for the block.
 */
async function transferSharesTracked(contractAddress, signer, to, shares, onSent) {
  const tx = await submit(signer, contractAddress, "transfer", to, shares);
  await onSent(tx.hash);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * What happened to a transaction we sent earlier: "success", "reverted",
 * or "unknown" (not in a block within `waitMs`).
 */
async function transactionOutcome(txHash, waitMs = 30_000) {
  const receipt = await provider.waitForTransaction(txHash, 1, waitMs).catch(() => null);
  if (!receipt) return "unknown";
  return receipt.status === 1 ? "success" : "reverted";
}

async function balanceOf(contractAddress, address) {
  return Number(await token(contractAddress).balanceOf(address));
}

/**
 * Every share movement into or out of `address` on one property, read from
 * the chain's Transfer events. Oldest first.
 */
async function transfersOf(contractAddress, address) {
  const t = token(contractAddress);
  const [incoming, outgoing] = await Promise.all([
    t.queryFilter(t.filters.Transfer(null, address), 0),
    t.queryFilter(t.filters.Transfer(address, null), 0),
  ]);
  const events = [...incoming, ...outgoing];
  const blocks = new Map();
  await Promise.all([...new Set(events.map((e) => e.blockNumber))].map(async (n) => {
    blocks.set(n, await provider.getBlock(n));
  }));
  return events
    .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)
    .map((e) => ({
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
      timestamp: new Date(blocks.get(e.blockNumber).timestamp * 1000).toISOString(),
      from: e.args.from,
      to: e.args.to,
      shares: Number(e.args.value),
    }));
}

const isWhitelisted = (contractAddress, address) => token(contractAddress).isWhitelisted(address);

async function networkInfo() {
  const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  return { chainId: Number(network.chainId), blockNumber };
}

module.exports = {
  provider, platform, userSigner, deployProperty, addToWhitelist,
  approveProperty, freeze, unfreeze, readProperty, isWhitelisted, networkInfo,
  transferShares, transferSharesTracked, transactionOutcome, balanceOf, transfersOf,
};
