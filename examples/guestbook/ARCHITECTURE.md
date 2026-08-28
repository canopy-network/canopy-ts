# Architecture

Three processes, each with one job. The interesting property of the design is what is *not* there:
no application server, no database, and no indexer.

```
┌──────────────────────────────┐
│  Browser (localhost:5173)    │   the whole client
│                              │
│  React UI                    │
│  @canopynetwork/canopy-ts    │   key generation, keystore encryption,
│    ├── keystore  → localStorage   protobuf encoding, signing
│    ├── signing   (ed25519)   │
│    └── NodePool  → failover  │
└──────┬───────────────┬───────┘
       │               │
  sign + broadcast    read the feed
       │               │
       ▼               ▼
┌──────────────┐  ┌──────────────────┐
│ Canopy node  │  │  go-plugin       │
│  :50002 RPC  │◄─┤  :50010 HTTP     │   the plugin serves its own RPC
│  :50003 admin│  │                  │
│              │  │  CheckTx         │   stateless validation
│  consensus   │──►  DeliverTx       │   state transition
│  networking  │  │  BeginBlock      │
│  storage     │◄─┤  StateRead/Write │
│  mempool     │  │  QueryState      │
└──────────────┘  └──────────────────┘
        unix socket /tmp/plugin/plugin.sock
```

## Canopy node — consensus, networking, storage, RPC

The node owns everything that is not application logic: BFT consensus, the P2P layer, the state
database, the mempool, the transaction index, and the public RPC on `:50002`. It knows nothing about
guestbook posts. It knows there is a transaction type called `post_message` only because the plugin
told it so during the handshake, and it knows how to decode it only because the plugin shipped the
protobuf file descriptors along with that handshake.

When a `post_message` transaction arrives the node handles signature verification, replay
protection, block inclusion and commitment — then asks the plugin what the transaction *means*.

## The Go plugin — application logic

A separate OS process, launched by the node via `plugin/go/pluginctl.sh` and connected over a unix
socket. It implements the application:

- **`CheckTx`** — stateless validation, run at mempool admission. Is the author address 20 bytes? Is
  the content valid UTF-8, non-empty, and at most 280 code points? It also returns the
  `AuthorizedSigners`, which is how the plugin tells the node *whose* signature makes this
  transaction valid. No state may be read here, because the mempool has no block to read against.
- **`DeliverTx`** — the state transition, run while a block is being applied. It batches one
  `StateRead` for the post counter, the author's account and the fee pool; charges the fee; writes
  the `Post` under the next id; and advances the counter — all in one `StateWrite`.
- **`BeginBlock`/`EndBlock`** — block lifecycle hooks.

The plugin shares the node's FSM keyspace. That is why it can move real balances with the same
`send` handler the base template ships, and why its own records must live outside the core-reserved
single-byte prefixes 1–15. The guestbook declares prefixes `100` and `101` in
`ContractConfig.CustomStatePrefixes`; Canopy validates that at handshake and panics before
processing a block if a prefix would collide.

### Determinism

Every validator must compute the same state from the same block, so `DeliverTx` may only depend on
its inputs and on state:

- The block height stamped onto a post comes from `PluginDeliverRequest.Height`, supplied by the FSM
  with the request. It is deliberately *not* cached from `BeginBlock`: the plugin builds a fresh
  `Contract` per inbound message and dispatches each on its own goroutine, so a value stashed in
  `BeginBlock` is not the value a later `DeliverTx` would read.
- The 280-character bound is measured with `utf8.RuneCountInString`, and validity with
  `utf8.ValidString`. Both are pure functions of the UTF-8 encoding and consult no Unicode tables,
  so the bound cannot drift between validators built with different Go versions. For the same
  reason emptiness is a byte-length check rather than a whitespace-trimming one — the UI trims
  before submitting, which is where locale-ish judgement belongs.
- Post ids come from a counter in state, not from a timestamp or a hash.

### The plugin's own RPC

Canopy exposes exactly one generic read path to plugins over the socket: `QueryState(height, read)`,
which returns raw key/value state at a historical height. Everything else about the HTTP server on
`:50010` belongs to the plugin — it decodes its own keys, unmarshals its own protobufs, and shapes
its own JSON. The node never needs to learn what a `Post` is.

This is why the feed comes from `:50010` while balances and heights come from `:50002`. It is the
single most common source of confusion in this stack, and the split is deliberate: chain-generic
data from the chain, chain-specific data from the code that defines it.

## The frontend — a client, and nothing else

The browser holds the only copy of the private key. `@canopynetwork/canopy-ts` provides key
generation, the argon2i + AES-GCM keystore encryption, the protobuf encoding of the custom message,
the canonical sign bytes, and the signature. The signed transaction goes straight to the node's
public RPC.

Chain-specific client code is one file, `src/lib/guestbook.ts`, and within it one registration:

```ts
const MessagePost = createProtobufEncoder(
  { author_address: { type: "bytes", id: 1 }, content: { type: "string", id: 2 } },
  "types.MessagePost",
);
registerMessageType("post_message", "types.MessagePost", (msg) => /* encode */);
```

That teaches the SDK how to turn `{ authorAddress, content }` into the exact bytes the node will
re-marshal when it recomputes the sign bytes. Everything downstream — `createAndSignTransaction`,
`submitTx` — is generic.

Because there is no backend, there is also nothing to trust between the user and the chain: no
server sees the key, no server can alter a post, and the feed can be verified against the chain by
anyone with `curl`.

## Request flow for one post

1. UI validates the content locally against the same rules `CheckTx` enforces.
2. `fetchHeight` and `fees` are read through `NodePool` (`createdHeight` and the minimum fee).
3. The author's balance is checked, so an unfunded account fails with a clear message instead of a
   transaction that gets included and then fails.
4. `createAndSignTransaction` builds the protobuf sign bytes and signs them with ed25519.
5. `submitTx` POSTs to `/v1/tx`. The node answers with a hash — this means *queued*, not *committed*.
6. The node runs `CheckTx` (→ plugin) at mempool validation, then includes the transaction in a
   proposal, reaches consensus, and applies the block, calling `DeliverTx` (→ plugin).
7. The plugin writes the `Post` and the advanced counter.
8. The UI's feed poll picks it up from `:50010` on the next 3-second tick.
