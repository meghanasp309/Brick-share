const test = require("node:test");
const assert = require("node:assert");
const { encrypt, decrypt, createWallet, unlockWallet } = require("../src/wallets");

test("encrypts and decrypts a secret", () => {
  const sealed = encrypt("hello");
  assert.notStrictEqual(sealed, "hello");
  assert.strictEqual(decrypt(sealed), "hello");
});

test("a tampered secret can't be decrypted", () => {
  const [iv, tag, data] = encrypt("hello").split(".");
  const bad = Buffer.from(data, "base64");
  bad[0] ^= 1;
  assert.throws(() => decrypt([iv, tag, bad.toString("base64")].join(".")));
});

test("creates a custodial wallet and unlocks it again", () => {
  const w = createWallet();
  assert.match(w.address, /^0x[0-9a-fA-F]{40}$/);
  assert.ok(!w.encryptedKey.includes(w.address));
  assert.strictEqual(unlockWallet(w.encryptedKey).address, w.address);
});
