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

export async function testHardening(): Promise<void> {
  section('Hardening');

  const backend = await NodeHostBackend.create({ hostPath: HOST_BINARY });
  try {
    await testTimeoutWithoutPlugins(backend);
    await testBadArrayElement(backend);
  } finally {
    backend.dispose();
  }
}
