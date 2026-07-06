import { hexToBytes } from "@noble/hashes/utils.js";
import { CurveType, KEY_SIZES } from "./types.js";

export function detectPublicKeyCurve(publicKeyHex: string): CurveType {
  const bytes = hexToBytes(publicKeyHex);

  switch (bytes.length) {
    case KEY_SIZES.PUBLIC.ED25519:
      return CurveType.ED25519;
    case KEY_SIZES.PUBLIC.SECP256K1:
      return CurveType.SECP256K1;
    case KEY_SIZES.PUBLIC.BLS12381:
      return CurveType.BLS12381;
    case KEY_SIZES.PUBLIC.ETHSECP256K1:
      return CurveType.ETHSECP256K1;
    case 65:
      if (bytes[0] === 0x04) return CurveType.ETHSECP256K1;
      throw new Error("Unrecognized public key format: 65-byte ETHSECP256K1 keys must start with 0x04");
    default:
      throw new Error(`Unrecognized public key format: ${bytes.length} bytes`);
  }
}
