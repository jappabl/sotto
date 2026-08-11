// electron-builder afterSign hook.
// Without an Apple Developer ID, electron-builder leaves the app with the
// generic linker-signed "Electron" identity, and injecting our bundled
// binaries (bin/) invalidates its CodeResources. An invalid signature makes
// macOS silently refuse to persist the Accessibility grant, so the global
// hotkey never works. We deep ad-hoc re-sign with the real bundle id here,
// before the DMG is packaged, so both the .app and the DMG are valid.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const bundleId = context.packager.appInfo.id || 'dev.haolin.sotto';
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', bundleId, appPath],
      { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    console.log(`  • deep ad-hoc re-signed ${path.basename(appPath)} as ${bundleId}`);
  } catch (e) {
    console.error('  ⨯ ad-hoc re-sign failed:', e.message);
    throw e;
  }
};
