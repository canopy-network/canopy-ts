import { detectPublicKeyCurve } from "./curve-detection.js";
import { deriveAddress } from "./address.js";
import { decryptPrivateKeyHex } from "./wallet.js";
import type { CurveType } from "./types.js";

export interface GoKeystoreEntry {
  publicKey: string;
  salt: string;
  encrypted: string;
  keyAddress: string;
  keyNickname?: string;
}

export interface ParsedKeystoreEntry {
  publicKey: string;
  encryptedPrivateKey: string;
  salt: string;
  address: string;
  curveType: CurveType;
  nickname?: string;
}

export function importFromGoKeystore(
  entry: GoKeystoreEntry
): ParsedKeystoreEntry {
  const curveType = detectPublicKeyCurve(entry.publicKey);

  const derivedAddress = deriveAddress(entry.publicKey, curveType);
  // Throw instead of warn: a mismatch means the entry is tampered or corrupted.
  // Silently importing the wrong address would cause funds to be sent to the
  // wrong destination or transactions to be rejected by the network.
  if (derivedAddress.toLowerCase() !== entry.keyAddress.toLowerCase()) {
    throw new Error(
      `Keystore integrity check failed: stored address ${entry.keyAddress} does not match address derived from public key ${derivedAddress}. The keystore entry may be corrupted or tampered.`
    );
  }

  return {
    publicKey: entry.publicKey,
    encryptedPrivateKey: entry.encrypted,
    salt: entry.salt,
    address: entry.keyAddress,
    curveType,
    nickname: entry.keyNickname,
  };
}

export async function decryptEntry(
  entry: ParsedKeystoreEntry,
  password: string
): Promise<string> {
  return decryptPrivateKeyHex(entry.encryptedPrivateKey, entry.salt, password);
}
