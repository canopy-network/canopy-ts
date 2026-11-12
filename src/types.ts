export enum CurveType {
  ED25519 = "ed25519",
  BLS12381 = "bls12381",
  SECP256K1 = "secp256k1",
  ETHSECP256K1 = "ethsecp256k1",
}

export const KEY_SIZES = {
  PRIVATE: { ED25519: 32, BLS12381: 32, SECP256K1: 32, ETHSECP256K1: 32 },
  PUBLIC: { ED25519: 32, BLS12381: 48, SECP256K1: 33, ETHSECP256K1: 64 },
  SIGNATURE: { ED25519: 64, BLS12381: 96, SECP256K1: 64, ETHSECP256K1: 64 },
  ADDRESS: 20,
} as const;

export interface TransactionSignature {
  publicKey: string;
  signature: string;
}

export interface TransactionMessage {
  [key: string]: any;
}

export interface TransactionParams {
  type: string;
  msg: TransactionMessage;
  fee: number;
  memo?: string;
  networkID: number;
  chainID: number;
  height: number;
}

export interface MessageChangeByzantineOutputParams extends TransactionMessage {
  validatorAddress: string;
  outputAddress: string;
  signer: string;
  startHeight: number;
  endHeight: number;
  proposalHash?: string;
}

export interface WalletCredentials {
  encryptedPrivateKey: string;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export interface WalletAccount {
  address: string;
  publicKey: string;
  curveType: CurveType;
  credentials?: WalletCredentials;
}

/** A fully-unlocked signer identity (maps onto createAndSignTransaction args). */
export interface UnlockedAccount {
  address: string;
  publicKeyHex: string;
  privateKeyHex: string;
  curveType: CurveType;
}

/** A selectable account for a login UI (no secrets). */
export interface LoadedAccount {
  address: string;
  nickname: string;
}
