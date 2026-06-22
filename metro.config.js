// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const localSdkPath = path.resolve(__dirname, '../rgb-sdk-rn');
// const localCoreSdkPath = path.resolve(__dirname, '../rgb-sdk-core');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Watch the local SDK package so Metro picks up changes
config.watchFolders = [localSdkPath];

// Ensure Metro resolves modules from the demo's node_modules first,
// avoiding duplicate React/React-Native instances from the local package
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(localSdkPath, 'node_modules'),
    // path.resolve(localCoreSdkPath, 'node_modules'),
  ],
  unstable_enableSymlinks: true,
  unstable_enablePackageExports: false,
  // Metro's package-exports enforcement (enabled by default in Metro 0.83 / RN 0.81)
  // blocks relative imports that aren't listed in a package's `exports` field.
  // expo-constants@18 only exports `.` and `./package.json`, so `./ExponentConstants`
  // fails even though the file exists.  resolveRequest short-circuits that check.
  resolveRequest: (context, moduleName, platform) => {
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
