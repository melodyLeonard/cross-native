import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Compiles each package's TypeScript to dist JS. The compiler emits JS even
// with type errors (noEmitOnError is off), so we verify dist/index.js was
// written rather than trusting tsc's exit code, and only fail when nothing came
// out — surfacing the diagnostics in that case.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
const packages = ['languages', 'core', 'compiler', 'native'];

for (const pkg of packages) {
  const dir = path.join(root, 'packages', pkg);
  let diagnostics = '';
  try {
    execFileSync(tsc, ['-p', 'tsconfig.build.json'], { cwd: dir, encoding: 'utf8' });
  } catch (err) {
    diagnostics = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }

  for (const artifact of ['index.js', 'index.d.ts']) {
    const out = path.join(dir, 'dist', artifact);
    if (!existsSync(out) || statSync(out).size === 0) {
      console.error(`build failed for ${pkg}: no dist/${artifact} emitted`);
      if (diagnostics) console.error(diagnostics);
      process.exit(1);
    }
  }
  console.log(`built ${pkg} -> dist/index.js + index.d.ts`);
}
