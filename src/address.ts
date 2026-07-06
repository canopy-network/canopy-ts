import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { CurveType, KEY_SIZES } from "./types.js";

function assertPublicKeySize(curveType: CurveType, length: number): void {
  switch (curveType) {
    case CurveType.ED25519:
      if (length !== KEY_SIZES.PUBLIC.ED25519) {
        throw new Error(`Invalid ED25519 public key size: ${length}`);
      }
      return;
    case CurveType.BLS12381:
      if (length !== KEY_SIZES.PUBLIC.BLS12381) {
        throw new Error(`Invalid BLS12381 public key size: ${length}`);
      }
      return;
    case CurveType.SECP256K1:
      if (length !== KEY_SIZES.PUBLIC.SECP256K1) {
        throw new Error(`Invalid SECP256K1 public key size: ${length}`);
      }
      return;
    case CurveType.ETHSECP256K1:
      if (length !== KEY_SIZES.PUBLIC.ETHSECP256K1 && length !== 65) {
        throw new Error(`Invalid ETHSECP256K1 public key size: ${length}`);
      }
      return;
    default:
      return;
  }
}

export function deriveAddress(
  publicKeyHex: string,
  curveType: CurveType
): string {
  const pubKeyBytes = hexToBytes(publicKeyHex);
  assertPublicKeySize(curveType, pubKeyBytes.length);

  switch (curveType) {
    case CurveType.ED25519: {
      const hash = sha256(pubKeyBytes);
      return bytesToHex(hash.slice(0, KEY_SIZES.ADDRESS));
    }
    case CurveType.BLS12381: {
      const hash = sha256(pubKeyBytes);
      return bytesToHex(hash.slice(0, KEY_SIZES.ADDRESS));
    }
    case CurveType.SECP256K1: {
      const sha = sha256(pubKeyBytes);
      const rip = ripemd160(sha);
      return bytesToHex(rip);
    }
    case CurveType.ETHSECP256K1: {
      let keyBytes = pubKeyBytes;
      if (pubKeyBytes.length === 65 && pubKeyBytes[0] === 0x04) {
        keyBytes = pubKeyBytes.slice(1);
      }
      const keccak = keccak_256(keyBytes);
      return bytesToHex(keccak.slice(12, 32));
    }
    default:
      throw new Error(`Unsupported curve type: ${curveType}`);
  }
}

export function isValidAddress(address: string): boolean {
  return /^[0-9a-fA-F]{40}$/.test(address);
}
