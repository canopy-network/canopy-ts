# @canopynetwork/canopy-ts

TypeScript SDK for Canopy blockchain plugin frontends — signing, keystore, and RPC.

Scoped for **plugin frontends**: browser/UI code that signs transactions, manages a local keystore, and talks to a Canopy node over RPC, without a backend in between.

## Install

```bash
npm install @canopynetwork/canopy-ts
```

ESM only. Node ≥ 18 or any modern bundler (Vite, webpack, esbuild, Rollup).

## Importing

Prefer subpath imports — they keep your bundle to only what you use:

```ts
import { generateKeyPair } from "@canopynetwork/canopy-ts/crypto";
import { fetchHeight } from "@canopynetwork/canopy-ts/rpc";
```

Importing from the package root works too, but pulls in every subpath's
dependencies (protobufjs, zod, noble-curves) even if you only need one of
them:

```ts
import { generateKeyPair, fetchHeight } from "@canopynetwork/canopy-ts";
```

| Subpath | Covers |
|---|---|
| `./crypto` | Key generation, signing, address derivation, keystore encryption, transaction builders |
| `./rpc` | Node RPC query methods (accounts, blocks, transactions, validators, ...) |
| `./errors` | `CanopyError` hierarchy |
| `./keystore` | Go-keystore-compatible import/export |
| `./wallet-manager` | `WalletManager` — multi-account wallet with injectable storage |
| `./node-pool` | `NodePool` — multi-node RPC client with automatic failover |
| `./transaction` | Transaction builders (`createAndSignTransaction`) |

## Quick start

### Generate a key pair and derive an address

```ts
import { generateKeyPair, deriveAddress, CurveType } from "@canopynetwork/canopy-ts/crypto";

const { privateKey, publicKey } = generateKeyPair();
const address = deriveAddress(publicKey, CurveType.ED25519);
```

### Encrypted keystore (Go-keystore compatible)

```ts
import { encryptPrivateKeyHex, decryptPrivateKeyHex } from "@canopynetwork/canopy-ts/crypto";

const { encrypted, salt } = await encryptPrivateKeyHex(privateKey, "correct horse battery staple");
const recovered = await decryptPrivateKeyHex(encrypted, salt, "correct horse battery staple");
```

### WalletManager — multi-account wallet

```ts
import { WalletManager } from "@canopynetwork/canopy-ts/wallet-manager";

// storage is injectable — implement KeystoreStorage against localStorage,
// IndexedDB, or whatever the host app already uses.
const wallet = new WalletManager({ storage: myStorage });

const accounts = await wallet.loadAccounts({ baseUrl: "https://node.example.com" });
const unlocked = await wallet.unlock(accounts[0].address, "password");
```

### RPC queries

```ts
import { fetchHeight } from "@canopynetwork/canopy-ts/rpc";

const height = await fetchHeight({ baseUrl: "https://node.example.com" });
```

List endpoints (`validators`, `committee`, `orders`, `txsByHeight`,
`eventsByAddress`, ...) are async generators — `for await...of` the whole
list, no manual page-by-page calls:

```ts
import { validators, eventsByAddress } from "@canopynetwork/canopy-ts/rpc";

for await (const v of validators()) {
  console.log(v);
}

// tune page size / sort order with pageParams; still just iterate
for await (const e of eventsByAddress(address, { pageParams: { per_page: 50 } })) {
  console.log(e);
}
```

### Multi-node failover

```ts
import { NodePool } from "@canopynetwork/canopy-ts/node-pool";
import { fetchHeight } from "@canopynetwork/canopy-ts/rpc";

const pool = new NodePool([
  { name: "primary", rpc: "https://node-1.example.com" },
  { name: "backup", rpc: "https://node-2.example.com" },
]);

// Rotates to the next enabled node on connection/timeout/5xx errors;
// propagates 4xx immediately without rotating (it's not a node-health signal).
const height = await pool.withFailover((opts) => fetchHeight(opts));
```

### Building and signing a transaction

```ts
import { createAndSignTransaction } from "@canopynetwork/canopy-ts/transaction";

// Plugin format (default) — msgTypeUrl/msgBytes:
const tx = createAndSignTransaction(
  { type: "send", msg: { /* message fields */ }, fee: 10000, networkID: 1, chainID: 1, height: height },
  privateKey,
  publicKey,
  CurveType.ED25519,
);

// Core format — for registered on-chain types (send, stake, unstake, ...),
// which the node requires as a protojson `msg` field instead:
const coreTx = createAndSignTransaction(
  { type: "send", msg: { /* message fields */ }, fee: 10000, networkID: 1, chainID: 1, height: height },
  privateKey,
  publicKey,
  CurveType.ED25519,
  { format: "core" },
);
```

## Error handling

Every error the SDK throws extends `CanopyError`, so you can catch broadly
or narrow to a specific failure mode:

```ts
import { CanopyError, RpcError, TimeoutError } from "@canopynetwork/canopy-ts/errors";

try {
  await fetchHeight({ baseUrl });
} catch (e) {
  if (e instanceof TimeoutError) {
    // e.timeoutMs
  } else if (e instanceof RpcError) {
    // e.status, e.requestId, e.body
  } else if (e instanceof CanopyError) {
    // any other SDK error
  }
}
```

RPC calls retry transient failures (network errors, 5xx) with exponential
backoff and jitter by default (3 attempts). Disable per-call with
`{ retry: false }`, or tune `{ retry: { maxAttempts, baseDelayMs, maxDelayMs } }`.

## Examples

Runnable, end-to-end example scripts live in [`examples/`](./examples):
sending a transaction (`createAndSignTransaction` + `submitTx`), client-side
keystore generation/Go-keystore import, and multi-node failover with
`NodePool`.

## Versioning

This package follows [Semantic Versioning](https://semver.org/). Type
changes are treated as part of the public API — see
[CHANGELOG.md](./CHANGELOG.md) for a full history, including breaking
changes.

## License

See the repository for license details.
