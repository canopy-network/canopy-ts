import { z } from "zod";
import { importFromGoKeystore } from "./keystore.js";
import type { GoKeystoreEntry, ParsedKeystoreEntry } from "./keystore.js";
import { ResponseValidationError, ValidationError } from "./errors.js";
import { request } from "./http.js";
import type { RequestOptions } from "./http.js";

export type { RequestOptions, RetryConfig } from "./http.js";

// --- Argument validation ----------------------------------------------------

const HEX_RE = /^[0-9a-f]+$/;

/**
 * Normalize a hex address to the form the node expects: no `0x` prefix,
 * lowercase.
 *
 * @param label - Operation name, used to prefix the error message.
 * @param address - Hex address, 40 characters, with or without a `0x` prefix.
 * @returns The address as 40 lowercase hex characters, prefix stripped.
 * @throws {ValidationError} If `address` is not a 40-character hex string
 * (optionally `0x`-prefixed).
 */
function normalizeAddress(label: string, address: string): string {
  if (typeof address !== "string" || ![40, 42].includes(address.length)) {
    throw new ValidationError(`${label}: invalid address format: ${address}`, { value: address });
  }

  let normalized = address;
  if (normalized.startsWith("0x") || normalized.startsWith("0X")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.toLowerCase();

  if (normalized.length !== 40 || !HEX_RE.test(normalized)) {
    throw new ValidationError(`${label}: invalid address format: ${address}`, { value: address });
  }
  return normalized;
}

/**
 * Normalize a 64-character block or transaction hash to lowercase hex.
 *
 * @param label - Operation name, used to prefix the error message.
 * @param what - Noun describing the hash, e.g. `"block hash"`.
 * @param hash - Hash as 64 hex characters.
 * @returns The hash as 64 lowercase hex characters.
 * @throws {ValidationError} If `hash` is not a 64-character hex string.
 */
function normalizeHash(label: string, what: string, hash: string): string {
  const normalized = typeof hash === "string" ? hash.toLowerCase() : hash;
  if (typeof normalized !== "string" || normalized.length !== 64 || !HEX_RE.test(normalized)) {
    throw new ValidationError(`${label}: invalid ${what} format: ${hash}`, { value: hash });
  }
  return normalized;
}

/**
 * Assert that an ID (committee, chain, ...) is a non-negative integer.
 *
 * @param label - Operation name, used to prefix the error message.
 * @param what - Noun describing the ID, e.g. `"committee ID"`.
 * @param id - The value to check.
 * @throws {ValidationError} If `id` is not a non-negative number.
 */
function assertId(label: string, what: string, id: number): void {
  if (typeof id !== "number" || Number.isNaN(id) || id < 0) {
    throw new ValidationError(`${label}: invalid ${what}: ${id}`, { value: id });
  }
}

// --- PageParams for paginated endpoints ------------------------------------

/** Options accepted by {@link PageParams} and by every paginated query's `pageParams`. */
export interface PageParamsOptions {
  /** Page number, 1-indexed. Default 1. */
  page?: number;
  /** Results per page. Default 20 (the node caps this at 100). */
  per_page?: number;
  /** Field name to sort by. Endpoint-specific; omitted when unset. */
  order_by?: string;
  /** Sort descending. Default true. */
  desc?: boolean;
}

/**
 * Pagination parameters for list endpoints.
 *
 * Most consumers never need this — the paginated query functions
 * ({@link validators}, {@link txsByHeight}, ...) are async generators that
 * walk every page for you and take a plain {@link PageParamsOptions} object.
 * Construct a `PageParams` directly only when calling {@link postQuery}
 * against a paginated endpoint yourself.
 *
 * @example
 * ```ts
 * import { PageParams, postQuery } from "@canopynetwork/canopy-ts/rpc";
 *
 * const page = new PageParams({ page: 2, per_page: 50, order_by: "height" });
 * const raw = await postQuery("validators", "/v1/query/validators", page.toDict());
 * ```
 */
export class PageParams {
  page: number;
  per_page: number;
  order_by?: string;
  desc: boolean;

  constructor(opts?: PageParamsOptions) {
    this.page = opts?.page ?? 1;
    this.per_page = opts?.per_page ?? 20;
    this.order_by = opts?.order_by;
    this.desc = opts?.desc ?? true;
  }

  /**
   * Convert to the wire-format parameters the node's list endpoints expect.
   *
   * @returns An object with `pageNumber`, `perPage`, `desc`, and `orderBy`
   * (only when {@link PageParams.order_by} is set).
   * @example
   * ```ts
   * new PageParams({ page: 2, per_page: 50 }).toDict();
   * // { pageNumber: 2, perPage: 50, desc: true }
   * ```
   */
  toDict(): Record<string, any> {
    const params: Record<string, any> = {
      pageNumber: this.page,
      perPage: this.per_page,
      desc: this.desc,
    };
    if (this.order_by) {
      params.orderBy = this.order_by;
    }
    return params;
  }
}

// --- Response schemas -------------------------------------------------------

const GoKeystoreEntrySchema = z.object({
  publicKey: z.string(),
  salt: z.string(),
  encrypted: z.string(),
  // keyAddress may be absent on the wire — it is backfilled from the map key.
  keyAddress: z.string().optional(),
  keyNickname: z.string().optional(),
});

const KeystoreResponseSchema = z.object({
  addressMap: z.record(z.string(), GoKeystoreEntrySchema).optional(),
  nicknameMap: z.record(z.string(), z.string()).optional(),
});

const HeightResponseSchema = z.object({ height: z.number() });

/**
 * Build a Zod schema for one page of a paginated response.
 *
 * Validates the `results` array against `itemSchema` and passes through the
 * surrounding pagination envelope (`pageNumber`, `perPage`, `desc`, `total`,
 * `pages`, ...) untouched.
 *
 * @param itemSchema - Schema for a single item in the `results` array.
 * @returns A schema accepting `{ results: T[], ...pagination fields }`.
 * @example
 * ```ts
 * import { z } from "zod";
 * import { PageSchema, postQuery } from "@canopynetwork/canopy-ts/rpc";
 *
 * const Validators = PageSchema(z.object({ address: z.string() }));
 * const page = await postQuery(
 *   "validators", "/v1/query/validators", { pageNumber: 1, perPage: 20 }, {}, Validators,
 * );
 * page.results[0].address; // string
 * ```
 */
export function PageSchema<T>(itemSchema: z.ZodType<T>): z.ZodType<{ results: T[]; [key: string]: any }> {
  return z.object({
    results: z.array(itemSchema),
  }).passthrough();
}

/**
 * Drives one of this module's paginated query endpoints as an async
 * generator, advancing pages automatically — every paginated query
 * function below (`validators`, `committee`, `txsByHeight`,
 * `eventsByAddress`, ...) is a thin `yield*` wrapper around this, so
 * consumers get a plain `for await...of` over items instead of manual
 * page-by-page calls with page/per_page cursor plumbing.
 *
 * Stops when a page returns fewer than `per_page` results — the standard
 * last-page signal for offset/page pagination — or an empty/missing
 * `results` array. Does not itself validate the response shape; malformed
 * responses (missing/non-array `results`) are treated as an empty final
 * page rather than thrown, since `fetchPage` (via `postQuery`) doesn't
 * currently validate pagination responses against {@link PageSchema} either.
 */
async function* paginateQuery<T>(
  fetchPage: (params: PageParams) => Promise<Record<string, any>>,
  pageParams?: PageParamsOptions,
): AsyncGenerator<T, void, undefined> {
  const perPage = pageParams?.per_page ?? 20;
  let page = pageParams?.page ?? 1;

  for (;;) {
    const params = new PageParams({ ...pageParams, page, per_page: perPage });
    const response = await fetchPage(params);
    const results: T[] = Array.isArray(response?.results) ? response.results : [];

    for (const item of results) yield item;

    if (results.length < perPage) return;
    page += 1;
  }
}

/** Validate a parsed JSON body against a schema, throwing ResponseValidationError on mismatch. */
function validate<T>(label: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ResponseValidationError(`${label}: unexpected response shape`, {
      value,
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Generic POST helper for read-only RPC endpoints — the escape hatch for
 * querying an endpoint this module does not yet wrap.
 *
 * @param label - Human-readable operation name, used in error messages.
 * @param path - RPC endpoint path, e.g. `"/v1/query/account"`.
 * @param body - Request body; JSON-stringified before sending.
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @param schema - Optional Zod schema; when given, the response is validated
 * and the return type is narrowed to the schema's output.
 * @returns The parsed JSON response, validated against `schema` if provided.
 * @throws {ResponseValidationError} If `schema` is given and the response does
 * not match it.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @throws {TimeoutError} If the request exceeds `opts.timeoutMs`.
 * @example
 * ```ts
 * import { z } from "zod";
 * import { postQuery } from "@canopynetwork/canopy-ts/rpc";
 *
 * const { height } = await postQuery(
 *   "height", "/v1/query/height", {},
 *   { baseUrl: "https://node.example.com" },
 *   z.object({ height: z.number() }),
 * );
 * ```
 */
export async function postQuery<T = unknown>(
  label: string,
  path: string,
  body: Record<string, any>,
  opts: RequestOptions = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const res = await request(
    label,
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    opts,
  );
  const data = await res.json();
  if (schema) {
    return validate(label, schema, data);
  }
  return data as T;
}

// --- RPC helpers ------------------------------------------------------------

/**
 * Fetch every keystore entry from the Canopy admin RPC.
 *
 * Calls `GET /v1/admin/keystore` (default port 50003). Each entry's
 * `keyAddress` is backfilled from its map key when the node omits it.
 *
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @returns One parsed entry per address in the node's keystore; an empty array
 * if the keystore has no entries.
 * @throws {ResponseValidationError} If the response is not a keystore payload.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { fetchKeystore } from "@canopynetwork/canopy-ts/rpc";
 *
 * const entries = await fetchKeystore({ baseUrl: "http://localhost:50003" });
 * for (const entry of entries) console.log(entry.keyAddress, entry.keyNickname);
 * ```
 */
export async function fetchKeystore(
  opts: RequestOptions = {},
): Promise<ParsedKeystoreEntry[]> {
  const res = await request("fetchKeystore", "/v1/admin/keystore", { method: "GET" }, opts);
  const data = validate("fetchKeystore", KeystoreResponseSchema, await res.json());
  if (!data.addressMap) return [];

  return Object.entries(data.addressMap).map(([address, entry]) => {
    const fullEntry: GoKeystoreEntry = {
      ...(entry as GoKeystoreEntry),
      keyAddress: entry.keyAddress ?? address,
    };
    return importFromGoKeystore(fullEntry);
  });
}

/**
 * Fetch the chain's latest committed block height.
 *
 * Calls `POST /v1/query/height` (default port 50002). This is the value to
 * pass as a transaction's `height` when building one.
 *
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @returns The latest committed block height.
 * @throws {ResponseValidationError} If the response has no numeric `height`.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { fetchHeight } from "@canopynetwork/canopy-ts/rpc";
 *
 * const height = await fetchHeight({ baseUrl: "https://node.example.com" });
 * console.log(`chain is at block ${height}`);
 * ```
 */
export async function fetchHeight(opts: RequestOptions = {}): Promise<number> {
  const res = await request(
    "fetchHeight",
    "/v1/query/height",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    opts,
  );
  const data = validate("fetchHeight", HeightResponseSchema, await res.json());
  return data.height;
}

/**
 * Submit a signed transaction to the Canopy public RPC.
 *
 * Calls `POST /v1/tx` (default port 50002). A 2xx response means the node
 * accepted the transaction into its mempool — not that it has been committed;
 * poll {@link txByHash} to confirm inclusion in a block.
 *
 * @param tx - A signed transaction, as built by `createAndSignTransaction`.
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @returns The node's response body. Most nodes return the transaction hash as
 * a bare JSON string; some wrap it as `{ txHash }` or `{ hash }`.
 * @throws {RpcError} On a non-2xx response (e.g. a rejected transaction, whose
 * reason is on `RpcError.body`) or a network failure.
 * @example
 * ```ts
 * import { submitTx } from "@canopynetwork/canopy-ts/rpc";
 * import { RpcError } from "@canopynetwork/canopy-ts/errors";
 *
 * try {
 *   const res = await submitTx(signedTx, { baseUrl: "https://node.example.com" });
 *   console.log("submitted:", res);
 * } catch (e) {
 *   if (e instanceof RpcError) console.error("rejected:", e.body);
 * }
 * ```
 */
export async function submitTx(tx: object, opts: RequestOptions = {}): Promise<Record<string, unknown>> {
  const res = await request(
    "submitTx",
    "/v1/tx",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tx) },
    opts,
  );
  return res.json();
}

// --- Query methods ----------------------------------------------------------

/**
 * Get an account's full on-chain record.
 *
 * For just the spendable balance, prefer {@link getBalance} — it returns a
 * validated `number` instead of an untyped record.
 *
 * @param address - Hex address, 40 characters, with or without a `0x` prefix.
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The account record: `address`, `amount` (spendable balance), and
 * any further fields the node reports.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { account } from "@canopynetwork/canopy-ts/rpc";
 *
 * const acct = await account("3db4b1ec0d9206365696e0c3a52a519840060c86", {
 *   baseUrl: "https://node.example.com",
 * });
 * console.log(acct.amount);
 * ```
 */
export async function account(
  address: string,
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const normalizedAddr = normalizeAddress("account", address);
  const { height = 0, ...requestOpts } = opts;

  return postQuery("account", "/v1/query/account", {
    address: normalizedAddr,
    height,
  }, requestOpts);
}

/** Response shape validated by {@link getBalance}. */
const BalanceResponseSchema = z
  .object({ amount: z.number().optional() })
  .passthrough();

/**
 * Get an account's spendable balance, as a plain number.
 *
 * A convenience wrapper over {@link account}: it validates the node's reply
 * and pulls out the balance, so you don't have to reach into an untyped
 * record to find it. When the account record carries no `amount` field, the
 * balance is reported as `0`.
 *
 * The value is in the chain's smallest denomination, the same unit a
 * transaction's `amount` and `fee` use.
 *
 * Note that how a node answers for an address it has no record of is the
 * node's choice: it may return an empty account record, in which case this
 * returns `0`, or reject the query, in which case the {@link RpcError}
 * propagates. Catch `RpcError` if you need to treat both as "no balance".
 *
 * @param address - Hex address, 40 characters, with or without a `0x` prefix.
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The spendable balance; `0` when the account record reports no
 * `amount`.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {ResponseValidationError} If the node reports a non-numeric `amount`.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { getBalance } from "@canopynetwork/canopy-ts/rpc";
 *
 * const balance = await getBalance("3db4b1ec0d9206365696e0c3a52a519840060c86", {
 *   baseUrl: "https://node.example.com",
 * });
 * if (balance === 0) console.log("account is empty");
 *
 * // balance at a past height
 * const past = await getBalance(address, { baseUrl, height: 1000 });
 * ```
 */
export async function getBalance(
  address: string,
  opts: RequestOptions & { height?: number } = {},
): Promise<number> {
  const normalizedAddr = normalizeAddress("getBalance", address);
  const { height = 0, ...requestOpts } = opts;

  const data = await postQuery(
    "getBalance",
    "/v1/query/account",
    { address: normalizedAddr, height },
    requestOpts,
    BalanceResponseSchema,
  );
  return data.amount ?? 0;
}

/**
 * Get the block committed at a specific height.
 *
 * @param height - Block height. Must be greater than 0; unlike the query
 * endpoints that take an `opts.height`, `0` is not a "latest" sentinel here.
 * Pair with {@link fetchHeight} to fetch the newest block.
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @returns The block: header, transactions, and metadata.
 * @throws {ValidationError} If `height` is not a number greater than 0.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { fetchHeight, blockByHeight } from "@canopynetwork/canopy-ts/rpc";
 *
 * const opts = { baseUrl: "https://node.example.com" };
 * const latest = await blockByHeight(await fetchHeight(opts), opts);
 * ```
 */
export async function blockByHeight(
  height: number,
  opts: RequestOptions = {},
): Promise<Record<string, any>> {
  if (typeof height !== "number" || Number.isNaN(height) || height <= 0) {
    throw new ValidationError("blockByHeight: height must be greater than 0", { value: height });
  }

  return postQuery("blockByHeight", "/v1/query/block-by-height", {
    height,
  }, opts);
}

/**
 * Get a block by its hash.
 *
 * @param blockHash - Block hash, 64 hex characters.
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @returns The block: header, transactions, and metadata.
 * @throws {ValidationError} If `blockHash` is not a 64-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { blockByHash } from "@canopynetwork/canopy-ts/rpc";
 *
 * const block = await blockByHash(hash, { baseUrl: "https://node.example.com" });
 * ```
 */
export async function blockByHash(
  blockHash: string,
  opts: RequestOptions = {},
): Promise<Record<string, any>> {
  const hash = normalizeHash("blockByHash", "block hash", blockHash);

  return postQuery("blockByHash", "/v1/query/block-by-hash", {
    hash,
  }, opts);
}

/**
 * Get a committed transaction by its hash.
 *
 * Only finds transactions already included in a block — a just-submitted
 * transaction still in the mempool is not returned (the node replies 404,
 * surfaced as an {@link RpcError} with `status` 404). Poll this to confirm
 * that a {@link submitTx} call landed on chain.
 *
 * @param txHash - Transaction hash, 64 hex characters.
 * @param opts - Request options (`baseUrl`, `timeoutMs`, `retry`, `signal`).
 * @returns The transaction, with its height and result.
 * @throws {ValidationError} If `txHash` is not a 64-character hex string.
 * @throws {RpcError} On a non-2xx response (404 while still pending) or a
 * network failure.
 * @example
 * ```ts
 * import { txByHash } from "@canopynetwork/canopy-ts/rpc";
 * import { RpcError } from "@canopynetwork/canopy-ts/errors";
 *
 * try {
 *   const tx = await txByHash(hash, { baseUrl: "https://node.example.com" });
 *   console.log("committed at height", tx.height);
 * } catch (e) {
 *   if (e instanceof RpcError && e.status === 404) console.log("still pending");
 * }
 * ```
 */
export async function txByHash(
  txHash: string,
  opts: RequestOptions = {},
): Promise<Record<string, any>> {
  const hash = normalizeHash("txByHash", "transaction hash", txHash);

  return postQuery("txByHash", "/v1/query/tx-by-hash", {
    hash,
  }, opts);
}

/**
 * Iterate every failed mempool transaction for an address, advancing pages
 * automatically.
 *
 * Scoped to the node you query: Canopy does not include failed transactions
 * in blocks, so there is no global index — this reflects only what failed
 * locally on that node.
 *
 * @param address - Hex address of the sender, 40 characters, with or without
 * a `0x` prefix.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the failed transactions.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { failedTxs } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const tx of failedTxs(address, { baseUrl })) {
 *   console.error("failed:", tx);
 * }
 * ```
 */
export async function* failedTxs(
  address: string,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const normalizedAddr = normalizeAddress("failedTxs", address);
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("failedTxs", "/v1/query/failed-txs", {
      address: normalizedAddr,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Iterate every transaction in a block, advancing pages automatically.
 *
 * @param height - Block height. `0` (the default) means the latest committed
 * height.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the block's transactions.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { txsByHeight } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const tx of txsByHeight(0, { baseUrl })) {
 *   console.log(tx);
 * }
 * ```
 */
export async function* txsByHeight(
  height: number = 0,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("txsByHeight", "/v1/query/txs-by-height", {
      height,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Iterate every transaction sent by an address, advancing pages
 * automatically.
 *
 * @param address - Hex address of the sender, 40 characters, with or without
 * a `0x` prefix.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the address's outgoing transactions.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { txsBySender } from "@canopynetwork/canopy-ts/rpc";
 *
 * // newest 50 at a time; break out early once you have what you need
 * for await (const tx of txsBySender(address, { baseUrl, pageParams: { per_page: 50 } })) {
 *   console.log(tx);
 *   break;
 * }
 * ```
 */
export async function* txsBySender(
  address: string,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const normalizedAddr = normalizeAddress("txsBySender", address);
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("txsBySender", "/v1/query/txs-by-sender", {
      address: normalizedAddr,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Iterate every transaction received by an address, advancing pages
 * automatically.
 *
 * @param address - Hex address of the recipient, 40 characters, with or
 * without a `0x` prefix.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the address's incoming transactions.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { txsByRecipient } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const tx of txsByRecipient(address, { baseUrl })) {
 *   console.log("received:", tx);
 * }
 * ```
 */
export async function* txsByRecipient(
  address: string,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const normalizedAddr = normalizeAddress("txsByRecipient", address);
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("txsByRecipient", "/v1/query/txs-by-rec", {
      address: normalizedAddr,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Iterate every unconfirmed transaction in the node's mempool, advancing
 * pages automatically.
 *
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the pending transactions.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { pending } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const tx of pending({ baseUrl })) {
 *   console.log("awaiting inclusion:", tx);
 * }
 * ```
 */
export async function* pending(
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("pending", "/v1/query/pending", params.toDict(), requestOpts),
    pageParams,
  );
}

/**
 * Look up many accounts concurrently.
 *
 * Issues one {@link account} request per address in parallel. A single
 * address failing does not abort the rest — that entry carries an `error`
 * string instead of account data, so this function does not reject on a
 * per-address failure.
 *
 * @param addresses - Hex addresses, 40 characters each, with or without a
 * `0x` prefix.
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns One entry per input address, in the same order: either the account
 * record with `address` merged in, or `{ address, error }` if that lookup
 * failed (including an invalid address, whose {@link ValidationError} is
 * captured into `error` rather than thrown).
 * @example
 * ```ts
 * import { accountsBatch } from "@canopynetwork/canopy-ts/rpc";
 *
 * const results = await accountsBatch([addrA, addrB], { baseUrl });
 * for (const r of results) {
 *   if (r.error) console.warn(r.address, "failed:", r.error);
 *   else console.log(r.address, r.amount);
 * }
 * ```
 */
export async function accountsBatch(
  addresses: string[],
  opts: RequestOptions & { height?: number } = {},
): Promise<Array<Record<string, any>>> {
  const { height = 0, ...requestOpts } = opts;

  async function queryOne(address: string): Promise<Record<string, any>> {
    try {
      const result = await account(address, { height, ...requestOpts });
      return { ...result, address };
    } catch (e) {
      return { address, error: String(e) };
    }
  }

  return Promise.all(addresses.map(queryOne));
}

/**
 * Get committee data for one chain/committee.
 *
 * @param committeeId - Committee/chain ID. Must be a non-negative number.
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The committee's data: last chain height, last root height, and
 * related fields.
 * @throws {ValidationError} If `committeeId` is not a non-negative number.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { committeeData } from "@canopynetwork/canopy-ts/rpc";
 *
 * const data = await committeeData(1, { baseUrl });
 * ```
 */
export async function committeeData(
  committeeId: number,
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  assertId("committeeData", "committee ID", committeeId);
  const { height = 0, ...requestOpts } = opts;

  return postQuery("committeeData", "/v1/query/committee-data", {
    id: committeeId,
    height,
  }, requestOpts);
}

/**
 * Get committee data for every chain/committee at once.
 *
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns Data for all committees.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { committeesData } from "@canopynetwork/canopy-ts/rpc";
 *
 * const all = await committeesData({ baseUrl });
 * ```
 */
export async function committeesData(
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("committeesData", "/v1/query/committees-data", {
    height,
  }, requestOpts);
}

/**
 * Get the retired committee/chain IDs.
 *
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The node's retired-committee payload.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { retiredCommittees } from "@canopynetwork/canopy-ts/rpc";
 *
 * const retired = await retiredCommittees({ baseUrl });
 * ```
 */
export async function retiredCommittees(
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("retiredCommittees", "/v1/query/retired-committees", {
    height,
  }, requestOpts);
}

/**
 * Get the chain IDs that receive a share of the block reward.
 *
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The node's subsidized-committee payload.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { subsidizedCommittees } from "@canopynetwork/canopy-ts/rpc";
 *
 * const subsidized = await subsidizedCommittees({ baseUrl });
 * ```
 */
export async function subsidizedCommittees(
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("subsidizedCommittees", "/v1/query/subsidized-committees", {
    height,
  }, requestOpts);
}

/**
 * Iterate every chain event involving an address, advancing pages
 * automatically.
 *
 * @param address - Hex address, 40 characters, with or without a `0x` prefix.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the address's events.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { eventsByAddress } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const event of eventsByAddress(address, { baseUrl })) {
 *   console.log(event);
 * }
 * ```
 */
export async function* eventsByAddress(
  address: string,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const normalizedAddr = normalizeAddress("eventsByAddress", address);
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("eventsByAddress", "/v1/query/events-by-address", {
      address: normalizedAddr,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Iterate every event for a chain/committee, advancing pages automatically.
 *
 * @param chainId - Chain/committee ID. Must be a non-negative number.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the chain's events.
 * @throws {ValidationError} If `chainId` is not a non-negative number.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { eventsByChain } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const event of eventsByChain(1, { baseUrl })) {
 *   console.log(event);
 * }
 * ```
 */
export async function* eventsByChain(
  chainId: number,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  assertId("eventsByChain", "chain ID", chainId);
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("eventsByChain", "/v1/query/events-by-chain", {
      id: chainId,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Iterate every event emitted at a block height, advancing pages
 * automatically.
 *
 * @param height - Block height. `0` (the default) means the latest committed
 * height.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`).
 * @returns An async generator over the block's events.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { eventsByHeight } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const event of eventsByHeight(0, { baseUrl })) {
 *   console.log(event);
 * }
 * ```
 */
export async function* eventsByHeight(
  height: number = 0,
  opts: RequestOptions & { pageParams?: PageParamsOptions } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const { pageParams, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("eventsByHeight", "/v1/query/events-by-height", {
      height,
      ...params.toDict(),
    }, requestOpts),
    pageParams,
  );
}

/**
 * Get one validator's record.
 *
 * @param address - Validator's hex address, 40 characters, with or without a
 * `0x` prefix.
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The validator record: staked amount, status, and related fields.
 * @throws {ValidationError} If `address` is not a 40-character hex string.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { validator } from "@canopynetwork/canopy-ts/rpc";
 *
 * const v = await validator(address, { baseUrl });
 * ```
 */
export async function validator(
  address: string,
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const normalizedAddr = normalizeAddress("validator", address);
  const { height = 0, ...requestOpts } = opts;

  return postQuery("validator", "/v1/query/validator", {
    address: normalizedAddr,
    height,
  }, requestOpts);
}

/**
 * Iterate the whole validator set, advancing pages automatically.
 *
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`) and `height` to query a
 * historical block (`0`, the default, means the latest committed height).
 * @returns An async generator over every validator.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { validators } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const v of validators({ baseUrl })) {
 *   console.log(v);
 * }
 * ```
 */
export async function* validators(
  opts: RequestOptions & { pageParams?: PageParamsOptions; height?: number } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const { pageParams, height = 0, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("validators", "/v1/query/validators", {
      ...params.toDict(),
      height,
    }, requestOpts),
    pageParams,
  );
}

/**
 * Get token supply totals.
 *
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns Supply figures: total, staked, burned, and related fields.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { supply } from "@canopynetwork/canopy-ts/rpc";
 *
 * const totals = await supply({ baseUrl });
 * ```
 */
export async function supply(
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("supply", "/v1/query/supply", {
    height,
  }, requestOpts);
}

/**
 * Get the network's governance parameters.
 *
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns All parameter groups: fee, governance, validator, and consensus.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { params } from "@canopynetwork/canopy-ts/rpc";
 *
 * const all = await params({ baseUrl });
 * ```
 */
export async function params(
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("params", "/v1/query/params", {
    height,
  }, requestOpts);
}

/**
 * Get the network's fee parameters — the per-message-type minimum fees to
 * put on a transaction you are about to build.
 *
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The fee parameters, keyed per message type (`sendFee`, `stakeFee`,
 * ...).
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { fees } from "@canopynetwork/canopy-ts/rpc";
 *
 * const { sendFee } = await fees({ baseUrl });
 * ```
 */
export async function fees(
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("fees", "/v1/query/fee-params", {
    height,
  }, requestOpts);
}

/**
 * Iterate a committee's members, advancing pages automatically.
 *
 * @param committeeId - Committee/chain ID. Must be a non-negative number.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`) and `height` to query a
 * historical block (`0`, the default, means the latest committed height).
 * @returns An async generator over the committee's members.
 * @throws {ValidationError} If `committeeId` is not a non-negative number.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { committee } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const member of committee(1, { baseUrl })) {
 *   console.log(member);
 * }
 * ```
 */
export async function* committee(
  committeeId: number,
  opts: RequestOptions & { pageParams?: PageParamsOptions; height?: number } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  assertId("committee", "committee ID", committeeId);
  const { pageParams, height = 0, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("committee", "/v1/query/committee", {
      ...params.toDict(),
      committeeID: committeeId,
      height,
    }, requestOpts),
    pageParams,
  );
}

// Pool addends matching Go: uint64(N * math.MaxUint16 / 4)
// Note: math.MaxUint16 = 65535 (2^16 - 1), so:
// subsidy: 0 * 65535 / 4 = 0
// holding: 1 * 65535 / 4 = 16383
// liquidity: 2 * 65535 / 4 = 32767
// escrow: 4 * 65535 / 4 = 65535
const POOL_ADDENDS: Record<string, number> = {
  subsidy: 0,
  holding: Math.floor(1 * 65535 / 4),     // 16383
  liquidity: Math.floor(2 * 65535 / 4),   // 32767
  escrow: Math.floor(4 * 65535 / 4),      // 65535
};

async function queryPool(
  poolId: number,
  requestOpts: RequestOptions,
): Promise<Record<string, any>> {
  return postQuery("queryPool", "/v1/query/pool", {
    id: poolId,
  }, requestOpts);
}

/**
 * Query a committee's pool balance.
 *
 * A chain has four pools, addressed by adding a fixed offset to the chain ID.
 * This resolves that arithmetic for you and reports the resulting `pool_id`
 * on the result.
 *
 * @param chainId - The committee/chain ID.
 * @param opts - Request options, plus `poolType`: `"subsidy"` (the default),
 * `"holding"`, `"liquidity"`, `"escrow"`, or `"all"` to fetch every pool.
 * @returns One pool's data with its `pool_id` merged in; or, for
 * `poolType: "all"`, an object keyed by pool name whose values are those
 * per-pool results.
 * @throws {ValidationError} If `poolType` is not one of the names above.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { pool } from "@canopynetwork/canopy-ts/rpc";
 *
 * const subsidy = await pool(1, { baseUrl });
 * const every = await pool(1, { baseUrl, poolType: "all" });
 * console.log(every.escrow.pool_id);
 * ```
 */
export async function pool(
  chainId: number,
  opts: RequestOptions & { poolType?: string } = {},
): Promise<Record<string, any>> {
  const { poolType = "subsidy", ...requestOpts } = opts;

  if (poolType === "all") {
    const results: Record<string, any> = {};
    for (const [name, addend] of Object.entries(POOL_ADDENDS)) {
      const poolResult = await queryPool(chainId + addend, requestOpts);
      results[name] = { ...poolResult, pool_id: chainId + addend };
    }
    return results;
  }

  const addend = POOL_ADDENDS[poolType];
  if (addend === undefined) {
    throw new ValidationError(
      `pool: unknown poolType '${poolType}'. Valid: ${Object.keys(POOL_ADDENDS).join(", ")}, 'all'`,
      { value: poolType },
    );
  }

  const result = await queryPool(chainId + addend, requestOpts);
  result.pool_id = chainId + addend;
  return result;
}

/**
 * Query the not-yet-locked DEX batch for a committee.
 *
 * The queue MessageDexLiquidityDeposit/MessageDexLiquidityWithdraw append to before
 * it's locked and settled (typically 1-2 block cycles later). Useful for confirming
 * a deposit/withdraw was actually queued, since settlement itself requires a
 * counterpart chain to process the batch.
 *
 * @param chainId - The committee/chain ID — the same id passed as
 * `committee_id` to deposit/withdraw, i.e. the COUNTER-ASSET chain, not
 * necessarily the chain being submitted to.
 * @param opts - Request options, plus `height` to query a historical block
 * (`0`, the default, means the latest committed height).
 * @returns The pending DEX batch.
 * @throws {RpcError} On a non-2xx response or a network failure.
 * @example
 * ```ts
 * import { nextDexBatch } from "@canopynetwork/canopy-ts/rpc";
 *
 * const batch = await nextDexBatch(1, { baseUrl });
 * ```
 */
export async function nextDexBatch(
  chainId: number,
  opts: RequestOptions & { height?: number } = {},
): Promise<Record<string, any>> {
  const { height = 0, ...requestOpts } = opts;

  return postQuery("nextDexBatch", "/v1/query/next-dex-batch", {
    id: chainId,
    height,
  }, requestOpts);
}

/**
 * Iterates every open DEX sell order for a committee, advancing pages
 * automatically.
 *
 * Each result's `id` is the order's hex order ID — the same value
 * edit-order/delete-order expect for their `order_id` argument.
 *
 * @param committeeId - The committee the orders belong to, the same id passed
 * as `committee_id` to create-order/edit-order/delete-order.
 * @param opts - Request options, plus `pageParams` to tune page size and sort
 * order (`{ page, per_page, order_by, desc }`) and `height` to query a
 * historical block (`0`, the default, means the latest committed height).
 * @returns An async generator over the committee's open sell orders.
 * @throws {RpcError} On a non-2xx response or a network failure, raised while
 * iterating.
 * @example
 * ```ts
 * import { orders } from "@canopynetwork/canopy-ts/rpc";
 *
 * for await (const order of orders(1, { baseUrl })) {
 *   console.log(order.id);
 * }
 * ```
 */
export async function* orders(
  committeeId: number,
  opts: RequestOptions & { pageParams?: PageParamsOptions; height?: number } = {},
): AsyncGenerator<Record<string, any>, void, undefined> {
  const { pageParams, height = 0, ...requestOpts } = opts;
  yield* paginateQuery(
    (params) => postQuery("orders", "/v1/query/orders", {
      ...params.toDict(),
      committee: committeeId,
      height,
    }, requestOpts),
    pageParams,
  );
}
