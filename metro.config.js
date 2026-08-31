// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web implementation (used for on-device order/site persistence) loads a .wasm asset.
config.resolver.assetExts.push('wasm');

module.exports = config;
