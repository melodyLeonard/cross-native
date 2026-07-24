const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration for CrossNative
 * 
 * Key changes:
 * - WASM file support (compiled Rust → WASM)
 * - Asset support for .rs, .go, .cpp files
 */

const config = {
  resolver: {
    assetExts: [
      ...getDefaultConfig(__dirname).resolver.assetExts,
      'wasm',
      'rs',
      'go',
      'cpp',
      'c',
    ],
    sourceExts: [
      ...getDefaultConfig(__dirname).resolver.sourceExts,
      'wasm',
    ],
  },
  transformer: {
    // WASM files should be treated as assets
    assetRegistryPath: require.resolve('react-native/Libraries/Image/AssetRegistry'),
  },
  server: {
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        // Add CORS headers for WASM loading
        if (req.url?.endsWith('.wasm')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/wasm');
        }
        return middleware(req, res, next);
      };
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
