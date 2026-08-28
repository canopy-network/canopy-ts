# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `getBalance(address, opts)` in `./rpc` — returns an account's spendable
  balance as a validated `number`, instead of making callers dig the `amount`
  field out of `account()`'s untyped `Record<string, any>`. Accepts the same
  `height` option as `account()` for historical lookups, and reports `0` when
  the account record carries no `amount`.
- `ValidationError` in `./errors` — thrown when an argument is malformed (bad
  address, wrong-length hash, non-positive height, unknown pool type). It
  extends `CanopyError` and carries the offending input on `.value`.
- JSDoc on every public export in `./rpc` — description, `@param`, `@returns`,
  `@throws`, and a runnable `@example` — so editors surface parameter hints,
  return types, and usage inline. Previously these were Python-style
  `Args:`/`Returns:` docstrings, which editors render as one undifferentiated
  block and which referenced Python exceptions (`ValueError`) this SDK never
  throws.

### Changed

- **Argument validation in `./rpc` now throws `ValidationError` instead of a
  plain `Error`.** This makes the documented "every error the SDK throws
  extends `CanopyError`" true for the most common developer mistake — an
  invalid address was previously the one failure that escaped the hierarchy.
  `catch (e)` and `e.message` checks are unaffected; code matching on
  `e.name === "Error"` or `e.constructor === Error` needs updating.
- **Address and hash arguments are now checked for hex content, not just
  length.** A 40-character non-hex string (or a 64-character non-hex hash)
  that previously reached the node and came back as an opaque RPC failure is
  now rejected up front with a `ValidationError`. Hashes are also lowercased
  on the way out, matching how addresses were already normalized.
- `blockByHeight` and the ID-taking queries now reject `NaN`, which previously
  slipped past their `< 0` checks and was forwarded to the node.

### Fixed

- `NodePool.withFailover()` in pinned mode now preserves `RpcError`'s type
  and `status` when the pinned node actually responded (e.g. a 404), instead
  of always discarding it into a generic wrapper `Error` — `instanceof
  RpcError` checks now work the same in pinned mode as they already did in
  automatic mode.
- `NodePool.selectNode(index)` now rejects non-integer input (e.g. `NaN`
  from an unguarded `parseInt`) instead of silently accepting it and
  crashing later on the next lookup.
- Corrected the `withFailover()` doc comment, which claimed pinned mode does
  "single-node retry" — it makes exactly one attempt and does not retry.

## [0.8.0] - 2026-08-11

### Breaking Changes

- **Paginated RPC query functions are now async generators, not
  Promise-returning single-page calls.** `failedTxs`, `txsByHeight`,
  `txsBySender`, `txsByRecipient`, `pending`, `eventsByAddress`,
  `eventsByChain`, `eventsByHeight`, `validators`, `committee`, and `orders`
  each now iterate the *entire* result set across pages automatically —
  `for await (const item of validators())` — instead of returning one page's
  raw `{ results, pageNumber, ... }` dict. This is the idiomatic async-iterable
  pagination pattern (research: `software-engineering/typescript-sdk-design`),
  replacing the previous manual `PageParams`-per-call design outright rather
  than adding it alongside as an opt-in helper.
- `paginate()` (added in 0.7.0 as a wrapper around the old single-page API) is
  removed — each function now does this natively, so the wrapper is no
  longer needed.
- The `pageParams` option on these 11 functions now takes a plain
  `PageParamsOptions` object (`{ page, per_page, order_by, desc }`) instead
  of a `PageParams` class instance — simpler, and matches how every other
  options bag in this SDK works. `PageParams` itself is unchanged and still
  exported for anyone constructing one directly.
- Unaffected: `accountsBatch`, `validator`, `pool`, `nextDexBatch`, and every
  non-paginated query — still return a single `Promise`, as before.

## [0.7.0] - 2026-08-11

### Added

- `./keystore`, `./wallet-manager`, `./node-pool`, and `./transaction` package
  exports — previously only reachable via the root barrel import.
- `CoreTransaction` and `CreateAndSignTransactionOptions` types exported from
  `./crypto` and the root (alongside the existing `createAndSignTransaction`
  and `PluginTransaction`).
- `sideEffects: false` in `package.json`, so bundlers can tree-shake unused
  subpaths (protobufjs, zod, noble-curves, the WS transport) out of a root
  import that only needs one of them.
- `verbatimModuleSyntax` enabled in `tsconfig.json` for more reliable
  tree-shaking through type-only imports.
- README with quick-start examples for keys/wallets, keystore, RPC, WebSocket,
  and multi-node failover.
- `paginate()` — wraps any paginated RPC query function (`validators`,
  `committee`, `txsByHeight`, `eventsByAddress`, ...) into an async iterable,
  so consumers can `for await...of` an entire list instead of manually
  advancing `PageParams` page by page.

