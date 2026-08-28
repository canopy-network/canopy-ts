#!/usr/bin/env bash
#
# Install the guestbook overlay into a Canopy checkout.
#
#   ./install.sh [path-to-canopy-checkout]     (default: $CANOPY_DIR, else ~/canopy)
#
# Copies this directory's files over plugin/go/ in that checkout, keeping a timestamped backup of
# everything it replaces, then builds the plugin binary. The generated contract/tx.pb.go ships
# alongside the .proto, so protoc is NOT required — see README.md if you want to regenerate it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANOPY="${1:-${CANOPY_DIR:-$HOME/canopy}}"
# the canopy release this overlay was written and verified against
EXPECTED_TAG="v0.1.22+beta"

# the files this overlay owns, relative to plugin/go/
FILES=(
  proto/tx.proto
  contract/contract.go
  contract/guestbook.go
  contract/rpc.go
  contract/error.go
  contract/tx.pb.go
)

if [[ ! -d "$CANOPY/plugin/go" ]]; then
  echo "error: '$CANOPY' does not look like a Canopy checkout (no plugin/go directory)." >&2
  echo "       pass the path explicitly:  ./install.sh /path/to/canopy" >&2
  exit 1
fi

# The overlay replaces whole files, so it is pinned to the release it was written against. A
# different tag is a warning rather than a hard stop — review the diff before trusting it.
if command -v git >/dev/null && git -C "$CANOPY" rev-parse --git-dir >/dev/null 2>&1; then
  ACTUAL_TAG="$(git -C "$CANOPY" describe --tags --abbrev=0 2>/dev/null || echo unknown)"
  if [[ "$ACTUAL_TAG" != "$EXPECTED_TAG" ]]; then
    echo "warning: this overlay was verified against $EXPECTED_TAG, but the checkout reports $ACTUAL_TAG."
    echo "         it replaces whole files, so review 'git -C $CANOPY diff plugin/go' afterwards."
  fi
fi

BACKUP="$CANOPY/plugin/go/.guestbook-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"

for rel in "${FILES[@]}"; do
  target="$CANOPY/plugin/go/$rel"
  if [[ -f "$target" ]]; then
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp "$target" "$BACKUP/$rel"
  fi
  mkdir -p "$(dirname "$target")"
  cp "$HERE/$rel" "$target"
  echo "  installed plugin/go/$rel"
done

echo "backup of replaced files: $BACKUP"
echo
echo "building the plugin..."
( cd "$CANOPY/plugin/go" && go build -o go-plugin . )
echo "built $CANOPY/plugin/go/go-plugin"
echo
echo "next:"
echo "  1. set \"plugin\": \"go\" in ~/.canopy/config.json"
echo "  2. run 'canopy start' from $CANOPY"
echo "  3. curl http://localhost:50010/v1/health"
