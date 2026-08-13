const { execFileSync } = require('child_process')
const path = require('path')

// electron-builder's own signing step (even ad-hoc, even with CSC_IDENTITY_AUTO_DISCOVERY=false)
// leaves the resource seal incomplete when asar is disabled — codesign reports "Sealed Resources:
// none" despite the signature claiming resources must be present, which macOS Gatekeeper surfaces
// to the user as "app is damaged" (a broken-signature error, not the milder "unidentified
// developer" prompt an ad-hoc signature normally gets). A forced --deep re-sign after packaging,
// before the .dmg is created from this .app, produces a complete seal and fixes it.
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath])
}
