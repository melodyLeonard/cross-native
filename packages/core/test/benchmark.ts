/**
 * Benchmark: the wasm3 interpreter against the host JavaScript engine.
 *
 * Read the Performance section of the top-level README before drawing
 * conclusions — under Node this compares wasm3 to V8's optimising JIT, which
 * is not the comparison that matters for React Native.
 */

import type { NativeModule } from '../src/types.ts';
import { inoutBuffer, outBuffer } from '../src/bridge/buffers.ts';
import { allCloseTo, check, closeTo, formatMs, section, time } from './harness.ts';
import { benchmarkHeavy, matrixMultiply, processDataset } from './reference.ts';

export interface BenchRow {
  name: string;
  js: number;
  native: number;
}

const TABLE_WIDTH = 76;

/** O(n³) work over buffers that must cross the bridge in both directions. */
async function benchMatrix(compute: NativeModule): Promise<BenchRow> {
  const n = 120;
  const a = Array.from({ length: n * n }, (_, i) => i % 7);
  const b = Array.from({ length: n * n }, (_, i) => i % 5);

  const [jsResult, js] = await time(() => matrixMultiply(a, b, n));
  const [nativeResult, native] = await time(
    () => compute.call('matrix_multiply', [a, b, outBuffer(n * n), n]) as Promise<number[]>
  );

  check(`matrix_multiply ${n}x${n} agrees with JS`, allCloseTo(nativeResult, jsResult, 1e-6));
  return { name: `Matrix ${n}x${n}`, js, native };
}

/** Element-wise work, dominated by moving the array across the bridge. */
async function benchDataset(compute: NativeModule): Promise<BenchRow> {
  const size = 200_000;
  const data = Array.from({ length: size }, (_, i) => i % 1000);

  const [, js] = await time(() => processDataset(data));
  const [, native] = await time(
    () => compute.call('process_dataset', [inoutBuffer(data), size])
  );

  return { name: `Process ${size.toLocaleString()} items`, js, native };
}

/**
 * Transfer cost on its own: `sum_array` does almost no arithmetic, so this is
 * essentially the price of marshalling the array.
 */
async function benchTransfer(compute: NativeModule): Promise<BenchRow> {
  const size = 200_000;
  const data = Array.from({ length: size }, (_, i) => i % 1000);

  const [, js] = await time(() => data.reduce((a, b) => a + b, 0));
  const [, native] = await time(() => compute.call('sum_array', [data, size]));

  return { name: `Transfer ${size.toLocaleString()} f64 (sum only)`, js, native };
}

/** Pure compute, no data crossing the bridge. */
async function benchComputeLoop(compute: NativeModule): Promise<BenchRow> {
  const iterations = 2_000_000;

  const [jsValue, js] = await time(() => benchmarkHeavy(iterations));
  const [nativeValue, native] = await time(
    () => compute.call('benchmark_heavy', [iterations]) as Promise<number>
  );

  check(
    'benchmark_heavy agrees with JS',
    closeTo(jsValue, nativeValue, 1e-6),
    `${jsValue.toFixed(6)} vs ${nativeValue.toFixed(6)}`
  );
  return { name: `Compute loop ${iterations.toLocaleString()}x`, js, native };
}

export async function runBenchmarks(compute: NativeModule): Promise<BenchRow[]> {
  section('Benchmarks (wasm3 interpreter vs JavaScript JIT)');

  return [
    await benchMatrix(compute),
    await benchDataset(compute),
    await benchTransfer(compute),
    await benchComputeLoop(compute),
  ];
}

function formatRow(row: BenchRow): string {
  const ratio = row.js / row.native;
  const verdict = ratio >= 1
    ? `${ratio.toFixed(1)}x faster`
    : `${(1 / ratio).toFixed(1)}x slower`;

  return row.name.padEnd(38) +
    formatMs(row.js).padStart(11) +
    formatMs(row.native).padStart(11) +
    verdict.padStart(16);
}

export function printTable(rows: BenchRow[]): void {
  const divider = '-'.repeat(TABLE_WIDTH);

  console.log(`\n${divider}`);
  console.log(
    'Operation'.padEnd(38) + 'JS (V8)'.padStart(11) +
    'wasm3'.padStart(11) + 'Ratio'.padStart(16)
  );
  console.log(divider);

  for (const row of rows) {
    console.log(formatRow(row));
  }

  console.log(divider);
  console.log(
    'Ratio is wasm3 relative to JavaScript. V8 has an optimising JIT; wasm3 is\n' +
    'an interpreter, so V8 wins on raw compute here. React Native ships Hermes,\n' +
    'which is far slower than V8 at numeric code, so these numbers do not carry\n' +
    'over to a device.'
  );
}
