/**
 * Core integration suite.
 *
 * Exercises the TypeScript API against the real C++ core — same thread pool,
 * same wasm3 runtime the device build uses — through the development host
 * binary. Run from the repository root:
 *
 *   npm test
 *
 * or directly:
 *
 *   make -C packages/native crossnative-host wasm
 *   node --experimental-strip-types packages/core/test/run.ts
 */

import { createNativeModule } from '../src/api/createNativeModule.ts';
import { NodeHostBackend } from '../src/bridge/node-host.ts';
import { PerformancePlugin } from '../src/plugins/performance.ts';
import type { NativeModule } from '../src/types.ts';
import { printTable, runBenchmarks } from './benchmark.ts';
import { testCorrectness } from './correctness.ts';
import { testHardening } from './hardening.ts';
import { HOST_BINARY, WASM_FIXTURE, check, formatMs, results, section } from './harness.ts';

/**
 * A long native call must not block the JavaScript thread.
 *
 * This is the property the whole project exists for, so it is asserted rather
 * than merely reported: if the call blocked the loop, the timer never fires.
 */
async function testNonBlocking(compute: NativeModule): Promise<void> {
  section('Event loop');

  let ticks = 0;
  const interval = setInterval(() => ticks++, 1);

  const start = performance.now();
  await compute.fns.benchmark_heavy(3_000_000);
  const elapsed = performance.now() - start;

  clearInterval(interval);

  check(
    'JS event loop keeps running during a native call',
    ticks > 0,
    `${ticks} ticks over ${formatMs(elapsed)}`
  );
}

async function main(): Promise<void> {
  console.log('CrossNative — core integration suite');
  console.log(`node ${process.version} on ${process.platform}/${process.arch}`);

  // The Node backend is a development harness, so it is wired up explicitly
  // rather than auto-detected — that keeps node: built-ins out of the graph
  // Metro walks when the library is bundled for a device.
  const backend = await NodeHostBackend.create({ hostPath: HOST_BINARY });

  const compute = await createNativeModule(
    {
      name: 'compute',
      source: 'packages/native/test/fixtures/compute/src/lib.rs',
      artifact: WASM_FIXTURE,
      language: 'rust',
      plugins: [PerformancePlugin({ slowThresholdMs: 250 })],
    },
    { backend }
  );

  try {
    await testCorrectness(compute);
    await testHardening();
    const rows = await runBenchmarks(compute);
    await testNonBlocking(compute);
    printTable(rows);
  } finally {
    compute.dispose();
  }

  const { passed, failed } = results();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\nSuite failed:', (error as Error)?.message ?? error);
  process.exit(1);
});
