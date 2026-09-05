# canopy-ts Examples

Runnable scripts for [`@canopynetwork/canopy-ts`](../README.md) — the three
things most plugin-frontends need first: **sending a transaction**, **managing
keys locally**, and **talking to more than one node**.

All examples are plain TypeScript run with [`tsx`](https://github.com/privatenumber/tsx)
(no build step) and use only the SDK's public subpath exports.

## Setup

```bash
cd examples
npm install
```

## Examples

### [01 — Send a transaction](./01-send-transaction/send-tx.ts)

End-to-end `send`: fetch height + fee params → build and sign with
`createAndSignTransaction({ format: "core" })` → `submitTx()` → poll
`txByHash()` until included. Falls back to a keyless read-only preview when
`CANOPY_PRIVATE_KEY` is unset, so it doubles as a connectivity smoke test.

```bash
# read-only preview (no key needed)
npx tsx 01-send-transaction/send-tx.ts

# actually send 0.001 CNPY on mainnet
CANOPY_PRIVATE_KEY=<64-hex-no-0x> CANOPY_AMOUNT=1000 npx tsx 01-send-transaction/send-tx.ts

# or against your own node
CANOPY_RPC_URL=http://localhost:50002 CANOPY_PRIVATE_KEY=... npx tsx 01-send-transaction/send-tx.ts
```

Notes:
- Addresses are bare 40-hex (no `0x` prefix).
- Registered core message types (`send`, `stake`, ...) require the **core**
  format — a protojson `msg` field — not the default plugin
  `msgTypeUrl`/`msgBytes` form. This trips up almost everyone; the example
  shows the working incantation.
- Signing sends real tokens. Default amount is 1000 micro-CNPY (0.001 CNPY).

### [02 — Keystore: generate, encrypt, import](./02-keystore-import/keystore.ts)

Offline (no node) tour of the client-side keystore:
`generateKeyPair()` → `encryptKeyEntry()` → `decryptEntry()` → export a
**Go-keystore-compatible** file → `importFromGoKeystore()` back in, including
the tamper-detection failure path and the "import an existing private key"
flow. Encrypted entries are argon2i + AES-GCM, byte-compatible with the Go
node's keystore.

```bash
npx tsx 02-keystore-import/keystore.ts
```

Writes `02-keystore-import/keystore/<address>.json` (git-ignored). The demo
password is `correct horse battery staple` — never reuse it.

### [03 — Multi-node failover client](./03-node-pool-failover/failover.ts)

The `NodePool` pattern for production clients: round-robin across RPC
endpoints, automatic rotation on connection errors / timeouts / 5xx,
immediate propagation of 4xx, pin-to-node (`selectNode` / `resetNodes`), and
a concurrent `healthCheckAll()` diagnostic sweep. The default node list
includes a deliberately bogus endpoint so you can watch failover happen.

```bash
npx tsx 03-node-pool-failover/failover.ts

# your own node set
CANOPY_RPC_URLS="http://localhost:50002,https://node1.canopy.us.nodefleet.net/rpc" \
  npx tsx 03-node-pool-failover/failover.ts
```

## Type-checking

From `examples/`:

```bash
npx tsc -p tsconfig.json --noEmit
```

## Environment reference

| Variable | Used by | Default |
|---|---|---|
| `CANOPY_RPC_URL` | 01 | `https://node1.canopy.us.nodefleet.net/rpc` (Canopy mainnet public RPC) |
| `CANOPY_PRIVATE_KEY` | 01 | unset → read-only preview |
| `CANOPY_TO_ADDRESS` | 01 | random fresh address |
| `CANOPY_AMOUNT` | 01 | `1000` (micro-CNPY) |
| `CANOPY_CURVE` | 01 | `bls12381` (`ed25519` also supported) |
| `CANOPY_MEMO` | 01 | `sent from canopy-ts examples` |
| `CANOPY_RPC_URLS` | 03 | bogus node + mainnet public RPC |

## Common pitfalls (all handled in these examples)

1. **`send` needs `{ format: "core" }`** — without it you submit the plugin
   format (`msgTypeUrl`/`msgBytes`), which the node's registered-core-type
   path ignores/rejects.
2. **`height` on the tx matters** — the node accepts `createdHeight` within
   ±4320 of current height (replay protection). Always pass a fresh
   `fetchHeight()`.
3. **Fees are parameterized** — read `fees()` (`/v1/query/fee-params`) rather
   than hard-coding; `sendFee` is the minimum for a `send`.
4. **Addresses are 20 bytes, no checksum, no `0x`.**
