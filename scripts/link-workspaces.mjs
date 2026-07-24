/**
 * Symlink the workspace packages into the root node_modules.
 *
 * The packages depend on each other by name, as published packages must, but
 * this repository deliberately has no install step: the core has no external
 * runtime dependencies and its TypeScript runs straight off disk. Creating the
 * links ourselves keeps both properties — real package specifiers in the source,
 * and `npm test` working on a fresh clone without downloading anything.
 */

import { mkdir, readFile, symlink, rm, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(root, 'packages');
const nodeModules = join(root, 'node_modules');

for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const packageDir = join(packagesDir, entry.name);
  let name;
  try {
    name = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')).name;
  } catch {
    continue; // not a JS package (the Rust workspace, for instance)
  }

  const target = join(nodeModules, name);
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await symlink(relative(dirname(target), packageDir), target, 'dir');
  console.log(`linked ${name} -> packages/${entry.name}`);
}
