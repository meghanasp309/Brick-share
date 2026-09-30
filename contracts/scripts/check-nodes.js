// Asks all 4 nodes for their latest block, to show they share one ledger.
// Run: npm run nodes
const NODES = {
  "brickshare-1": "http://127.0.0.1:8545",
  "brickshare-2": "http://127.0.0.1:8555",
  "property-company": "http://127.0.0.1:8565",
  "land-authority": "http://127.0.0.1:8575",
};

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(3000),
  });
  return (await res.json()).result;
}

async function main() {
  for (const [name, url] of Object.entries(NODES)) {
    try {
      const block = await rpc(url, "eth_getBlockByNumber", ["latest", false]);
      const peers = await rpc(url, "net_peerCount");
      console.log(
        `${name.padEnd(17)} block ${Number(block.number)}  hash ${block.hash.slice(0, 12)}...  peers ${Number(peers)}`
      );
    } catch {
      console.log(`${name.padEnd(17)} not reachable (is it running?)`);
    }
  }
}

main();
