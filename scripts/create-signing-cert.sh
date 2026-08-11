#!/bin/bash
# Create a stable self-signed code-signing identity for Sotto, once.
#
# Ad-hoc signatures change on every rebuild, which resets the macOS
# Accessibility/Microphone grants and breaks the global hotkey. Signing with
# a stable self-signed cert gives the app a designated requirement that never
# changes, so grants survive every future `npm run dist`. The cert is NOT
# Apple-trusted (Gatekeeper still treats the app as unsigned — that is fine
# for a local build), it just needs to exist so codesign can use it.
#
# Run once:  ./scripts/create-signing-cert.sh
set -euo pipefail

NAME="Sotto Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity "$KEYCHAIN" | grep -q "$NAME"; then
  echo "\"$NAME\" already exists in your keychain. Nothing to do."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -days 3650 -nodes -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

# -legacy: OpenSSL 3's default PKCS12 MAC is unreadable by Apple's keychain.
openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/id.p12" -passout pass:sotto -name "$NAME"

# -T /usr/bin/codesign pre-authorizes codesign so signing never prompts.
security import "$TMP/id.p12" -k "$KEYCHAIN" -P sotto -T /usr/bin/codesign -A

echo
echo "Created \"$NAME\". Future \`npm run dist\` builds sign with it automatically,"
echo "so your Accessibility grant will persist across app updates."
