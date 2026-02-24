// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const localSdkPath = path.resolve(__dirname, '../rgb-sdk-rn');

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
  ],
};

module.exports = config;
