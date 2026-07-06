import { describe, expect, it } from "vitest";
import { deriveAddress, isValidAddress } from "../address.js";
import { CurveType } from "../types.js";

describe("deriveAddress", () => {
  it("derives addresses for valid public key sizes", () => {
    const publicKeys = [
      ["11".repeat(32), CurveType.ED25519],
      ["22".repeat(48), CurveType.BLS12381],
      ["02" + "33".repeat(32), CurveType.SECP256K1],
      ["44".repeat(64), CurveType.ETHSECP256K1],
      ["04" + "55".repeat(64), CurveType.ETHSECP256K1],
    ] as const;

    for (const [publicKey, curveType] of publicKeys) {
      expect(isValidAddress(deriveAddress(publicKey, curveType))).toBe(true);
    }
  });

  it("rejects public keys with invalid sizes", () => {
    const invalidPublicKeys = [
      ["11".repeat(31), CurveType.ED25519],
      ["22".repeat(47), CurveType.BLS12381],
      ["33".repeat(32), CurveType.SECP256K1],
      ["44".repeat(63), CurveType.ETHSECP256K1],
    ] as const;

    for (const [publicKey, curveType] of invalidPublicKeys) {
      expect(() => deriveAddress(publicKey, curveType)).toThrow("public key size");
    }
  });
});