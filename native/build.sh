#!/bin/bash
# Build the native helpers into bin/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../bin
swiftc -O keymon.swift -o ../bin/keymon
# meetcap embeds an Info.plist so macOS can show the System Audio Recording
# permission prompt for it.
swiftc -O meetcap.swift -o ../bin/meetcap \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker meetcap-info.plist
codesign --force --sign - ../bin/meetcap >/dev/null 2>&1 || true
# calmon reads the calendar for pre-meeting briefs; its plist carries the
# usage strings macOS shows in the permission prompt.
swiftc -O calmon.swift -o ../bin/calmon \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker calmon-info.plist
codesign --force --sign - ../bin/calmon >/dev/null 2>&1 || true
echo "built bin/keymon bin/meetcap bin/calmon"