### Fixed

- `./proto` package export used the deprecated directory-trailing-slash
  syntax (`"./dist/proto/"`), which current Node.js no longer documents as
  supported. Switched to the wildcard-pattern form (`"./dist/proto/*"`).
- `repository.url` in `package.json` now uses the `git+` prefix form, which
  npm's trusted-publisher matching expects.
- CI publish workflow was only half-migrated to trusted publishing (had
  `id-token: write` but still authenticated with a long-lived `NPM_TOKEN`,
  and pinned Node 20, below trusted publishing's Node 22.14.0 minimum).
  Finished the migration: Node 22, `npm install -g npm@latest` to guarantee
  npm ≥11.5.1, dropped the token-based auth.

## [0.6.0] - 2026-08-11

### Added

- In-browser key generation and Go-keystore-compatible encryption:
  `generateKeyPair`, `encryptPrivateKey`/`encryptPrivateKeyHex`,
  `decryptPrivateKey`/`decryptPrivateKeyHex`.
- `WalletManager` — multi-account wallet with injectable storage:
  `loadAccounts`, `createWallet`, `unlock`, `deleteAccount`,
  `exportEncryptedEntry`, `listAccounts`.
- Full RPC query surface: account, block, transaction (by hash/height/sender/
  recipient), validator, committee, pool, network state, events, and DEX
  batch/orders query methods, plus `PageParams`/`PageSchema` for pagination.
- Core transaction builders (`createAndSignTransaction`, `PluginTransaction`,
  `CoreTransaction`) covering all registered on-chain message types, with
  correct hex wire format and per-type wire-key quirks matched against a live
  devnet.
- `NodePool` — multi-node RPC client with automatic round-robin failover
  (`withFailover`), pinned-node mode, and `healthCheckAll` diagnostics.
- End-to-end test suite (smoke, stake, subsidize, dex-orders, dex-liquidity)
  running against a live single-node devnet in Docker.

### Fixed

- Signature verification failed for any message type with falsy/zero fields
  (e.g. `{delegate: false}`) — protobufjs was writing explicit zero bytes
  where Go's proto3 marshaler omits them. Fixed with a `proto3Fields()`
  helper applied to every encoder.
- Validator lookups now key by the validator's own BLS-operator-derived
  address, not the funder/output address.

## [0.5.0] - 2026-06-07

### Breaking Changes

- **Removed `PortalTransport` and `createTransport`.** The portal-iframe
  embedding protocol (postMessage proxying to a parent frame) and its
  parent-origin policy are deployment concerns of the casino application, not
  the chain SDK — keeping them here was a separation-of-concerns leak and the
  source of a parent-origin bug (the transport defaulted the parent origin to
  the game's own origin, so every game→portal message was dropped). They now
  live in `@canopynetwork/casino-client` as `PortalTransport` /
  `createGameTransport`. Standalone callers should construct `DirectTransport`
  directly; portal-embedded games use `createGameTransport` from casino-client.
- The SDK now exposes only the `GameTransport` port and `DirectTransport`.

### Added

- `./proto` package export and `publishedWsProtos` manifest; a `copy-ws-protos`
  postbuild step ships the WS `.proto` schemas in `dist/proto/` so consumers can
  serve them as static assets.

## [0.4.0] - 2026-06-06

### Breaking Changes

- **WebSocket wire is now pure binary protobuf.** All JSON framing is removed.
  Every message is a `ws.Frame{channel, payload}`; control-plane messages
  (challenge/response auth, subscribe, begin/end block, error) ride channel `""`
  as `ws.System`; each game channel carries its own protobuf `Envelope`.
- `DirectTransportConfig` now **requires** `frameCodec` and `systemCodec`
  (build with `makeFrameCodec(root)` / `makeSystemCodec(root)`). The transport
  performs the binary challenge-response handshake itself before `onOpen` fires.
- `DirectTransport.send(msg: object)` (JSON) now throws — use `ChannelRouter`.

### Added

- `ChannelRouter` — per-channel protobuf routing over a `GameTransport`:
  `registerChannel`, `on`, `onSystem`, `send`, `sendSystem`.
- `makeFrameCodec(root)` / `makeSystemCodec(root)` helpers and the
  `FrameCodec` / `SystemCodec` types, exported from the `/ws` subpath.

## [0.2.0] - 2026-02-27

### Breaking Changes

- Upgraded `@noble/hashes` and `@noble/curves` to v2.0.1. Noble v2 renamed
  several module entry points. If your package imports noble directly alongside
  `canopy-crypto`, update the following paths:
  - `@noble/hashes/sha256.js` → `@noble/hashes/sha2.js`
  - `@noble/hashes/ripemd160.js` → `@noble/hashes/legacy.js`

## [0.1.0] - Initial release
