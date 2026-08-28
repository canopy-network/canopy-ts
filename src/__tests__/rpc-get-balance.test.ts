import { describe, it, expect, vi, afterEach } from "vitest";
import { getBalance } from "../rpc.js";
import { ResponseValidationError, RpcError, ValidationError } from "../errors.js";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("getBalance", () => {
  const validAddr40 = "a".repeat(40);

  it("returns the account's amount as a number", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ address: validAddr40, amount: 1000 }));
    vi.stubGlobal("fetch", fetchMock);

    const balance = await getBalance(validAddr40, { retry: false });

    expect(balance).toBe(1000);
    expect(typeof balance).toBe("number");
  });

  it("POSTs to /v1/query/account with the normalized address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ amount: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await getBalance(validAddr40, { baseUrl: "http://node:50002", retry: false });

    expect(fetchMock.mock.calls[0][0]).toBe("http://node:50002/v1/query/account");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.address).toBe(validAddr40);
  });

  it("strips the 0x prefix and lowercases the address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ amount: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await getBalance("0x" + "A".repeat(40), { retry: false });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.address).toBe(validAddr40);
  });

  it("queries the latest height by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ amount: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await getBalance(validAddr40, { retry: false });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).height).toBe(0);
  });

  it("queries a historical height when given one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ amount: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await getBalance(validAddr40, { height: 1000, retry: false });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).height).toBe(1000);
  });

  it("returns 0 when the account record carries no amount field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ address: validAddr40 })));

    expect(await getBalance(validAddr40, { retry: false })).toBe(0);
  });

  it("returns 0 rather than null when the node reports no amount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})));

    const balance = await getBalance(validAddr40, { retry: false });
    expect(balance).toBe(0);
    expect(balance).not.toBeNull();
  });

  it("preserves a zero balance rather than coercing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ amount: 0 })));

    expect(await getBalance(validAddr40, { retry: false })).toBe(0);
  });

  it("throws ResponseValidationError when amount is not a number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ amount: "1000" })));

    const err = await getBalance(validAddr40, { retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ResponseValidationError);
    expect(err.value).toEqual({ amount: "1000" });
  });

  it("throws ValidationError on a malformed address, without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const err = await getBalance("nope", { retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.value).toBe("nope");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates RpcError from the node", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));

    const err = await getBalance(validAddr40, { retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.status).toBe(500);
  });
});
