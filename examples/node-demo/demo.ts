/**
 * CrossNative Node demo.
 *
 * Drives the real C++ core (thread pool + wasm3) from the TypeScript API and
 * compares it against equivalent JavaScript. Run with:
 *
 *   node --experimental-strip-types examples/node-demo/demo.ts
 *
 * Requires the host binary and the compiled example module:
 *
 *   make -C packages/nitro-module crossnative-host wasm
 */

import { createNativeModule } from '../../packages/core/src/api/createNativeModule.ts';
import { inoutBuffer, outBuffer } from '../../packages/core/src/bridge/buffers.ts';
import { PerformancePlugin } from '../../packages/core/src/plugins/performance.ts';
import type { NativeModule } from '../../packages/core/src/types.ts';

const WASM = 'packages/nitro-module/build/compute.wasm';

// --- tiny assertion helpers --------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${name}${detail ? `  (${detail})` : ''}`);
  ok ? passed++ : failed++;
}

function closeTo(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon;
}

function ms(value: number): string {
  return `${value.toFixed(1)}ms`;
}

// --- JavaScript reference implementations ------------------------------------

function jsMatrixMultiply(a: number[], b: number[], n: number): number[] {
  const result = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += a[i * n + k] * b[k * n + j];
      result[i * n + j] = sum;
    }
  }
  return result;
}

function jsProcessDataset(data: number[]): number[] {
  return data.map((x) => Math.sin(Math.sqrt(x)) * Math.cos(x) + Math.log1p(x));
}

function jsBenchmarkHeavy(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.sin(Math.sqrt(i)) * Math.cos(i);
  }
  return sum;
}

// --- correctness -------------------------------------------------------------

async function testCorrectness(compute: NativeModule): Promise<void> {
  console.log('\nCorrectness');

  check('module reports its exports', compute.functions.includes('matrix_multiply'),
    `${compute.functions.length} functions`);

  const sum = (await compute.call('add', [1.5, 2.5])) as number;
  check('add(1.5, 2.5) === 4', sum === 4, String(sum));

  const factorial = (await compute.call('factorial', [10])) as number;
  check('factorial(10) === 3628800', factorial === 3628800, String(factorial));

  // Plain arrays become read-only input buffers automatically.
  const arraySum = (await compute.call('sum_array', [[1, 2, 3, 4, 5], 5])) as number;
  check('sum_array([1..5]) === 15', arraySum === 15, String(arraySum));

  // TypedArrays work too.
  const typed = new Float64Array([10, 20, 30]);
  const typedSum = (await compute.call('sum_array', [typed, typed.length])) as number;
  check('sum_array(Float64Array) === 60', typedSum === 60, String(typedSum));

  // Output buffers come back as the call's return value.
  const n = 3;
  const a = [1, 0, 0, 0, 1, 0, 0, 0, 1];      // identity
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const product = (await compute.call('matrix_multiply',
    [a, b, outBuffer(n * n), n])) as number[];
  check('identity * B === B', JSON.stringify(product) === JSON.stringify(b),
    JSON.stringify(product));

  // In-place mutation via inoutBuffer.
  const data = [1, 2, 3, 4];
  const processed = (await compute.call('process_dataset',
    [inoutBuffer(data), data.length])) as number[];
  const expected = jsProcessDataset(data);
  check('process_dataset matches JavaScript',
    processed.every((v, i) => closeTo(v, expected[i])),
    processed.map((v) => v.toFixed(4)).join(', '));

  // Errors surface as rejections, not silent wrong answers.
  await compute.call('nope', []).then(
    () => check('unknown function rejects', false),
    (error: Error) => check('unknown function rejects', true, error.message.slice(0, 48))
  );
}

// --- benchmarks --------------------------------------------------------------

interface BenchRow {
  name: string;
  js: number;
  native: number;
}

async function time<T>(fn: () => Promise<T> | T): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

