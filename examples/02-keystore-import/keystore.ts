/**
 * Example 2 — Local keystore: generate a key, import a Go-keystore entry,
 * and round-trip encrypt/decrypt. No node required — everything happens
 * offline, which is the point of a client-side keystore.
 *
 * The SDK's keystore helpers are byte-compatible with the Go node's keystore
 * (argon2i KDF + AES-GCM), so an entry produced here decrypts with the same
 * password in Go tooling and vice versa.
 *
 * Run: npx tsx keystore.ts
 * Writes: ./keystore/<address>.json (git-ignored)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Key generation, encryption, and keystore helpers are re-exported from the
// package root (some live in ./wallet.ts and ./keystore.ts internally).
import {
  CurveType,
  decryptEntry,
  decryptPrivateKeyHex,
  deriveAddress,
  derivePublicKey,
  encryptKeyEntry,
  encryptPrivateKeyHex,
  generateKeyPair,
  importFromGoKeystore,
} from "@canopynetwork/canopy-ts";
import type { GoKeystoreEntry } from "@canopynetwork/canopy-ts";

const PASSWORD = "correct horse battery staple"; // demo only — use a real secret
const KEYSTORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "keystore");

async function main() {
  // --- 1. Generate a fresh keypair ------------------------------------------
  //
  // generateKeyPair() creates an ed25519 key via CSPRNG and derives the
  // 20-byte Canopy address (40 hex chars, no 0x prefix).
  const kp = generateKeyPair();
  console.log("generated keypair");
  console.log(`  address:     ${kp.address}`);
  console.log(`  curve:       ${kp.curveType}`);
  console.log(`  privateKey:  ${kp.privateKeyHex.slice(0, 16)}... (keep secret)`);
  // Sanity: the address is just RIPEMD160(SHA256(pubkey)) — derive it manually.
  console.assert(
    deriveAddress(kp.publicKeyHex, CurveType.ED25519) === kp.address,
    "derived address matches generateKeyPair",
  );

  // --- 2. Encrypt it into a local keystore entry ----------------------------
  //
  // encryptKeyEntry() returns a ParsedKeystoreEntry — the SDK's native shape,
  // ready to hand to decryptEntry() or to a WalletManager storage adapter.
  const parsedEntry = await encryptKeyEntry(
    {
      privateKeyHex: kp.privateKeyHex,
      publicKeyHex: kp.publicKeyHex,
      address: kp.address,
      curveType: kp.curveType,
      nickname: "example-burner",
    },
    PASSWORD,
  );

  // --- 3. Unlock it again ----------------------------------------------------
  const recoveredPriv = await decryptEntry(parsedEntry, PASSWORD);
  console.assert(recoveredPriv === kp.privateKeyHex, "decryptEntry round-trips the private key");
  console.log(`\nunlocked via decryptEntry: ${recoveredPriv.slice(0, 16)}... ✓`);

  // --- 4. Export as a Go-keystore-compatible entry ---------------------------
  //
  // This is the shape the Go node's /v1/admin/keystore endpoints use:
  // { publicKey, salt, encrypted, keyAddress, keyNickname? }.
  mkdirSync(KEYSTORE_DIR, { recursive: true });
  const filePath = join(KEYSTORE_DIR, `${kp.address}.json`);
  const goEntry: GoKeystoreEntry = {
    publicKey: parsedEntry.publicKey,
    salt: parsedEntry.salt,
    encrypted: parsedEntry.encryptedPrivateKey,
    keyAddress: parsedEntry.address,
    keyNickname: parsedEntry.nickname,
  };
  writeFileSync(filePath, JSON.stringify(goEntry, null, 2));
  console.log(`\nwrote Go-compatible keystore file: ${filePath}`);

  // --- 5. Import it back (the Go-keystore import path) -----------------------
  //
  // importFromGoKeystore() detects the curve from the public key, re-derives
  // the address, and hard-fails on integrity mismatch (tampered entry).
  const fromDisk = JSON.parse(readFileSync(filePath, "utf8")) as GoKeystoreEntry;
  const reImported = importFromGoKeystore(fromDisk);
  console.log(`imported from Go keystore: address=${reImported.address} curve=${reImported.curveType}`);

  const unlockedAgain = await decryptEntry(reImported, PASSWORD);
  console.assert(unlockedAgain === kp.privateKeyHex, "import → decrypt round-trips");
  console.log("import → decrypt round-trip ✓");

  // --- 6. Tamper detection ---------------------------------------------------
  const bad = { ...fromDisk, keyAddress: "0000000000000000000000000000000000000000" };
  try {
    importFromGoKeystore(bad);
    console.error("ERROR: tampered entry was accepted");
  } catch (e) {
    console.log(`\ntampered entry rejected ✓ (${(e as Error).message.slice(0, 60)}...)`);
  }

  // --- 7. Importing an existing wallet's private key -------------------------
  //
  // If you already hold a hex private key (e.g. exported from the Canopy
  // desktop wallet), you don't need generateKeyPair — derive the public key
  // and address from it, then encrypt as above. Decrypt with the password to
  // recover the exact key.
  const existingKey = kp.privateKeyHex; // stand-in for an externally exported key
  const existingPub = derivePublicKey(existingKey, CurveType.ED25519);
  const existingAddr = deriveAddress(existingPub, CurveType.ED25519);
  const { encrypted, salt } = await encryptPrivateKeyHex(existingKey, PASSWORD);
  const back = await decryptPrivateKeyHex(encrypted, salt, PASSWORD);
  console.assert(back === existingKey, "encryptPrivateKeyHex/decryptPrivateKeyHex round-trip");
  console.log(`external key import path ✓ (address ${existingAddr})`);

  console.log("\ndone — inspect keystore/ if you want to see the encrypted format");
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
