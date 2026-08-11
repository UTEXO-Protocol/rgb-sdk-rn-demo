// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const localCoreSdkPath = path.resolve(__dirname, '../rgb-sdk-core');
const localSdkPath = path.resolve(__dirname, '../rgb-sdk-rn');

// Core SDK comes in as a dependency of the RN SDK, and where it lands depends
// on the install layout: hoisted into the demo's own node_modules when the RN
// SDK is installed from npm, but nested under it when the RN SDK is a
// `file:../rgb-sdk-rn` link installed with --install-strategy=nested (the
// documented setup). Probe both — a hand-written mapping to a path that does
// not exist surfaces as "Failed to get the SHA-1", not as a resolution error,
// because resolveRequest's answer is taken on trust.
const coreSdkPath = [
  path.resolve(__dirname, 'node_modules/@utexo/rgb-sdk-core'),
  path.resolve(localSdkPath, 'node_modules/@utexo/rgb-sdk-core'),
].find((dir) => fs.existsSync(path.join(dir, 'dist/conformance/index.cjs')));
/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Both sibling SDKs must be watched. Core is watched whenever the checkout
// exists because `rgb-sdk-rn/node_modules/@utexo/rgb-sdk-core` may be a symlink
// into it (`npm link` / `file:../rgb-sdk-core`); with symlinks enabled Metro
// resolves to the real path and refuses anything outside projectRoot or a watch
// folder — "Unable to resolve module @utexo/rgb-sdk-core". Listing a folder
// that does not exist makes Metro exit at startup, hence the probe.
config.watchFolders = [localSdkPath];
if (fs.existsSync(localCoreSdkPath)) {
  config.watchFolders.push(localCoreSdkPath);
}
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  unstable_enableSymlinks: true,
  unstable_enablePackageExports: false,
  // Metro's package-exports enforcement (enabled by default in Metro 0.83 / RN 0.81)
  // blocks relative imports that aren't listed in a package's `exports` field.
  // expo-constants@18 only exports `.` and `./package.json`, so `./ExponentConstants`
  // fails even though the file exists.  resolveRequest short-circuits that check.
  resolveRequest: (context, moduleName, platform) => {
    // `unstable_enablePackageExports` is off above, so subpath exports are not
    // honoured — `@utexo/rgb-sdk-core/conformance` would resolve as a file path
    // that does not exist. The e2e suite needs those field helpers (they are
    // shared with the web suite so the two cannot drift), so map the one
    // subpath by hand to the built CommonJS entry.
    //
    // When coreSdkPath is undefined the package is missing or unbuilt; fall
    // through so Metro reports that honestly instead of failing on a path this
    // config invented.
    if (moduleName === '@utexo/rgb-sdk-core/conformance' && coreSdkPath) {
      return {
        filePath: path.join(coreSdkPath, 'dist/conformance/index.cjs'),
        type: 'sourceFile',
      };
    }
    // The RN SDK re-exports runtime code from `@utexo/rgb-sdk-core` (LSP
    // client, network defaults, shared types). With package exports off the
    // bare `.` entry isn't resolved on its own, so map it to the sibling
    // checkout's built ESM bundle by hand — this is the sibling-checkout
    // counterpart to the `coreSdkPath` probe above.
    if (moduleName === '@utexo/rgb-sdk-core') {
      return {
        filePath: path.resolve(localCoreSdkPath, 'dist/index.mjs'),
        type: 'sourceFile',
      };
    }
    if (
      moduleName === './ExponentConstants' &&
      context.originModulePath.includes('expo-constants/build/Constants.js')
    ) {
      return {
        filePath: path.resolve(
          path.dirname(context.originModulePath),
          'ExponentConstants.js'
        ),
        type: 'sourceFile',
      };
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
