import { describe, it, expect, vi, afterEach } from "vitest";
import {
  account,
  accountsBatch,
  blockByHash,
  blockByHeight,
  committee,
  committeeData,
  eventsByAddress,
  eventsByChain,
  failedTxs,
  getBalance,
  pool,
  txByHash,
  txsByRecipient,
  txsBySender,
  validator,
} from "../rpc.js";
import { CanopyError, ValidationError } from "../errors.js";

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** Drain an async generator so its validation runs. */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

afterEach(() => vi.restoreAllMocks());

const VALID_ADDR = "a".repeat(40);
const VALID_HASH = "b".repeat(64);

describe("argument validation throws ValidationError", () => {
  const badAddress = "z".repeat(40);

  const addressTakers: Array<[string, (addr: string) => Promise<unknown>]> = [
    ["account", (a) => account(a, { retry: false })],
    ["getBalance", (a) => getBalance(a, { retry: false })],
    ["validator", (a) => validator(a, { retry: false })],
    ["failedTxs", (a) => collect(failedTxs(a, { retry: false }))],
    ["txsBySender", (a) => collect(txsBySender(a, { retry: false }))],
    ["txsByRecipient", (a) => collect(txsByRecipient(a, { retry: false }))],
    ["eventsByAddress", (a) => collect(eventsByAddress(a, { retry: false }))],
  ];

  for (const [name, call] of addressTakers) {
    it(`${name}() rejects a short address with ValidationError`, async () => {
      const err = await call("invalid").catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toBeInstanceOf(CanopyError);
      expect(err.value).toBe("invalid");
    });

    it(`${name}() rejects a 40-character non-hex address`, async () => {
      expect(badAddress.length).toBe(40);
      await expect(call(badAddress)).rejects.toBeInstanceOf(ValidationError);
    });

    it(`${name}() accepts a 0x-prefixed address`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ results: [] })));
      await expect(call("0x" + VALID_ADDR)).resolves.toBeDefined();
    });
  }

  it("hash takers reject wrong-length and non-hex hashes", async () => {
    for (const call of [
      (h: string) => blockByHash(h, { retry: false }),
      (h: string) => txByHash(h, { retry: false }),
    ]) {
      await expect(call("abc")).rejects.toBeInstanceOf(ValidationError);
      await expect(call("b".repeat(63))).rejects.toBeInstanceOf(ValidationError);
      await expect(call("b".repeat(65))).rejects.toBeInstanceOf(ValidationError);
      await expect(call("z".repeat(64))).rejects.toBeInstanceOf(ValidationError);
      await expect(call(123 as unknown as string)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("normalizes an uppercase hash to lowercase on the wire", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetchMock);

    await txByHash("B".repeat(64), { retry: false });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).hash).toBe(VALID_HASH);
  });

  it("blockByHeight rejects non-positive and NaN heights", async () => {
    for (const h of [0, -1, Number.NaN]) {
      await expect(blockByHeight(h, { retry: false })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("id takers reject negative, NaN, and non-numeric ids", async () => {
    await expect(committeeData(-1, { retry: false })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      committeeData("x" as unknown as number, { retry: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      collect(eventsByChain(Number.NaN, { retry: false })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(collect(committee(-1, { retry: false }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("pool rejects an unknown poolType and names the valid ones", async () => {
    const err = await pool(1, { poolType: "nonsense", retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.value).toBe("nonsense");
    expect(err.message).toContain("subsidy");
  });

  it("validates before making any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await account("invalid", { retry: false }).catch(() => {});
    await blockByHeight(0, { retry: false }).catch(() => {});
    await txByHash("short", { retry: false }).catch(() => {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accountsBatch captures a bad address as an error entry instead of rejecting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ amount: 7 })));

    const results = await accountsBatch([VALID_ADDR, "invalid"], { retry: false });

    expect(results).toHaveLength(2);
    expect(results[0].amount).toBe(7);
    expect(results[1].address).toBe("invalid");
    expect(results[1].error).toContain("ValidationError");
  });
});
