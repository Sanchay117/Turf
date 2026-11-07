#!/bin/zsh
# Build the Turf program with the Solana platform tools (no rustup needed).
set -e
TOOLS="$HOME/.cache/solana/v1.58/platform-tools"
export PATH="$TOOLS/rust/bin:$TOOLS/llvm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/../programs/turf"
cargo build-sbf --tools-version v1.58 --no-rustup-override --skip-tools-install
ls -la ../../target/deploy/turf.so