async function benchmark(compute: NativeModule): Promise<BenchRow[]> {
  console.log('\nBenchmarks (wasm3 interpreter vs JavaScript JIT)');
  const rows: BenchRow[] = [];

  // Matrix multiply, O(n^3)
  {
    const n = 120;
    const a = Array.from({ length: n * n }, (_, i) => i % 7);
    const b = Array.from({ length: n * n }, (_, i) => i % 5);

    const [jsResult, jsTime] = await time(() => jsMatrixMultiply(a, b, n));
    const [nativeResult, nativeTime] = await time(
      () => compute.call('matrix_multiply', [a, b, outBuffer(n * n), n]) as Promise<number[]>
    );

    const agree = (nativeResult as number[]).every((v, i) => closeTo(v, jsResult[i], 1e-6));
    check(`matrix_multiply ${n}x${n} agrees with JS`, agree);
    rows.push({ name: `Matrix ${n}x${n}`, js: jsTime, native: nativeTime });
  }

  // Element-wise transform over a large array
  {
    const size = 200_000;
    const data = Array.from({ length: size }, (_, i) => i % 1000);

    const [, jsTime] = await time(() => jsProcessDataset(data));
    const [, nativeTime] = await time(
      () => compute.call('process_dataset', [inoutBuffer(data), size])
    );

    rows.push({ name: `Process ${size.toLocaleString()} items`, js: jsTime, native: nativeTime });
  }

  // Transfer cost on its own. sum_array over the same 200k elements does
  // almost no arithmetic, so this is essentially the cost of moving the array
  // across the bridge and into WASM memory.
  {
    const size = 200_000;
    const data = Array.from({ length: size }, (_, i) => i % 1000);

    const [, jsTime] = await time(() => data.reduce((a, b) => a + b, 0));
    const [, nativeTime] = await time(
      () => compute.call('sum_array', [data, size])
    );

    rows.push({ name: `Transfer ${size.toLocaleString()} f64 (sum only)`, js: jsTime, native: nativeTime });
  }

  // Pure compute loop, no data transfer
  {
    const iterations = 2_000_000;
    const [jsValue, jsTime] = await time(() => jsBenchmarkHeavy(iterations));
    const [nativeValue, nativeTime] = await time(
      () => compute.call('benchmark_heavy', [iterations]) as Promise<number>
    );

    check('benchmark_heavy agrees with JS',
      closeTo(jsValue, nativeValue as number, 1e-6),
      `${jsValue.toFixed(6)} vs ${(nativeValue as number).toFixed(6)}`);
    rows.push({ name: `Compute loop ${iterations.toLocaleString()}x`, js: jsTime, native: nativeTime });
  }

  return rows;
}

/** Show that long native calls do not block the JS event loop. */
async function testNonBlocking(compute: NativeModule): Promise<void> {
  console.log('\nEvent loop');

  let ticks = 0;
  const interval = setInterval(() => ticks++, 1);

  const start = performance.now();
  await compute.call('benchmark_heavy', [3_000_000]);
  const elapsed = performance.now() - start;

  clearInterval(interval);

  // If the call blocked the loop, the timer would never have fired.
  check('JS event loop keeps running during a native call', ticks > 0,
    `${ticks} ticks over ${ms(elapsed)}`);
}

function printTable(rows: BenchRow[]): void {
  const width = 76;
  console.log('\n' + '-'.repeat(width));
  console.log(
    'Operation'.padEnd(38) + 'JS (V8)'.padStart(11) + 'wasm3'.padStart(11) +
    'Ratio'.padStart(16)
  );
  console.log('-'.repeat(width));

  for (const row of rows) {
    const ratio = row.js / row.native;
    const verdict = ratio >= 1
      ? `${ratio.toFixed(1)}x faster`
      : `${(1 / ratio).toFixed(1)}x slower`;
    console.log(
      row.name.padEnd(38) + ms(row.js).padStart(11) + ms(row.native).padStart(11) +
      verdict.padStart(16)
    );
  }

  console.log('-'.repeat(width));
  console.log(
    'Ratio is wasm3 relative to JavaScript. V8 has an optimising JIT; wasm3 is\n' +
    'an interpreter, so V8 wins on raw compute here. React Native ships Hermes,\n' +
    'which is far slower than V8 at numeric code — these numbers do not carry\n' +
    'over to a device. See EXAMPLE_APP.md.'
  );
}

// --- main --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('CrossNative — Node demo');
  console.log(`node ${process.version} on ${process.platform}/${process.arch}`);

  const performancePlugin = PerformancePlugin({ slowThresholdMs: 250 });

  const compute = await createNativeModule({
    name: 'compute',
    source: 'example-app/native/compute.rs',
    artifact: WASM,
    language: 'rust',
    plugins: [performancePlugin],
  });

  try {
    await testCorrectness(compute);
    const rows = await benchmark(compute);
    await testNonBlocking(compute);
    printTable(rows);

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    compute.dispose();
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nDemo failed:', error?.message ?? error);
  process.exit(1);
});
