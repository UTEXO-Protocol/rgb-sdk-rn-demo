// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Core SDK is installed from npm as a dependency of the RN SDK, resolved
// from the demo's own node_modules.
const localCoreSdkPath = path.resolve(
  __dirname,
  'node_modules/@utexo/rgb-sdk-core'
);


/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

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
    if (moduleName === '@utexo/rgb-sdk-core/conformance') {
      return {
        filePath: path.resolve(localCoreSdkPath, 'dist/conformance/index.cjs'),
        type: 'sourceFile',
      };
    }
    // The RN SDK now re-exports runtime code from `@utexo/rgb-sdk-core`
    // (LSP client, network defaults, shared types). The demo doesn't depend on
    // core directly, and with package exports off the bare `.` entry isn't
    // resolved, so map it to the built ESM bundle by hand.
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
