# Canopy Guestbook — a complete local appchain dApp

A permanent, append-only guestbook that lives in a Canopy appchain's own state.

- A **Go plugin** adds one custom transaction, `post_message`, and stores every entry as a `Post`
  record with a chain-assigned auto-incrementing id, the author's address, the content, and the
  block height it landed in.
- A **React + TypeScript frontend** generates and encrypts a key in the browser, signs the
  transaction with [`@canopynetwork/canopy-ts`](https://github.com/canopy-network/canopy-ts), and
  broadcasts it straight to the node. There is no backend.

Everything below was run end to end against canopy `v0.1.22+beta` on a single machine.

---

## How to run everything

Four terminals-worth of commands, in order. Detailed explanations follow.

```bash
# ── 0. prerequisites ────────────────────────────────────────────────────────────
#    Go >= 1.21 (with GOTOOLCHAIN=auto, the default — canopy needs 1.26 and Go
#    fetches that toolchain itself), Node >= 18, git, npm.

# ── 1. build canopy ─────────────────────────────────────────────────────────────
git clone https://github.com/canopy-network/canopy.git ~/canopy
cd ~/canopy
git checkout "$(git describe --tags --abbrev=0)"      # v0.1.22+beta
make build/canopy                                      # installs ~/go/bin/canopy
export PATH="$PATH:$HOME/go/bin"
canopy version                                         # -> v0.1.22+beta

# ── 2. install the guestbook plugin and build it ────────────────────────────────
cd /path/to/canopy-ts/examples/guestbook/plugin
./install.sh ~/canopy                                  # copies files + builds go-plugin

# ── 3. create the node config, then enable the plugin ───────────────────────────
cd ~/canopy
canopy start --password test --nickname validator      # Ctrl+C once it starts producing blocks
#   set "plugin": "go" in ~/.canopy/config.json, then start it for real and LEAVE IT RUNNING:
canopy start --password test --nickname validator

# ── 4. (new terminal) run the frontend ──────────────────────────────────────────
cd /path/to/canopy-ts/examples/guestbook/frontend
npm install
npm run dev                                            # http://localhost:5173
```

Then, in the browser: **Create** a key → give it a password → copy the address → fund it from the
genesis validator (below) → write something → **Post**.

```bash
# fund the browser wallet (the genesis account holds 1,000,000 uCNPY)
canopy admin tx-send 5a98e04cb3fc2847faa143c2c1faeb2881ff6c2f <your-address> 400000 \
  --password test --simulate=false --fee=10000
```

> Your genesis validator address is not the one above — read it from
> `~/.canopy/genesis.json` (`.accounts[0].address`).

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Go | ≥ 1.21 | canopy's `go.mod` requires 1.26; with the default `GOTOOLCHAIN=auto`, Go downloads it on first build |
| Node.js | ≥ 18 | the frontend is ESM-only |
| git, make, npm | any recent | |
| `protoc` | **not required** | the generated `contract/tx.pb.go` ships with this example; only needed if you change the `.proto` |

---

## Step 1 — Build canopy

```bash
git clone https://github.com/canopy-network/canopy.git ~/canopy
cd ~/canopy
git checkout "$(git describe --tags --abbrev=0)"
make build/canopy
```

`make build/canopy` also builds the bundled wallet and explorer web assets, so the first run takes
a few minutes. It installs the binary to your Go bin directory:

```bash
export PATH="$PATH:$HOME/go/bin"        # add to your shell profile to make it stick
canopy version                          # v0.1.22+beta
```

## Step 2 — Install the guestbook plugin

```bash
cd /path/to/canopy-ts/examples/guestbook/plugin
./install.sh ~/canopy
```

The script copies six files over `~/canopy/plugin/go/`, keeps a timestamped backup of everything it
replaces, and runs `go build -o go-plugin .`:

| File | What it is |
|---|---|
| `proto/tx.proto` | upstream file plus `MessagePost`, `Post`, `PostCounter` |
| `contract/tx.pb.go` | the generated Go code for those messages (so you don't need `protoc`) |
| `contract/contract.go` | upstream file plus registration and the `CheckTx`/`DeliverTx` cases |
| `contract/guestbook.go` | **new** — all the guestbook logic and state keys |
| `contract/rpc.go` | the plugin's HTTP server, with the guestbook read endpoints |
| `contract/error.go` | upstream file plus four guestbook errors |

To rebuild after changing plugin code:

```bash
cd ~/canopy/plugin/go && make build      # then restart the node
```

If you edit `proto/tx.proto` you must regenerate the Go code, which does need `protoc` plus
`protoc-gen-go` and `protoc-go-inject-tag` on your `PATH`:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.6
go install github.com/favadi/protoc-go-inject-tag@latest
cd ~/canopy/plugin/go/proto && ./_generate.sh
```

## Step 3 — Configure and start the node

The config file is written on first run, so start the node once and stop it:

```bash
cd ~/canopy
canopy start --password test --nickname validator     # Ctrl+C after it commits a block
```

`--password` and `--nickname` skip the interactive prompts for the new validator key. Then set the
plugin in `~/.canopy/config.json`:

```json
{
  "plugin": "go",
  ...
}
```

and start it again, **from the canopy checkout** (the node resolves `plugin/go/pluginctl.sh`
relative to the working directory):

```bash
cd ~/canopy
canopy start --password test --nickname validator
```

Leave this running. Confirm the plugin came up:

```bash
curl http://localhost:50010/v1/health
# {"build":"canopy-guestbook v1 (post_message + /v1/query/posts)","chainId":1,
#  "maxContentLength":280,"postMessageTxType":"post_message","status":"ok"}
```

> A `Failed to connect to plugin socket` line in `/tmp/plugin/go-plugin.log` on the first attempt is
> normal — the plugin starts before the node's socket exists and retries a second later.

### Ports

| Port | Service |
|---|---|
| 50000 | bundled wallet UI |
| 50001 | bundled block explorer |
| **50002** | **public RPC** — height, accounts, fee params, `POST /v1/tx` |
| 50003 | admin RPC — node keystore (the dApp deliberately does not use this) |
| **50010** | **the plugin's own RPC** — the guestbook feed |
| 9001 | P2P |

## Step 4 — Run the frontend

```bash
cd /path/to/canopy-ts/examples/guestbook/frontend
npm install
npm run dev            # http://localhost:5173
```

Endpoints and chain identity are configurable; copy `.env.example` to `.env.local` to override.
The defaults match the local chain above:

| Setting | Default | Where it comes from |
|---|---|---|
| `VITE_CANOPY_RPC_URL` | `http://localhost:50002` | `rpcPort` in `~/.canopy/config.json` |
| `VITE_GUESTBOOK_RPC_URL` | `http://localhost:50010` | `rpcAddress` in the plugin config |
| `VITE_CANOPY_NETWORK_ID` | `1` | `networkID` in `~/.canopy/config.json` |
| `VITE_CANOPY_CHAIN_ID` | `1` | `chainId` in `~/.canopy/config.json` and `plugin/go/chain.json` |
| `VITE_CANOPY_FEE` | `10000` | fallback only; the app reads `sendFee` from the chain at runtime |

`networkID` and `chainID` are signed into every transaction. If either disagrees with the node, the
node rejects the signature — that is the first thing to check on an `invalid signature` error.

### Posting from the command line

The same code path the UI uses is also exposed as two scripts, which is the quickest way to check
the whole stack without a browser:

```bash
npm run feed                                        # print the guestbook
npm run post -- --new "hello"                       # generate a throwaway key and post
npm run post -- --key <hex-private-key> "hello"     # post from an existing key
```

`--new` prints the generated private key so you can fund it and reuse it.

---

## Using it

1. **Create a key.** The *Create* tab generates an ed25519 key in the browser, encrypts it with your
   password (argon2i + AES-GCM), and stores the ciphertext in `localStorage`. The plaintext key
   exists only in memory, only while unlocked. *Import* accepts an existing 64-character hex
   ed25519 key; *Unlock* reopens a key you already stored.
2. **Fund it.** A post costs the chain's `sendFee` (10,000 uCNPY = 0.01 CNPY by default) and the
   author pays it, so a fresh address cannot post until it holds some CNPY:
   ```bash
   canopy admin tx-send <genesis-address> <your-address> 400000 --password test --simulate=false --fee=10000
   ```
   The wallet panel tells you when the balance cannot cover the fee, and shows the command.
3. **Post.** Type up to 280 characters and hit *Post*. The app signs locally, broadcasts to
   `/v1/tx`, and shows *Waiting for a block…* until the chain advances, then *Confirmed on-chain*.
   At a ~20 second block time, expect to wait 20–40 seconds.
4. **Watch the feed.** It polls `http://localhost:50010/v1/query/posts` every 3 seconds. Your own
   entries are outlined and tagged *you*.

---

## The `post_message` transaction

**Wire format.** `post_message` is a plugin-defined type, so it is submitted in the
`msgTypeUrl`/`msgBytes` form rather than the protojson `msg` form the registered core types use:

```json
{
  "type": "post_message",
  "msgTypeUrl": "type.googleapis.com/types.MessagePost",
  "msgBytes": "<hex protobuf of MessagePost>",
  "signature": { "publicKey": "<hex>", "signature": "<hex>" },
  "time": 1756400000000000,
  "createdHeight": 58,
  "fee": 10000,
  "memo": "",
  "networkID": 1,
  "chainID": 1
}
```

`createAndSignTransaction` from `@canopynetwork/canopy-ts` produces exactly this shape by default —
see `frontend/src/lib/guestbook.ts` for the encoder registration, which is the only chain-specific
code the client needs.

**Validation.** `CheckTx` is stateless and enforces: a 20-byte author address, valid UTF-8, non-empty
content, and at most 280 unicode code points. `DeliverTx` is stateful and additionally requires the
author to hold the fee.

> `POST /v1/tx` returning a transaction hash means *accepted into the mempool*, not *included in a
> block*. A transaction that fails `CheckTx` — an over-long post, say — still gets a hash back and
> then silently never appears. Watch the feed (or the tx index), not the submission response.

**State.** Two plugin-owned key prefixes, both outside the core-reserved range 1–15 and declared in
`ContractConfig.CustomStatePrefixes` so Canopy validates them at handshake:

| Prefix | Key | Value |
|---|---|---|
| `100` | `JoinLenPrefix([100], bigEndian(id))` | `Post{id, authorAddress, content, height}` |
| `101` | `JoinLenPrefix([101], "/c/")` | `PostCounter{nextId}` |

Ids are big-endian in the key, so the store's lexicographic order *is* numeric id order: the feed
reads newest-first with a reverse range scan and no sorting.

## Guestbook RPC (port 50010)

Served by the plugin process itself, not by the node. All read-only, all CORS-enabled.

```bash
curl 'http://localhost:50010/v1/query/posts'                       # newest 100
curl 'http://localhost:50010/v1/query/posts?limit=10&reverse=false' # oldest first
curl 'http://localhost:50010/v1/query/posts?id=2'                   # one post
curl 'http://localhost:50010/v1/query/posts?author=<20-byte-hex>'   # by author
curl 'http://localhost:50010/v1/query/posts?height=64'              # at a historical height
curl 'http://localhost:50010/v1/query/post-counter'                 # {"nextId":4,"totalPosts":3}
curl 'http://localhost:50010/v1/health'
```

---

## Known limitations

- **Alpha software.** Canopy is pre-1.0 and betanet-stage; this pins `v0.1.22+beta`, and the plugin
  overlay replaces whole files, so a later release may need it rebased.
- **~20 second blocks.** Posting is not interactive. The UI waits and tells you it is waiting.
- **The genesis account holds 1,000,000 uCNPY**, i.e. about 100 posts' worth of fees, and block
  rewards do not accrue to it. For heavy use, add a faucet transaction type (the upstream
  `plugin/go/TUTORIAL.md` walks through exactly that) or edit `~/.canopy/genesis.json` before the
  first run.
- **No pagination.** `/v1/query/posts` caps at a `limit` you pass and has no cursor; the feed is
  meant to be small. An author filter scans all posts and filters in the plugin.
- **Polling, not push.** The UI polls height and feed every 3 seconds; there is no subscription.
- **Single node.** `NodePool` is wired up and will fail over, but with one local node there is
  nothing to fail over to — set `VITE_CANOPY_RPC_URL_FALLBACK` to see it work.
- **Local-chain security posture.** The plugin RPC allows any origin, and the demo tells you not to
  reuse a real key. Both are appropriate for a local dev chain and neither is appropriate as-is for
  a public deployment.

---

## Troubleshooting

**`message name post_message is unknown`**
The plugin's `ContractConfig` does not list the transaction. Confirm `SupportedTransactions` and
`TransactionTypeUrls` both contain it *at the same index*, rebuild (`cd ~/canopy/plugin/go && make
build`) and restart the node.

**`invalid signature`**
Sign bytes disagree with what the node recomputes. In order of likelihood: `networkID`/`chainID` do
not match the node; the field numbers or types in the TypeScript encoder do not match `tx.proto`;
you sent a core type in the plugin `msgTypeUrl` form or vice versa.

**The transaction got a hash but nothing appears in the feed**
It was accepted into the mempool and then rejected by `CheckTx`. Check content length (>280 code
points), empty content, and that the author holds enough for the fee. `tail -f
/tmp/plugin/go-plugin.log` shows what the plugin decided.

**`plugin RPC ... 503 state query failed`**
The node has not committed a block yet, so there is no state snapshot to read. It clears within a
block or two of startup.

**The feed is empty but posting works / CORS errors in the browser console**
The frontend is talking to the wrong port. The feed comes from the *plugin* (50010), not the node
(50002). Check `VITE_GUESTBOOK_RPC_URL` and that `curl http://localhost:50010/v1/health` answers.

**`plugin launcher not found for "go"`**
`canopy start` resolves `plugin/go/pluginctl.sh` relative to the working directory. Run it from the
canopy checkout.

**Balance not updating / post not landing**
Wait a full block (~20s, sometimes two). Then check `~/.canopy/logs/log` and
`/tmp/plugin/go-plugin.log`.

**Node panics at startup complaining about a state prefix**
A `CustomStatePrefixes` entry collides with the core-reserved range 1–15. The guestbook uses 100 and
101; if you added your own record type, move it outside that range.

---

## Layout

```
examples/guestbook/
├── README.md              this file
├── ARCHITECTURE.md        how the three pieces fit together
├── plugin/                the overlay for canopy's plugin/go
│   ├── install.sh
│   ├── proto/tx.proto
│   └── contract/{contract,guestbook,rpc,error,tx.pb}.go
└── frontend/
    ├── src/lib/           config, the chain client, localStorage keystore
    ├── src/hooks/         wallet, chain liveness, feed polling
    ├── src/components/    wallet panel, compose box, feed, status bar
    └── scripts/           post.ts and feed.ts (same client, no browser)
```
