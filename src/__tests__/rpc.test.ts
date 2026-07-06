import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchHeight, submitTx, fetchKeystore } from "../rpc.js";
import { ResponseValidationError, RpcError } from "../errors.js";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("fetchHeight", () => {
  it("returns the height from a valid response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ height: 42 })));
    expect(await fetchHeight({ retry: false })).toBe(42);
  });

  it("POSTs to /v1/query/height with the baseUrl prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ height: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchHeight({ baseUrl: "http://node:50002", retry: false });
    expect(fetchMock.mock.calls[0][0]).toBe("http://node:50002/v1/query/height");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("throws ResponseValidationError when height is missing/wrong type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ height: "not-a-number" })));
    const err = await fetchHeight({ retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ResponseValidationError);
    expect(err.value).toEqual({ height: "not-a-number" });
  });

  it("throws ResponseValidationError when height is fractional or negative", async () => {
    for (const height of [1.5, -1]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ height })));
      const err = await fetchHeight({ retry: false }).catch((e) => e);
      expect(err).toBeInstanceOf(ResponseValidationError);
      expect(err.value).toEqual({ height });
      vi.unstubAllGlobals();
    }
  });
});

describe("submitTx", () => {
  it("POSTs the serialized tx to /v1/tx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await submitTx({ a: 1 }, { retry: false });
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/tx");
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ a: 1 }));
  });

  it("throws RpcError carrying the server body on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("insufficient funds", { status: 400 })),
    );
    const err = await submitTx({}, { retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.body).toBe("insufficient funds");
  });
});

describe("fetchKeystore", () => {
  it("returns [] when addressMap is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})));
    expect(await fetchKeystore({ retry: false })).toEqual([]);
  });

  it("rejects a malformed keystore entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ addressMap: { addr1: { publicKey: 123 } } })),
    );
    const err = await fetchKeystore({ retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ResponseValidationError);
  });
});
