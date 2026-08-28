/**
 * Error hierarchy for the Canopy SDK.
 *
 * All errors thrown by the SDK extend {@link CanopyError}, so consumers can
 * catch the whole family with `instanceof CanopyError` or narrow to a specific
 * type (`instanceof RpcError`) to branch on failure mode.
 */

/** Base class for every error thrown by the SDK. */
export class CanopyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * An argument passed to an SDK function is malformed — a badly-shaped
 * address, a hash of the wrong length, an out-of-range height, and so on.
 *
 * Thrown before any network call is made, so receiving one means the request
 * never left the process.
 *
 * @example
 * ```ts
 * import { getBalance } from "@canopynetwork/canopy-ts/rpc";
 * import { ValidationError } from "@canopynetwork/canopy-ts/errors";
 *
 * try {
 *   await getBalance("not-an-address");
 * } catch (e) {
 *   if (e instanceof ValidationError) {
 *     console.error(e.message, e.value); // the offending input
 *   }
 * }
 * ```
 */
export class ValidationError extends CanopyError {
  /** The offending argument value, for logging and debugging. */
  readonly value: unknown;

  constructor(message: string, options?: { value?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.value = options?.value;
  }
}

/**
 * An RPC call reached the server but it returned a non-2xx response, or the
 * request failed at the network layer after exhausting retries.
 */
export class RpcError extends CanopyError {
  /** HTTP status code, if a response was received. */
  readonly status?: number;
  /** Value of the server's request-id header, if present (for support/debugging). */
  readonly requestId?: string;
  /** Raw response body, if one was read. */
  readonly body?: string;

  constructor(
    message: string,
    options?: { status?: number; requestId?: string; body?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.status = options?.status;
    this.requestId = options?.requestId;
    this.body = options?.body;
  }
}

/** A request did not complete within the configured timeout. */
export class TimeoutError extends CanopyError {
  /** The timeout that was exceeded, in milliseconds. */
  readonly timeoutMs: number;

  constructor(message: string, options: { timeoutMs: number; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.timeoutMs = options.timeoutMs;
  }
}

/** A server response did not match the expected schema. */
export class ResponseValidationError extends CanopyError {
  /** The raw value that failed validation. */
  readonly value: unknown;

  constructor(message: string, options: { value: unknown; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.value = options.value;
  }
}

/** A transport-layer operation failed. Reserved; no current SDK code path throws this. */
export class TransportError extends CanopyError {}
