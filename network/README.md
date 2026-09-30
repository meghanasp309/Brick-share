# Private blockchain network

4 Hyperledger Besu nodes. They agree on every block using **QBFT** (a voting system: a block is final once most nodes sign it).

| Node | Run by | RPC on your laptop |
|---|---|---|
| brickshare-1 | BrickShare (main, the app talks to this) | http://localhost:8545 |
| brickshare-2 | BrickShare (backup) | http://localhost:8555 |
| property-company | A property developer | http://localhost:8565 |
| land-authority | The Land Authority | http://localhost:8575 |

- `genesis.json` is block 0: the chain's rules (chain id 2026, a block every 2 seconds, free gas) and the list of the 4 validator nodes. It also gives 5 test accounts some balance.
- `nodes/<name>/key` is each node's private identity key. These are **test keys only**. In real life each organisation keeps its own key secret.
- With 4 nodes, the network keeps working if 1 node goes down. Try `docker stop land-authority`, then `npm run nodes` in `contracts/`.

The files were made with Besu's own tool:
`besu operator generate-blockchain-config` (QBFT, 4 nodes).
