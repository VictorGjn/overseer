#!/usr/bin/env bash
# The plan's check: ./check.sh (task 1) or ./check.sh name (task 2).
set -e
cd "$(dirname "$0")"
[ "$(node cli.js hello)" = "Hello, world" ]
[ "${1:-}" != name ] || [ "$(node cli.js hello --name Ada)" = "Hello, Ada" ]
