/**
 * Metro transformer for `.rs` imports.
 *
 * Lets an app write `import wasmBase64 from './native/compute.rs'` and get the
 * compiled module back as a base64 string — Metro compiles the Rust through
 * @cross-native/compiler on demand and caches by content, so the author never
 * runs cargo.
 *
 * Wire it up in metro.config.js:
 *
 *   const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
 *   module.exports = mergeConfig(getDefaultConfig(__dirname), {
 *     transformer: {
 *       babelTransformerPath: require.resolve('react-native-cross-native/metro-transformer'),
 *     },
 *     resolver: { sourceExts: [...getDefaultConfig(__dirname).resolver.sourceExts, 'rs'] },
 *   });
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Resolve dependencies from the app's root, not this file's location. In a
// normal install they are the same; when the package is linked from a sibling
// checkout, this file is reached through a symlink whose real path sits outside
// the app's node_modules, so a bare require would miss them.
const appRoot = process.cwd();
const fromApp = (id) => require.resolve(id, { paths: [appRoot] });

const upstream = require(fromApp('@react-native/metro-babel-transformer'));

/** The compiler CLI, run through Node's type-stripping (no build step). */
const CLI = fromApp('@cross-native/compiler/bin/cross-native.mjs');

/**
 * Compile one `.rs` file and return its bytes as a base64 string.
 *
 * The file's own directory is the crate root; the CLI generates a Cargo.toml if
 * there isn't one, so a lone `.rs` just works. The CLI prints only the base64 to
 * stdout (diagnostics go to stderr), which we capture here.
 */
function compileRust(filename) {
  const base64 = execFileSync(
    process.execPath,
    ['--experimental-strip-types', CLI, 'build', path.dirname(filename),
     '--language', 'rust', '--entry', path.basename(filename), '--stdout'],
    { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 }
  ).toString('utf8').trim();

  return `export default ${JSON.stringify(base64)};`;
}

module.exports.transform = function transform(params) {
  if (params.filename.endsWith('.rs')) {
    return upstream.transform({
      ...params,
      src: compileRust(params.filename),
    });
  }
  return upstream.transform(params);
};
