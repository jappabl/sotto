// electron-builder afterSign hook.
//
// Without an Apple Developer ID, electron-builder leaves the app with the
// generic linker-signed "Electron" identity, and injecting our bundled
// binaries (bin/) invalidates its CodeResources. An invalid signature makes
// macOS silently refuse to persist the Accessibility grant, so the global
// hotkey never works.
//
// We re-sign here (before the DMG is packaged). If a stable self-signed
// "Sotto Local Signing" identity exists in the keychain we use it — that
// gives the app a designated requirement that does NOT change across
// rebuilds, so the user's Accessibility/Microphone grants survive every
// future `npm run dist`. Otherwise we fall back to a valid ad-hoc signature
// (grantable, but grants reset on each rebuild).
//
// To create the stable identity once:
//   see scripts/create-signing-cert.sh

const { execFileSync } = require('child_process');
const path = require('path');

const STABLE_IDENTITY = 'Sotto Local Signing';

function stableIdentityHash() {
  try {
    const out = execFileSync('security', ['find-identity', '-v'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes(STABLE_IDENTITY));
    if (line) return line.trim().split(/\s+/)[1];
    // -v hides untrusted self-signed certs; look them up directly.
    const all = execFileSync('security', ['find-identity'], { encoding: 'utf8' });
    const l2 = all.split('\n').find((l) => l.includes(STABLE_IDENTITY));
    if (l2) return l2.trim().split(/\s+/)[1];
  } catch { /* none */ }
  return null;
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const bundleId = context.packager.appInfo.id || 'dev.haolin.sotto';
  const hash = stableIdentityHash();
  const signWith = hash || '-';
  try {
    execFileSync('codesign', ['--force', '--deep', '-s', signWith, '--identifier', bundleId, appPath],
      { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    console.log(`  • re-signed ${path.basename(appPath)} as ${bundleId} with ${hash ? `"${STABLE_IDENTITY}" (grants persist across rebuilds)` : 'ad-hoc (grants reset each rebuild — run scripts/create-signing-cert.sh once)'}`);
  } catch (e) {
    console.error('  ⨯ re-sign failed:', e.message);
    throw e;
  }
};
