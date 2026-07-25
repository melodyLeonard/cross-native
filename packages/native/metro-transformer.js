// Metro transformer that compiles imported native-language sources (.rs, .zig,
// .go, .c, .cpp) to a base64 WASM string on demand, so apps can `import wasm
// from './compute.rs'` without running a toolchain by hand.
//
// metro.config.js:
//   transformer.babelTransformerPath =
//     require.resolve('react-native-cross-native/metro-transformer');
//   resolver.sourceExts += ['rs','go','zig','c','cc','cpp','cxx'];

const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Resolve deps from the app root: when the package is linked from a sibling
// checkout, this file is reached through a symlink outside the app's
// node_modules, so a bare require would miss them.
const appRoot = process.cwd();
const fromApp = (id) => require.resolve(id, { paths: [appRoot] });

const upstream = require(fromApp('@react-native/metro-babel-transformer'));
const CLI = fromApp('@cross-native/compiler/bin/cross-native.mjs');

// Not imported from @cross-native/languages because Metro runs this in a worker
// without type-stripping and that package ships TypeScript.
const LANGUAGE_BY_EXT = {
  '.rs': 'rust',
  '.go': 'go',
  '.zig': 'zig',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
};

function languageForFile(filename) {
  return LANGUAGE_BY_EXT[path.extname(filename).toLowerCase()];
}

function compileNative(filename, languageId) {
  const args = [CLI, 'build', path.dirname(filename),
    '--language', languageId, '--entry', path.basename(filename), '--stdout'];
  if (process.env.CROSSNATIVE_AOT === '1') args.push('--aot');

  const base64 = execFileSync(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8').trim();

  return `export default ${JSON.stringify(base64)};`;
}

module.exports.transform = function transform(params) {
  const languageId = languageForFile(params.filename);
  if (languageId) {
    return upstream.transform({
      ...params,
      src: compileNative(params.filename, languageId),
    });
  }
  return upstream.transform(params);
};
