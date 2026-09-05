/**
 * Example 1 — Build, sign, and send a `send` transaction.
 *
 * Flow (mirrors src/__tests__/e2e/smoke.test.ts, the SDK's own
 * against-a-real-node test):
 *
 *   1. Read the current height and fee parameters from the node.
 *   2. Load the funded account from CANOPY_PRIVATE_KEY and check its balance.
 *   3. createAndSignTransaction(..., { format: "core" }) — registered core
 *      message types (`send`, `stake`, ...) must be submitted in protojson
 *      `msg` form, NOT the plugin msgTypeUrl/msgBytes form.
 *   4. submitTx() → POST /v1/tx → returns the tx hash.
 *   5. Poll txByHash() until the transaction is included in a block.
 *
 * Running this spends real (testnet/mainnet) tokens — start tiny.
 *
 * Environment:
 *   CANOPY_PRIVATE_KEY  hex private key WITHOUT 0x prefix (required to send)
 *   CANOPY_RPC_URL      node RPC base (default: Canopy mainnet public RPC)
 *   CANOPY_TO_ADDRESS   40-hex recipient (default: a freshly generated address)
 *   CANOPY_AMOUNT       amount in micro-CNPY (default: 1000 = 0.001 CNPY)
 *   CANOPY_CURVE        "bls12381" (default, matches the Go keystore) or "ed25519"
 *   CANOPY_MEMO         optional memo string
 *
 * Keyless preview: without CANOPY_PRIVATE_KEY the script only performs the
 * read-only steps (height, fees, balances) and exits — useful as a smoke test.
 */

import { generateKeyPair } from "@canopynetwork/canopy-ts";
import {
  CurveType,
  createAndSignTransaction,
  deriveAddress,
  derivePublicKey,
} from "@canopynetwork/canopy-ts/crypto";
import { account, fetchHeight, fees, submitTx, txByHash } from "@canopynetwork/canopy-ts/rpc";
import { RpcError } from "@canopynetwork/canopy-ts/errors";

const RPC_URL = process.env.CANOPY_RPC_URL ?? "https://node1.canopy.us.nodefleet.net/rpc";
const PRIVATE_KEY = process.env.CANOPY_PRIVATE_KEY?.replace(/^0x/, "") ?? "";
const AMOUNT = Number(process.env.CANOPY_AMOUNT ?? 1_000);
const MEMO = process.env.CANOPY_MEMO ?? "sent from canopy-ts examples";

const CURVE = (process.env.CANOPY_CURVE ?? "bls12381").toLowerCase() === "ed25519"
  ? CurveType.ED25519
  : CurveType.BLS12381;

// Canopy mainnet: networkID 1, chainID 1 (see cmd/rpc/README.md in the canopy repo).
const NETWORK_ID = 1;
const CHAIN_ID = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = { baseUrl: RPC_URL };

  // 1. Chain state needed to build the transaction.
  const height = await fetchHeight(opts);
  const feeParams = await fees(opts);
  const sendFee = Number(feeParams.sendFee ?? 0);
  console.log(`node:      ${RPC_URL}`);
  console.log(`height:    ${height}`);
  console.log(`sendFee:   ${sendFee} micro-CNPY`);

  // 2. Sender + recipient. Recipient defaults to a throwaway address so the
  //    example is safe to run without editing anything.
  let fromAddress = "";
  let publicKeyHex = "";
  if (PRIVATE_KEY) {
    publicKeyHex = derivePublicKey(PRIVATE_KEY, CURVE);
    fromAddress = deriveAddress(publicKeyHex, CURVE);
  } else {
    console.log("\nCANOPY_PRIVATE_KEY not set — read-only preview only.\n");
  }
  const toAddress = (process.env.CANOPY_TO_ADDRESS?.replace(/^0x/, "") ?? generateKeyPair().address).toLowerCase();

  console.log(`from:      ${fromAddress || "(unset)"}`);
  console.log(`to:        ${toAddress}`);
  console.log(`amount:    ${AMOUNT} micro-CNPY\n`);

  if (fromAddress) {
    const from = await account(fromAddress, opts);
    console.log(`sender balance: ${from.amount} micro-CNPY`);
    // Pre-flight: the node happily accepts an unfundable tx into its mempool,
    // then fails it at execution ("insufficient funds") — check before signing.
    if (PRIVATE_KEY && BigInt(from.amount ?? 0) < BigInt(AMOUNT) + BigInt(sendFee)) {
      throw new Error(
        `insufficient funds: balance ${from.amount} < amount ${AMOUNT} + fee ${sendFee} (micro-CNPY)`,
      );
    }
  }
  let toBalance = 0n;
  try {
    const to = await account(toAddress, opts);
    toBalance = BigInt(to.amount ?? 0);
  } catch {
    // Recipient may not exist on-chain yet — keep going.
  }

  if (!PRIVATE_KEY) return;

  // 3. Sign. `height` anchors the tx for replay protection (node accepts
  //    createdHeight within +/- 4320 of the current height).
  const tx = createAndSignTransaction(
    {
      type: "send",
      msg: {
        fromAddress,
        toAddress,
        amount: AMOUNT,
      },
      fee: sendFee,
      memo: MEMO,
      networkID: NETWORK_ID,
      chainID: CHAIN_ID,
      height,
    },
    PRIVATE_KEY,
    publicKeyHex,
    CURVE,
    // Core format: required for registered on-chain types like `send`.
    { format: "core" },
  );

  // 4. Submit. POST /v1/tx responds with a bare JSON string containing the tx hash.
  const response = await submitTx(tx, opts);
  const txHash = typeof response === "string" ? response : String(Object.values(response)[0] ?? response);
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    throw new Error(`unexpected submitTx response: ${JSON.stringify(response)}`);
  }
  console.log(`\ntx submitted: ${txHash}`);

  // 5. Wait for inclusion. Canopy blocktimes are ~20s on mainnet.
  for (let i = 0; i < 12; i++) {
    await sleep(10_000);
    try {
      const found = await txByHash(txHash, opts);
      console.log(`\nincluded at height ${found.height}`);
      const after = await account(toAddress, opts);
      console.log(`recipient balance: ${after.amount} (was ${toBalance})`);
      return;
    } catch (e) {
      if (e instanceof RpcError && e.status === 404) continue; // not included yet
      throw e;
    }
  }
  console.log("\nnot included after 2 minutes — the tx may have failed at execution;");
  console.log("check failedTxs(address) or the explorer");
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
