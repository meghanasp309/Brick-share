// Property papers on IPFS, our peer-to-peer file store (a bit like torrents).
//
// Every file gets a CID: a fingerprint made from the file's content. The same
// file always gets the same CID, and a changed file gets a different one. We
// save the CID in the property's smart contract, so anyone can check that the
// papers they download are exactly the ones that were approved.
//
// We talk to a local IPFS node (Kubo) through its HTTP API. Start it with
// "docker compose up -d" in the backend folder.
const config = require("./config");
const { HttpError } = require("./errors");

const unreachable = () =>
  new HttpError(503, "Can't reach IPFS. Start it with: cd backend, then docker compose up -d");

async function call(path) {
  try {
    // Kubo's API only accepts POST.
    return await fetch(`${config.ipfsApiUrl}/api/v0/${path}`, { method: "POST" });
  } catch {
    throw unreachable();
  }
}

/** Stores a file on IPFS (and pins it, so it is kept). Returns its CID. */
async function add(buffer, fileName) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);
  let res;
  try {
    res = await fetch(`${config.ipfsApiUrl}/api/v0/add?cid-version=1&pin=true`, { method: "POST", body: form });
  } catch {
    throw unreachable();
  }
  if (!res.ok) throw new HttpError(502, `IPFS refused the file: ${await res.text()}`);
  return (await res.json()).Hash;
}

/** Reads a file back from IPFS by its CID. */
async function cat(cid) {
  const res = await call(`cat?arg=${encodeURIComponent(cid)}`);
  if (!res.ok) throw new HttpError(404, "File not found on IPFS");
  return Buffer.from(await res.arrayBuffer());
}

/** A link anyone can open in the browser to see the file. */
const gatewayUrl = (cid) => `${config.ipfsGatewayUrl}/ipfs/${cid}`;

module.exports = { add, cat, gatewayUrl };
