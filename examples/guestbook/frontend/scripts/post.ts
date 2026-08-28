/**
 * Post to the guestbook from the command line.
 *
 *   npm run post -- --key <hex-private-key> "your message"
 *   npm run post -- --new "your message"          # generate a throwaway key and print it
 *
 * Uses exactly the same lib/guestbook.ts code path the browser UI does — same encoder, same sign
 * bytes, same /v1/tx submission — so it is a faithful check that the plugin and the SDK agree.
 */
import { generateKeyPair } from "@canopynetwork/canopy-ts";
import { CurveType } from "@canopynetwork/canopy-ts/crypto";
import { derivePublicKey, deriveAddress } from "@canopynetwork/canopy-ts/crypto";
import { config } from "../src/lib/config.js";
import {
  describeError,
  getAccount,
  getHeight,
  getPosts,
  submitPost,
  type Signer,
} from "../src/lib/guestbook.js";

function parseArgs(argv: string[]) {
  let key: string | undefined;
  let makeNew = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key") key = argv[++i];
    else if (argv[i] === "--new") makeNew = true;
    else rest.push(argv[i]);
  }
  return { key, makeNew, content: rest.join(" ") };
}

async function main() {
  const { key, makeNew, content } = parseArgs(process.argv.slice(2));

  if (!content) {
    console.error('usage: npm run post -- [--key <hex>|--new] "your message"');
    process.exit(2);
  }

  let signer: Signer;
  if (makeNew || !key) {
    const kp = generateKeyPair();
    signer = {
      address: kp.address,
      publicKeyHex: kp.publicKeyHex,
      privateKeyHex: kp.privateKeyHex,
      curveType: kp.curveType,
    };
    console.log("Generated a new ed25519 key:");
    console.log(`  address:     ${signer.address}`);
    console.log(`  private key: ${signer.privateKeyHex}`);
    console.log("  (save it — this script does not)\n");
  } else {
    const privateKeyHex = key.trim().replace(/^0x/i, "").toLowerCase();
    const publicKeyHex = derivePublicKey(privateKeyHex, CurveType.ED25519);
    signer = {
      address: deriveAddress(publicKeyHex, CurveType.ED25519),
      publicKeyHex,
      privateKeyHex,
      curveType: CurveType.ED25519,
    };
  }

  const height = await getHeight();
  const { amount } = await getAccount(signer.address);
  console.log(`chain height ${height} · ${signer.address} holds ${amount} uCNPY`);

  if (amount === 0) {
    console.log("\nThis address has no funds and cannot pay the fee. Fund it first, e.g.:");
    console.log(`  canopy admin tx-send <funded-address> ${signer.address} 1000000 --password <pw>\n`);
  }

  const hash = await submitPost(signer, content);
  console.log(`submitted: ${hash}`);
  console.log("waiting for inclusion…");

  const before = await getPosts(1).then((p) => p[0]?.id ?? 0);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const [latest] = await getPosts(1);
    if (latest && latest.id > before) {
      console.log(`\nconfirmed as post #${latest.id} at block ${latest.height}`);
      console.log(`  ${latest.authorAddress}: ${latest.content}`);
      return;
    }
  }
  console.error("timed out waiting for the post to appear in the feed");
  process.exit(1);
}

main().catch((error) => {
  console.error(describeError(error));
  console.error(`\n(node RPC ${config.rpcUrl}, guestbook RPC ${config.pluginRpcUrl})`);
  process.exit(1);
});
