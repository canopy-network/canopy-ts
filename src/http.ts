/**
 * Internal HTTP layer: timeout + transient-only retry with exponential
 * backoff and jitter. Shared by all RPC helpers in `rpc.ts`.
 */
import { RpcError, TimeoutError } from "./errors.js";

/** Retry policy for a request. Pass `false` to {@link RequestOptions.retry} to disable. */
export interface RetryConfig {
  /** Max total attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Base backoff delay in ms; grows exponentially per attempt. Default 200. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay in ms. Default 5000. */
  maxDelayMs?: number;
}

/** Per-request options accepted by every RPC helper. */
export interface RequestOptions {
  /**
   * Origin to prefix the RPC path with (e.g. "http://localhost:50002").
   * Defaults to "" — works when requests are proxied by the dev server.
   */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Retry policy, or `false` to disable retries. Default: enabled with defaults. */
  retry?: RetryConfig | false;
  /** Caller-supplied abort signal; aborting rejects the request. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY: Required<RetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
};

/** Retry on rate-limiting and transient server errors only — never on 4xx (except 429). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function backoffDelay(attempt: number, cfg: Required<RetryConfig>): number {
  // attempt is 1-based; exponential growth with full jitter.
  const exp = Math.min(cfg.baseDelayMs * 2 ** (attempt - 1), cfg.maxDelayMs);
  return Math.round(exp * Math.random());
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function requestIdOf(res: Response): string | undefined {
  return (
    res.headers.get("x-request-id") ??
    res.headers.get("x-amzn-requestid") ??
    undefined
  );
}

/**
 * Perform a fetch with timeout and transient-retry, returning the raw
 * {@link Response} only when it is ok (2xx). Non-ok responses and network
 * failures throw {@link RpcError}; timeouts throw {@link TimeoutError}.
 *
 * @param label - human-readable operation name used in error messages
 */
export async function request(
  label: string,
  path: string,
  init: RequestInit,
  opts: RequestOptions = {},
): Promise<Response> {
  const baseUrl = opts.baseUrl ?? "";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retry: Required<RetryConfig> | null =
    opts.retry === false ? null : { ...DEFAULT_RETRY, ...(opts.retry ?? {}) };
  const maxAttempts = retry?.maxAttempts ?? 1;
  const url = `${baseUrl}${path}`;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    // Abort if either the caller's signal or our timeout fires.
    const onCallerAbort = () => timeoutController.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onCallerAbort, { once: true });
    if (opts.signal?.aborted) {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onCallerAbort);
      throw opts.signal.reason;
    }

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: timeoutController.signal });
    } catch (cause) {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);

      // Caller aborted — propagate, do not retry.
      if (opts.signal?.aborted) throw opts.signal.reason;

      // Our timeout fired.
      if (timeoutController.signal.aborted) {
        lastError = new TimeoutError(`${label} timed out after ${timeoutMs}ms`, {
          timeoutMs,
          cause,
        });
      } else {
        // Network-level failure — transient, retryable.
        lastError = new RpcError(`${label} request failed`, { cause });
      }

      if (attempt < maxAttempts) {
        await sleep(backoffDelay(attempt, retry!), opts.signal);
        continue;
      }
      throw lastError;
    }

    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);

    if (res.ok) return res;

    // Non-ok: build a typed error carrying status/requestId/body.
    const body = await res.text().catch(() => "");
    lastError = new RpcError(`${label} failed: ${res.status} ${res.statusText}`, {
      status: res.status,
      requestId: requestIdOf(res),
      body,
    });

    if (retry && isRetryableStatus(res.status) && attempt < maxAttempts) {
      await sleep(backoffDelay(attempt, retry), opts.signal);
      continue;
    }
    throw lastError;
  }

  // Unreachable, but satisfies the type checker.
  throw lastError ?? new RpcError(`${label} failed`);
}
