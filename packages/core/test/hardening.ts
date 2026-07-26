/**
 * Robustness checks for the failure paths — timeouts, malformed input, and
 * oversize buffers. These are the cases that used to hang or crash rather than
 * return a clean error.
 *
 * The suite owns its own host backend so tearing it down at the end can't
 * disturb the main integration run.
 */

import { createNativeModule } from '../src/api/createNativeModule.ts';
import { NodeHostBackend } from '../src/bridge/node-host.ts';
import type { Backend } from '../src/bridge/backend.ts';
import { NativeTimeoutError } from '../src/types.ts';
import type { NativeModule } from '../src/types.ts';
import { HOST_BINARY, WASM_FIXTURE, check, section } from './harness.ts';

/** Load the fixture with no plugins, sharing the suite's backend. */
async function loadPlain(backend: Backend, name: string): Promise<NativeModule> {
  return createNativeModule(
    {
      name,
      source: 'packages/native/test/fixtures/compute/src/lib.rs',
      artifact: WASM_FIXTURE,
      language: 'rust',
    },
    { backend }
  );
}

/** A per-call timeout must fire even when no plugins are configured. */
async function testTimeoutWithoutPlugins(backend: Backend): Promise<void> {
  const mod = await loadPlain(backend, 'hardening-timeout');

  // A long call with a 5ms deadline: it must reject with a timeout, not run to
  // completion. Before the fix the deadline was ignored without plugins.
  let timedOut = false;
  try {
    await mod.call('benchmark_heavy', [2_000_000], { timeout: 5 });
  } catch (error) {
    timedOut = error instanceof NativeTimeoutError;
  }
  check('per-call timeout fires without plugins', timedOut);

  // And a normal call with no deadline still resolves.
  const value = (await mod.call('benchmark_heavy', [10_000])) as number;
  check('call without a timeout still resolves', typeof value === 'number');
}

/** Reject a promise that outruns `ms`, so a hang shows up as a failure. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`hung: no answer within ${ms}ms`)), ms)
    ),
  ]);
}

/** Bad input (a non-number in a numeric array) must reject, not hang or crash. */
async function testBadArrayElement(backend: Backend): Promise<void> {
  const mod = await loadPlain(backend, 'hardening-badinput');
  let rejected = false;
  let hung = false;
  try {
    await withDeadline(mod.call('sum_array', [[1, 'x', 3]]), 3000);
  } catch (error) {
    const message = (error as Error).message;
    hung = message.startsWith('hung:');
    rejected = !hung;
  }
  check('malformed array element rejects cleanly (no hang)', rejected && !hung);
}

/** An AbortSignal must reject a pending call. */
async function testAbortSignal(backend: Backend): Promise<void> {
  const mod = await loadPlain(backend, 'hardening-abort');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);

  let aborted = false;
  try {
    await mod.call('benchmark_heavy', [2_000_000], { signal: controller.signal });
  } catch (error) {
    aborted = /aborted/i.test((error as Error).message);
  }
  check('AbortSignal rejects a pending call', aborted);

  // An already-aborted signal rejects immediately.
  let preAborted = false;
  try {
    await mod.call('benchmark_heavy', [10_000], { signal: AbortSignal.abort() });
  } catch (error) {
    preAborted = /aborted/i.test((error as Error).message);
  }
  check('already-aborted signal rejects immediately', preAborted);
}

/**
 * A large buffer (past the 512 KB module-malloc heap) still round-trips — array
 * arguments grow the module's own linear memory via cn_alloc — and the
 * overflow guard added for huge counts must not reject a genuine buffer.
 */
async function testLargeBuffer(backend: Backend): Promise<void> {
  const mod = await loadPlain(backend, 'hardening-largebuf');
  const n = 100_000; // 800 KB of f64
  const sum = (await withDeadline(
    mod.call('sum_array', [new Array(n).fill(1)]),
    5000
  )) as number;
  check('large buffer (800 KB) round-trips correctly', sum === n, String(sum));
}

/**
 * Disposing one module must not tear down a backend the caller supplied and
 * shares with other modules.
 */
async function testSharedBackendOwnership(backend: Backend): Promise<void> {
  const a = await loadPlain(backend, 'hardening-shared-a');
  const b = await loadPlain(backend, 'hardening-shared-b');

  a.dispose(); // shares `backend` with b — must leave it running

  let stillWorks = false;
  try {
    stillWorks = (await b.call('add', [1, 2])) === 3;
  } catch {
    stillWorks = false;
  }
  check('disposing one module keeps a shared backend alive', stillWorks);
  b.dispose();
}

export async function testHardening(): Promise<void> {
  section('Hardening');

  const backend = await NodeHostBackend.create({ hostPath: HOST_BINARY });
  try {
    await testTimeoutWithoutPlugins(backend);
    await testAbortSignal(backend);
    await testBadArrayElement(backend);
    await testLargeBuffer(backend);
    await testSharedBackendOwnership(backend);
  } finally {
    backend.dispose();
  }
}
