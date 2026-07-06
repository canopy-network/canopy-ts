import { describe, it, expect, vi, afterEach } from "vitest";
import { request } from "../http.js";
import { RpcError, TimeoutError } from "../errors.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("request", () => {
  it("returns the response on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request("op", "/path", { method: "GET" }, { retry: false });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/path");
  });

  it("prefixes baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await request("op", "/path", { method: "GET" }, { baseUrl: "http://h:1", retry: false });
    expect(fetchMock.mock.calls[0][0]).toBe("http://h:1/path");
  });

  it("throws RpcError with status/requestId/body on non-ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("nope", {
        status: 400,
        statusText: "Bad Request",
        headers: { "x-request-id": "req-123" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await request("op", "/p", { method: "GET" }, { retry: false }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.status).toBe(400);
    expect(err.requestId).toBe("req-123");
    expect(err.body).toBe("nope");
    // 4xx must not be retried
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(
      "op",
      "/p",
      { method: "GET" },
      { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 } },
    );
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await request("op", "/p", { method: "GET" }, { retry: { baseDelayMs: 1, maxDelayMs: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts and throws the last RpcError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await request(
      "op",
      "/p",
      { method: "GET" },
      { retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 } },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on network error then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await request("op", "/p", { method: "GET" }, { retry: { baseDelayMs: 1, maxDelayMs: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when the caller signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    const err = await request(
      "op",
      "/p",
      { method: "GET" },
      { signal: controller.signal, retry: false },
    ).catch((e) => e);
    expect(err).toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws TimeoutError when the request exceeds timeoutMs", async () => {
    // fetch that rejects with an abort-style error when its signal aborts
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const err = await request(
      "op",
      "/p",
      { method: "GET" },
      { timeoutMs: 10, retry: false },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.timeoutMs).toBe(10);
  });
});
