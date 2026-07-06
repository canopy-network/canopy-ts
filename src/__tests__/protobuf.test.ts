import { describe, expect, it } from "vitest";
import { encodeMessage } from "../protobuf.js";

const validSend = {
  fromAddress: "11".repeat(20),
  toAddress: "22".repeat(20),
  amount: 1,
};

describe("encodeMessage", () => {
  it("encodes a valid send amount", () => {
    const { typeUrl, msgBytes } = encodeMessage("send", validSend);

    expect(typeUrl).toBe("type.googleapis.com/types.MessageSend");
    expect(msgBytes.length).toBeGreaterThan(0);
  });

  it("rejects send amounts that cannot be encoded as uint64 values", () => {
    for (const amount of [-1, 1.5, Number.NaN]) {
      expect(() => encodeMessage("send", { ...validSend, amount })).toThrow(
        "amount must be a non-negative safe integer",
      );
    }
  });
});