/**
 * The guestbook chain client.
 *
 * This module is the whole integration surface between the UI and the chain, and it is plain
 * TypeScript with no React in it, so the node scripts under ../../scripts reuse it verbatim.
 *
 * Two different servers are involved, and it matters which is which:
 *
 *   - The Canopy node's public RPC (:50002) knows about heights, accounts, fees, and accepts
 *     signed transactions. That is consensus and networking — it knows nothing about posts.
 *   - The go-plugin's own HTTP server (:50010) serves the guestbook feed, because the plugin is
 *     the only process that knows how to decode a Post out of raw state.
 */
import {
  CurveType,
  createAndSignTransaction,
  createProtobufEncoder,
  registerMessageType,
  hexToBytes,
} from "@canopynetwork/canopy-ts/crypto";
import { fetchHeight, submitTx, account, fees } from "@canopynetwork/canopy-ts/rpc";
import { NodePool } from "@canopynetwork/canopy-ts/node-pool";
import { RpcError, TimeoutError } from "@canopynetwork/canopy-ts/errors";
import { config } from "./config.js";

/* -------------------------------------------------------------------------- */
/* Message registration                                                        */
/* -------------------------------------------------------------------------- */

/** The transaction name, matching ContractConfig.SupportedTransactions in the plugin. */
export const POST_MESSAGE_TX_TYPE = "post_message";
/** The type url, matching ContractConfig.TransactionTypeUrls at the same index. */
export const POST_MESSAGE_TYPE_NAME = "types.MessagePost";

/**
 * The wire encoder for MessagePost. The field names, numbers and types mirror proto/tx.proto in
 * the plugin exactly — the node recomputes the sign bytes from what it receives, so a mismatch
 * here does not fail loudly, it just produces "invalid signature".
 *
 * There is no need to strip proto3 default values (the SDK does that internally for its built-in
 * types): CheckTx rejects an empty content and a non-20-byte author, so neither field is ever at
 * its zero value in a transaction the chain would have accepted anyway.
 */
const MessagePost = createProtobufEncoder(
  {
    author_address: { type: "bytes", id: 1 },
    content: { type: "string", id: 2 },
  },
  POST_MESSAGE_TYPE_NAME,
);

let registered = false;

/**
 * Teach the SDK about this chain's custom transaction. Safe to call repeatedly — registration is
 * global to the SDK's message registry, so it only needs to happen once per process.
 */
export function registerGuestbookMessages(): void {
  if (registered) return;
  registerMessageType(
    POST_MESSAGE_TX_TYPE,
    POST_MESSAGE_TYPE_NAME,
    (msg: { authorAddress: string; content: string }) =>
      MessagePost.encode(
        MessagePost.create({
          author_address: hexToBytes(msg.authorAddress),
          content: msg.content,
        }),
      ).finish(),
  );
  registered = true;
}

/* -------------------------------------------------------------------------- */
/* Node pool                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The node pool used for every call to the Canopy RPC. With more than one entry it round-robins
 * and fails a call over to the next node when one is unreachable; with a single local node it
 * still gives one place to change the endpoint.
 */
export const pool = new NodePool([
  { name: "local", rpc: config.rpcUrl },
  ...(config.fallbackRpcUrl !== config.rpcUrl
    ? [{ name: "fallback", rpc: config.fallbackRpcUrl }]
    : []),
]);

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface Post {
  id: number;
  authorAddress: string;
  content: string;
  height: number;
}

export interface AccountInfo {
  address: string;
  /** Spendable balance in uCNPY. */
  amount: number;
}

/** Current chain height, through the pool so a dead node fails over rather than throwing. */
export function getHeight(): Promise<number> {
  return pool.withFailover((opts) => fetchHeight(opts));
}

/** Balance and nonce for one address. A never-used address reports a zero balance, not an error. */
export async function getAccount(address: string): Promise<AccountInfo> {
  const data = await pool.withFailover((opts) => account(address, opts));
  return { address, amount: Number(data?.amount ?? 0) };
}

/**
 * The minimum fee the chain will accept for a post_message, in uCNPY.
 *
 * The plugin's CheckTx compares the transaction fee against the governance-controlled `sendFee`,
 * so that is the value to read. If the query fails we fall back to the configured default rather
 * than blocking the compose box on a transient RPC error.
 */
