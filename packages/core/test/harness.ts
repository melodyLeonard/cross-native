/**
 * Minimal assertion and timing helpers.
 *
 * The core package has no runtime dependencies and no test framework, so the
 * suite carries the handful of helpers it needs.
 */

import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** Compiled test fixture, produced by `make -C packages/nitro-module wasm`. */
export const WASM_FIXTURE = join(
  REPO_ROOT,
  'packages/nitro-module/build/compute.wasm'
);

/** Host binary, produced by `make -C packages/nitro-module crossnative-host`. */
export const HOST_BINARY = join(
  REPO_ROOT,
  'packages/nitro-module/crossnative-host'
);

let passed = 0;
let failed = 0;

/** Record one assertion and print it. */
export function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${name}${detail ? `  (${detail})` : ''}`);
  if (ok) {
    passed++;
  } else {
    failed++;
  }
}

/** Assert a promise rejects, and report the reason. */
export async function checkRejects(name: string, promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    check(name, false, 'expected a rejection');
  } catch (error) {
    check(name, true, (error as Error).message.slice(0, 48));
  }
}

export function closeTo(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon;
}

export function allCloseTo(a: number[], b: number[], epsilon = 1e-9): boolean {
  return a.length === b.length && a.every((value, i) => closeTo(value, b[i], epsilon));
}

export function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

/** Run a function and report how long it took, in milliseconds. */
export async function time<T>(fn: () => Promise<T> | T): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

export function section(title: string): void {
  console.log(`\n${title}`);
}

export function results(): { passed: number; failed: number } {
  return { passed, failed };
}
