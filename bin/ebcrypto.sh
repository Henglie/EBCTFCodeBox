#!/bin/sh
# Source-distribution CLI wrapper; Node.js is required.
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'EBCrypto CLI requires Node.js on PATH.' >&2
  exit 2
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
exec node "$script_dir/../mcp/cli.mjs" "$@"
