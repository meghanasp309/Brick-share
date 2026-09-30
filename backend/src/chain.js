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

/** Calls a contract function as `signer`, waits until it is in a block, returns the hash. */
async function send(signer, address, fn, ...args) {
  try {
    const tx = await token(address, signer)[fn](...args, TX);
    const receipt = await tx.wait();
    return receipt.hash;
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

const isWhitelisted = (contractAddress, address) => token(contractAddress).isWhitelisted(address);

async function networkInfo() {
  const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  return { chainId: Number(network.chainId), blockNumber };
}

module.exports = {
  provider, platform, userSigner, deployProperty, addToWhitelist,
  approveProperty, freeze, unfreeze, readProperty, isWhitelisted, networkInfo,
};
