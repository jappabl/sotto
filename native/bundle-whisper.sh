#!/bin/bash
# Copy whisper-cli + whisper-server and their Homebrew dylib closure into
# bin/, rewriting install names so the binaries run from anywhere (no
# Homebrew needed on the target machine). Compatible with macOS bash 3.2.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin

resolve() {
  # Resolve an otool dep entry to a real file path.
  local ref="$1" from="$2"
  case "$ref" in
    @rpath/*)
      local base="${ref#@rpath/}"
      local rp
      for rp in $(otool -l "$from" | awk '/LC_RPATH/{getline;getline;print $2}'); do
        [ -f "$rp/$base" ] && { echo "$rp/$base"; return; }
      done
      local d
      for d in /opt/homebrew/lib /opt/homebrew/opt/*/lib; do
        [ -f "$d/$base" ] && { echo "$d/$base"; return; }
      done
      echo "" ;;
    /opt/homebrew/*) echo "$ref" ;;
    *) echo "" ;;
  esac
}

seen=" "
# Queue items keep the *referenced* name (symlink) so bundled files match the
# names binaries actually load, while contents come from the resolved file.
queue="/opt/homebrew/bin/whisper-cli /opt/homebrew/bin/whisper-server"
# llama-server is optional (AI Polish); bundle it when present.
[ -x /opt/homebrew/bin/llama-server ] && queue="$queue /opt/homebrew/bin/llama-server"

while [ -n "${queue// /}" ]; do
  item="${queue%% *}"
  queue="${queue#* }"
  [ "$item" = "$queue" ] && queue=""
  [ -z "$item" ] && continue
  name=$(basename "$item")
  case "$seen" in *" $name "*) continue ;; esac
  seen="$seen$name "
  cp -fL "$item" "bin/$name"   # -L follows symlinks; keeps the symlink's name
  chmod u+w "bin/$name"
  deps=$(otool -L "bin/$name" | tail -n +2 | awk '{print $1}')
  for dep in $deps; do
    resolved=$(resolve "$dep" "$item")
    [ -n "$resolved" ] && queue="$queue $resolved"
  done
done

for f in bin/whisper-cli bin/whisper-server bin/llama-server bin/*.dylib; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  case "$base" in
    *.dylib) install_name_tool -id "@executable_path/$base" "$f" 2>/dev/null || true ;;
  esac
  deps=$(otool -L "$f" | tail -n +2 | awk '{print $1}')
  for dep in $deps; do
    depbase=$(basename "$dep")
    if [ -f "bin/$depbase" ] && [ "$depbase" != "$base" ]; then
      install_name_tool -change "$dep" "@executable_path/$depbase" "$f" 2>/dev/null || true
    fi
  done
  codesign --force --sign - "$f" >/dev/null 2>&1 || true
done

echo "bundled: $(ls bin | tr '\n' ' ')"
