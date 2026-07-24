/**
 * Metro transformer for native-language imports.
 *
 * Lets an app write `import wasmBase64 from './native/compute.rs'` — or
 * `.zig`, `.go`, `.c`, `.cpp` — and get the compiled module back as a base64
 * string. Metro compiles the source through @cross-native/compiler on demand and
 * caches by content, so the author never runs cargo, zig, or go by hand.
 *
 * Wire it up in metro.config.js:
 *
 *   const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
 *   const {usableExtensions} = require('@cross-native/languages');
 *   // sourceExts want the extension without the leading dot: 'rs', 'zig', …
 *   const nativeExts = usableExtensions().map((e) => e.replace(/^\./, ''));
 *   module.exports = mergeConfig(getDefaultConfig(__dirname), {
 *     transformer: {
 *       babelTransformerPath: require.resolve('react-native-cross-native/metro-transformer'),
 *     },
 *     resolver: { sourceExts: [...getDefaultConfig(__dirname).resolver.sourceExts, ...nativeExts] },
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

// Extension → language id. Kept as a plain table here rather than imported from
// @cross-native/languages because Metro runs this transformer in a worker
// without type-stripping, and that package ships TypeScript source. The
// registry there remains the source of truth; this mirrors its usable entries.
const LANGUAGE_BY_EXT = {
  '.rs': 'rust',
  '.go': 'go',
  '.zig': 'zig',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
};

/** Match a filename to a supported language id, or undefined. */
function languageForFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return LANGUAGE_BY_EXT[ext];
}

/**
 * Compile one native-language file and return its bytes as a base64 string.
 *
 * The file's own directory is the module root; the CLI infers the language from
 * the extension (or we pass it explicitly) and generates any scaffolding a lone
 * source file needs, so a single `.rs`/`.zig`/`.go`/`.c` just works. The CLI
 * prints only the base64 to stdout (diagnostics go to stderr), captured here.
 */
function compileNative(filename, languageId) {
  // AOT (near-native) is opt-in via CROSSNATIVE_AOT, since it needs wamrc and is
  // slower to build; the default interpreter path keeps fast-refresh instant.
  const args = ['--experimental-strip-types', CLI, 'build', path.dirname(filename),
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
