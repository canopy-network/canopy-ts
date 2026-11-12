/**
 * canopy-crypto/crypto
 *
 * Cryptographic primitives: key management, address derivation,
 * protobuf encoding, transaction signing, and wallet/keystore handling.
 */

export { CurveType, KEY_SIZES } from "./types.js";
export type {
  TransactionSignature,
  TransactionMessage,
  TransactionParams,
  MessageChangeByzantineOutputParams,
} from "./types.js";

export { signMessage, derivePublicKey } from "./signing.js";
export { deriveAddress, isValidAddress } from "./address.js";
export { detectPublicKeyCurve } from "./curve-detection.js";
export { decryptPrivateKey, decryptPrivateKeyHex } from "./wallet.js";
export { importFromGoKeystore, decryptEntry } from "./keystore.js";
export type { GoKeystoreEntry, ParsedKeystoreEntry } from "./keystore.js";

export {
  getSignBytesProtobuf,
  encodeMessage,
  registerMessageType,
  createProtobufEncoder,
} from "./protobuf.js";

export { createAndSignTransaction } from "./transaction.js";
export type {
  PluginTransaction,
  CoreTransaction,
  CreateAndSignTransactionOptions,
} from "./transaction.js";

export { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
