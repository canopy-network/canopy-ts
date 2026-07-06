import { z } from "zod";
import { importFromGoKeystore, GoKeystoreEntry, ParsedKeystoreEntry } from "./keystore.js";
import { ResponseValidationError } from "./errors.js";
import { request, RequestOptions } from "./http.js";

export type { RequestOptions, RetryConfig } from "./http.js";

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

const HeightResponseSchema = z.object({ height: z.number().int().nonnegative() });

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

// --- RPC helpers ------------------------------------------------------------

/**
 * Fetch all keystore entries from the Canopy admin RPC.
 * Calls GET /v1/admin/keystore (default port 50003).
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
 * Fetch the current block height from the Canopy public RPC.
 * Calls POST /v1/query/height (default port 50002).
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
 * Calls POST /v1/tx (default port 50002).
 */
export async function submitTx(tx: object, opts: RequestOptions = {}): Promise<void> {
  await request(
    "submitTx",
    "/v1/tx",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tx) },
    opts,
  );
}
