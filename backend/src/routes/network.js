// The live network view: what each of the 4 blockchain nodes sees right now.
// If they all show the same latest block, they agree on the record book.
const express = require("express");
const config = require("../config");

const router = express.Router();

async function rpc(url, method) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: method === "eth_getBlockByNumber" ? ["latest", false] : [] }),
    signal: AbortSignal.timeout(2000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function nodeStatus({ name, url }) {
  try {
    const [block, peers] = await Promise.all([rpc(url, "eth_getBlockByNumber"), rpc(url, "net_peerCount")]);
    return {
      name,
      online: true,
      blockNumber: Number(block.number),
      blockHash: block.hash,
      blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
      transactions: block.transactions.length,
      peers: Number(peers),
    };
  } catch {
    return { name, online: false };
  }
}

router.get("/network", async (_req, res) => {
  const nodes = await Promise.all(config.nodes.map(nodeStatus));
  const online = nodes.filter((n) => n.online);
  const top = Math.max(0, ...online.map((n) => n.blockNumber));
  // Nodes can be a block apart for a moment. Within 2 blocks counts as in step.
  for (const n of online) n.inSync = top - n.blockNumber <= 2;
  res.json({
    nodes,
    online: online.length,
    total: nodes.length,
    // QBFT keeps going while more than 2/3 of the nodes are up (3 of 4).
    healthy: online.length * 3 > nodes.length * 2,
  });
});

module.exports = router;
