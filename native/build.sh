#!/bin/bash
# Build the keymon native helper into bin/keymon.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../bin
swiftc -O keymon.swift -o ../bin/keymon
echo "built bin/keymon"