export async function getPostFee(): Promise<number> {
  try {
    const params = await pool.withFailover((opts) => fees(opts));
    const sendFee = Number(params?.sendFee ?? params?.fee?.sendFee);
    return Number.isFinite(sendFee) && sendFee > 0 ? sendFee : config.fallbackFee;
  } catch {
    return config.fallbackFee;
  }
}

/**
 * Fetch the guestbook feed from the plugin's own RPC server.
 *
 * @param limit  maximum number of posts to return
 * @param author optional 20-byte hex address to filter by
 */
export async function getPosts(limit = 50, author?: string): Promise<Post[]> {
  const url = new URL("/v1/query/posts", config.pluginRpcUrl);
  url.searchParams.set("limit", String(limit));
  // newest first — the plugin scans its post prefix in reverse, so this costs nothing
  url.searchParams.set("reverse", "true");
  if (author) url.searchParams.set("author", author);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `guestbook RPC returned ${res.status} — is the go-plugin running on ${config.pluginRpcUrl}?`,
    );
  }
  return (body?.posts ?? []) as Post[];
}

/** How many posts the guestbook holds. */
export async function getPostCount(): Promise<number> {
  const res = await fetch(new URL("/v1/query/post-counter", config.pluginRpcUrl));
  if (!res.ok) throw new Error(`guestbook RPC returned ${res.status}`);
  const body = await res.json();
  return Number(body?.totalPosts ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface Signer {
  address: string;
  publicKeyHex: string;
  privateKeyHex: string;
  curveType: CurveType;
}

/** Count content the way the plugin does: in unicode code points, not UTF-16 units. */
export function countCharacters(content: string): number {
  return [...content].length;
}

/**
 * Validate content against the same rules the plugin's CheckTx enforces, so the UI can refuse a
 * post before spending a fee on a transaction the chain would reject.
 *
 * @returns an error message, or null when the content is acceptable
 */
export function validateContent(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return "Write something first.";
  const length = countCharacters(trimmed);
  if (length > config.maxContentLength) {
    return `Too long by ${length - config.maxContentLength} characters (limit is ${config.maxContentLength}).`;
  }
  return null;
}

/**
 * Build, sign and broadcast a post_message transaction.
 *
 * The content is trimmed before signing, so what gets stored on-chain forever is exactly what the
 * character counter measured.
 *
 * @returns the transaction hash reported by the node
 */
export async function submitPost(signer: Signer, content: string): Promise<string> {
  registerGuestbookMessages();

  const trimmed = content.trim();
  const invalid = validateContent(trimmed);
  if (invalid) throw new Error(invalid);

  // createdHeight is the chain's current height; the node uses it for safe pruning
  const [height, fee] = await Promise.all([getHeight(), getPostFee()]);

  // the author pays the fee, so refuse early with a clear message rather than letting DeliverTx
  // fail after the transaction has already been included in a block
  const { amount } = await getAccount(signer.address);
  if (amount < fee) {
    throw new Error(
      `Not enough balance to pay the ${fee} uCNPY fee (this account holds ${amount} uCNPY). Fund the address first.`,
    );
  }

  const tx = createAndSignTransaction(
    {
      type: POST_MESSAGE_TX_TYPE,
      msg: { authorAddress: signer.address, content: trimmed },
      fee,
      memo: "",
      networkID: config.networkID,
      chainID: config.chainID,
      height,
    },
    signer.privateKeyHex,
    signer.publicKeyHex,
    signer.curveType,
  );

  const result = await pool.withFailover((opts) => submitTx(tx, opts));
  // the node answers a successful submission with the bare transaction hash as a JSON string
  if (typeof result === "string") return result;
  const hash = (result as Record<string, unknown>)?.txHash ?? (result as Record<string, unknown>)?.hash;
  if (typeof hash === "string") return hash;
  throw new Error(`Unexpected response from /v1/tx: ${JSON.stringify(result)}`);
}

/**
 * Turn any thrown value into something worth showing a user. RpcError and TimeoutError carry the
 * detail that actually explains a failure; everything else degrades to its message.
 */
export function describeError(error: unknown): string {
  if (error instanceof TimeoutError) {
    return `The node did not respond in time. Is it running at ${config.rpcUrl}?`;
  }
  if (error instanceof RpcError) {
    const status = error.status !== undefined ? ` (HTTP ${error.status})` : "";
    return `${error.message}${status}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
