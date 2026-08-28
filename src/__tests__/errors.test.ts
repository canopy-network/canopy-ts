import { describe, it, expect } from "vitest";
import {
  CanopyError,
  RpcError,
  TimeoutError,
  ResponseValidationError,
  TransportError,
  ValidationError,
} from "../errors.js";

describe("error hierarchy", () => {
  it("all SDK errors extend CanopyError and Error", () => {
    for (const e of [
      new RpcError("x"),
      new TimeoutError("x", { timeoutMs: 1 }),
      new ResponseValidationError("x", { value: null }),
      new TransportError("x"),
      new ValidationError("x"),
    ]) {
      expect(e).toBeInstanceOf(CanopyError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("sets name to the concrete class", () => {
    expect(new RpcError("x").name).toBe("RpcError");
    expect(new TransportError("x").name).toBe("TransportError");
    expect(new ValidationError("x").name).toBe("ValidationError");
  });

  it("ValidationError carries the offending value", () => {
    const e = new ValidationError("bad address", { value: "nope" });
    expect(e.value).toBe("nope");
  });

  it("ValidationError's value is optional", () => {
    expect(new ValidationError("bad").value).toBeUndefined();
  });

  it("RpcError carries status, requestId, body", () => {
    const e = new RpcError("boom", { status: 503, requestId: "r1", body: "down" });
    expect(e.status).toBe(503);
    expect(e.requestId).toBe("r1");
    expect(e.body).toBe("down");
  });

  it("preserves cause", () => {
    const cause = new Error("root");
    expect(new RpcError("x", { cause }).cause).toBe(cause);
  });
});
