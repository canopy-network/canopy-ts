import { describe, expect, it } from "vitest";
import { detectPublicKeyCurve } from "../curve-detection.js";
import { CurveType } from "../types.js";

describe("detectPublicKeyCurve", () => {
  it("accepts raw and uncompressed Ethereum secp256k1 public keys", () => {
    expect(detectPublicKeyCurve("11".repeat(64))).toBe(CurveType.ETHSECP256K1);
    expect(detectPublicKeyCurve("04" + "11".repeat(64))).toBe(CurveType.ETHSECP256K1);
  });

  it("rejects 65-byte Ethereum secp256k1 public keys without the uncompressed prefix", () => {
    expect(() => detectPublicKeyCurve("05" + "11".repeat(64))).toThrow(
      "65-byte ETHSECP256K1 keys must start with 0x04",
    );
  });
});