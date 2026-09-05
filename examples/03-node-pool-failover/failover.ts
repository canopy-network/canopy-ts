/**
 * Example 3 — Multi-node client with automatic failover via NodePool.
 *
 * NodePool hands out {baseUrl} RequestOptions for any RPC helper, so you get
 * round-robin load-balancing and failover for free across every query in the
 * SDK — the pool itself never needs updating when rpc.ts gains new methods.
 *
 * Retry semantics (mirrors src/node-pool.ts):
 *   - connection errors, timeouts, and 5xx responses → rotate to next node
 *   - 4xx responses → thrown immediately (the node is healthy; rotating
 *     would just mask a bad request)
 *
 * Run: npx tsx failover.ts
 *
 * Endpoints below are Canopy public nodes (mainnet RPC, chainID 1). The
 * intentionally-bogus first entry proves failover works: without it, every
 * call would fail; with it, calls transparently land on the healthy node.
 * Set CANOPY_RPC_URLS to point at your own nodes (comma-separated).
 */

import { NodePool } from "@canopynetwork/canopy-ts/node-pool";
import { account, fetchHeight, validators } from "@canopynetwork/canopy-ts/rpc";
import { RpcError, TimeoutError } from "@canopynetwork/canopy-ts/errors";

const DEFAULT_URLS = [
  "https://unreachable.invalid", // always fails — exercises the rotation path
  "https://node1.canopy.us.nodefleet.net/rpc", // Canopy mainnet public RPC
];

const urls = (process.env.CANOPY_RPC_URLS ?? DEFAULT_URLS.join(","))
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

// A known mainnet address for the balance demo (balance may be anything).
const SAMPLE_ADDRESS = "502c0b3d6ccdc11a5f4a1b0c9a7e3f7c3f4e5d6a";

async function main() {
  const pool = new NodePool(
    urls.map((rpc: string, i: number) => ({
      name: `node-${i}`,
      rpc,
      enabled: true,
    })),
  );

  console.log(`pool: ${pool.listNodes().map((n) => n.name).join(", ")}`);
  console.log(`next up: ${pool.currentNode().name}\n`);

  // --- 1. Any RPC helper through the pool -----------------------------------
  //
  // withFailover passes {baseUrl, retry: false} into the callback — node-level
  // HTTP retry is disabled because rotating across nodes IS the retry.
  const height = await pool.withFailover((opts) => fetchHeight(opts));
  console.log(`height via pool: ${height}`);
  console.log(`next up after rotation: ${pool.currentNode().name}\n`);

  // --- 2. Reuse the same pattern for every query ----------------------------
  const acc = await pool.withFailover((opts) => account(SAMPLE_ADDRESS, opts));
  console.log(`balance of ${SAMPLE_ADDRESS}: ${acc.amount} micro-CNPY`);

  // List endpoints are async generators — iterate, don't page manually.
  // A generator spans many HTTP requests, so route it to one node directly
  // (withFailover covers a single awaited call, not a whole iteration).
  const listOpts = { baseUrl: pool.currentNode().rpc, pageParams: { per_page: 3 } };
  let seen = 0;
  for await (const v of validators(listOpts)) {
    console.log(`  validator ${++seen}: ${v.address} staked=${v.stakedAmount}`);
    if (seen >= 3) break;
  }

  // --- 3. Pinning ------------------------------------------------------------
  //
  // Force all traffic to one node (e.g. your own), then release the pin.
  pool.selectNode("node-1");
  console.log(`\npinned to: ${pool.currentNode().name}`);
  const h2 = await pool.withFailover((opts) => fetchHeight(opts));
  console.log(`height while pinned: ${h2}`);
  pool.resetNodes();
  console.log(`pin released — back to: ${pool.currentNode().name}\n`);

  // --- 4. Diagnostics: sweep every node at once ------------------------------
  //
  // healthCheckAll queries /v1/query/height on each node concurrently,
  // including disabled ones. Note the bogus node failing while the rest serve.
  const health = await pool.healthCheckAll({ timeoutMs: 5_000 });
  for (const [name, status] of Object.entries(health)) {
    console.log(`  ${name}: ${status.ok ? `ok (height ${status.height})` : `down (${status.error})`}`);
  }
}

main().catch((e) => {
  // 4xx errors propagate untouched — failover deliberately does not retry them.
  if (e instanceof RpcError) {
    console.error(`rpc error (status ${e.status}):`, e.message);
  } else if (e instanceof TimeoutError) {
    console.error(`timed out after ${e.timeoutMs}ms:`, e.message);
  } else {
    console.error("failed:", e instanceof Error ? e.message : e);
  }
  process.exit(1);
});
