/**
 * Chain and endpoint configuration.
 *
 * Every value can be overridden at build time with a Vite env var (put them in a `.env.local`
 * file next to package.json, or export them before `npm run dev`). The defaults target the
 * single-node local chain from the repository README.
 */

/** Read a Vite env var in the browser, falling back to process.env so the node scripts work too. */
function env(key: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  return viteEnv?.[key] ?? (globalThis as any).process?.env?.[key];
}

function envNumber(key: string, fallback: number): number {
  const raw = env(key);
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

export const config = {
  /** Canopy public RPC — height, accounts, fee params, and transaction submission. */
  rpcUrl: env("VITE_CANOPY_RPC_URL") ?? "http://localhost:50002",
  /** The go-plugin's own HTTP server — the guestbook feed lives here, not on the node. */
  pluginRpcUrl: env("VITE_GUESTBOOK_RPC_URL") ?? "http://localhost:50010",
  /**
   * A second endpoint for NodePool to fail over to. Left equal to the primary by default because
   * a local dev chain is a single node; point it at another node to see failover do real work.
   */
  fallbackRpcUrl: env("VITE_CANOPY_RPC_URL_FALLBACK") ?? env("VITE_CANOPY_RPC_URL") ?? "http://localhost:50002",

  /**
   * networkID and chainID are signed into every transaction and must match the node exactly, or it
   * rejects the signature. Both are 1 for the default local chain — see `networkID` in
   * ~/.canopy/config.json and `chainId` in plugin/go/chain.json.
   */
  networkID: envNumber("VITE_CANOPY_NETWORK_ID", 1),
  chainID: envNumber("VITE_CANOPY_CHAIN_ID", 1),

  /**
   * Fallback fee in uCNPY, used only if the node's fee-params query fails. The guestbook's CheckTx
   * enforces the chain's `sendFee` as the minimum for a post_message (the plugin's FeeParams
   * declares that one field), which is 10000 uCNPY on a default local chain.
   */
  fallbackFee: envNumber("VITE_CANOPY_FEE", 10000),

  /** Must match MaxPostContentLength in the plugin's contract/guestbook.go. */
  maxContentLength: 280,

  /** How often the UI re-polls chain height and the guestbook feed, in milliseconds. */
  pollIntervalMs: envNumber("VITE_POLL_INTERVAL_MS", 3000),
} as const;

/** uCNPY -> CNPY, for display only. */
export function formatCNPY(micro: number | bigint): string {
  const value = Number(micro) / 1_000_000;
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/** Shorten an address for display: 0a1b2c3d…9e8f7a6b */
export function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}
