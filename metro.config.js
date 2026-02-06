// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add watchFolders to include the parent directory where the local package is located
// config.watchFolders = [
//   path.resolve(__dirname, '../../rgb'),
// ];

// Ensure Metro can resolve symlinks and handle WASM files
// config.resolver = {
//   ...config.resolver,
//   nodeModulesPaths: [
//     path.resolve(__dirname, 'node_modules'),
//   ],
//   // Add support for WASM files
//   sourceExts: [...(config.resolver.sourceExts || []), 'wasm'],
//   // Resolve bare exports properly
//   unstable_enablePackageExports: true,
// };

// Configure transformer to handle WASM files
// config.transformer = {
//   ...config.transformer,
//   assetPlugins: config.transformer?.assetPlugins || [],
// };

module.exports = config;
// const config = {};

// module.exports = mergeConfig(getDefaultConfig(__dirname), config);
