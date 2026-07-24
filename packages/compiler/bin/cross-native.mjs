#!/usr/bin/env node --experimental-strip-types

/**
 * cross-native — build a native module and embed it for the bundler.
 *
 *   cross-native build [dir]     compile ./native (or dir) and embed the result
 *   cross-native doctor          report which language toolchains are usable
 *
 * Flags:
 *   --language <id>   override the language inferred from the sources
 *   --out <path>      where to write the embedded module
 *   --fix             run any safe toolchain fixes, such as adding a target
 */

import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import {
  getLanguageForFile,
  listLanguages,
  requireUsableLanguage,
  isUsable,
} from '@cross-native/languages';
import {
  compile,
  embedWasm,
  toBase64,
  inspectToolchain,
  describeMissing,
} from '@cross-native/compiler';

const RUNTIME_CRATE = resolve(
  import.meta.dirname,
  '..',
  '..',
  'crossnative-rs',
  'crossnative'
);

function parseArgs(argv) {
  const options = { command: argv[0] ?? 'build', dir: 'native', flags: {} };
  const rest = argv.slice(1);

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      options.flags[arg.slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i] ?? true;
    } else {
      options.dir = arg;
    }
  }
  return options;
}

/** Work out which language a directory holds, from the files in it. */
async function detectLanguage(dir) {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    throw new Error(`No such directory: ${dir}`);
  }

  for (const entry of entries) {
    const language = getLanguageForFile(entry);
    if (language) return language;
  }

  throw new Error(
    `Could not tell what language ${dir} is written in.\n` +
    `No file matched a supported extension. Pass --language to be explicit.`
  );
}

async function build({ dir, flags }) {
  const sourceDir = resolve(dir);
  const language = flags.language
    ? requireUsableLanguage(flags.language)
    : await detectLanguage(sourceDir);

  // Diagnostics go to stderr so that --stdout keeps stdout to the payload alone.
  const log = flags.stdout ? (m) => process.stderr.write(m + '\n') : console.log;
  log(`Building ${language.displayName} module in ${dir}`);

  const result = await compile({
    language: language.id,
    sourceDir,
    moduleName: basename(sourceDir),
    runtimeCratePath: RUNTIME_CRATE,
    entryFile: typeof flags.entry === 'string' ? flags.entry : undefined,
    fix: Boolean(flags.fix),
  });

  if (!result.ok) {
    console.error(`\n${result.error}`);
    process.exit(1);
  }

  // Metro transformer path: print base64 to stdout, nothing else.
  if (flags.stdout) {
    process.stdout.write(await toBase64(result.artifactPath));
    return;
  }

  const out = resolve(flags.out ?? join(sourceDir, '..', 'src', 'generated', 'native.ts'));
  const size = await embedWasm(result.artifactPath, out);

  log(`  compiled  ${result.artifactPath}`);
  log(`  embedded  ${out}  (${size.toLocaleString()} bytes)`);
}

async function doctor() {
  console.log('CrossNative language support\n');

  for (const language of listLanguages()) {
    if (!isUsable(language.support)) {
      console.log(`  ${language.displayName.padEnd(16)} not implemented yet ` +
                  `(${language.extensions.join(', ')})`);
      continue;
    }

    const report = await inspectToolchain(language.id);
    const state = report.ready ? 'ready' : 'missing tools';
    console.log(`  ${language.displayName.padEnd(16)}${state} ` +
                `(${language.extensions.join(', ')})`);

    for (const status of report.tools) {
      const mark = status.present ? '✓' : '✗';
      const detail = status.present ? status.version ?? '' : status.tool.installHint;
      console.log(`      ${mark} ${status.tool.label.padEnd(22)}${detail}`);
    }
  }
}

const options = parseArgs(process.argv.slice(2));

try {
  if (options.command === 'build') await build(options);
  else if (options.command === 'doctor') await doctor();
  else {
    console.error(`Unknown command "${options.command}". Try: build, doctor`);
    process.exit(2);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
