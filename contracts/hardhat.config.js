require("@nomicfoundation/hardhat-toolbox");

// DEV-ONLY test accounts. They are funded in network/genesis.json.
// Never use these keys for anything real: they are public on GitHub.
const DEV_KEYS = {
  brickshareAdmin: "0xc710504cb32fc979d5080a3b5215f07ad8b33b58743876aaf695588ec9cf1ba7",
  landAuthority: "0xe028742a957ee5873864d789b2fbf1463b1184418da5d650d33c6f8b3f9291f1",
  propertyOwner: "0xd0dc761cff663540bb37e1ef5056632084db15306e2bfb24bbada8770daa6eb5",
  investor1: "0x4faea21e405ae85cd6d5508c5f89935dfd6e62c98dadb9f9fcff88702f9cb77c",
  investor2: "0x715da1728ccf1de8148e9c45b37c94611b38dbf6cff45d70a77110c19d74c91f",
};

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { evmVersion: "shanghai", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Our private Besu network (start it first: see README).
    besu: {
      url: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
      chainId: 2026,
      gasPrice: 0, // gas is free on our private chain
      accounts: Object.values(DEV_KEYS),
    },
  },
};
