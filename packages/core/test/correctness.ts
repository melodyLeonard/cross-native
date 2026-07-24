/**
 * Correctness checks for the TypeScript API against the real WASM runtime.
 */

import type { NativeModule } from '../src/types.ts';
import { inoutBuffer, outBuffer } from '../src/bridge/buffers.ts';
import { allCloseTo, check, checkRejects, section } from './harness.ts';
import { processDataset } from './reference.ts';

/** Scalar arguments and return values. */
async function testScalars(compute: NativeModule): Promise<void> {
  const sum = (await compute.call('add', [1.5, 2.5])) as number;
  check('add(1.5, 2.5) === 4', sum === 4, String(sum));

  const factorial = (await compute.call('factorial', [10])) as number;
  check('factorial(10) === 3628800', factorial === 3628800, String(factorial));
}

/** Arrays copied into WASM linear memory. */
async function testInputBuffers(compute: NativeModule): Promise<void> {
  // A plain array becomes a read-only input buffer.
  const fromArray = (await compute.call('sum_array', [[1, 2, 3, 4, 5], 5])) as number;
  check('sum_array([1..5]) === 15', fromArray === 15, String(fromArray));

  // TypedArrays carry their element type with them.
  const typed = new Float64Array([10, 20, 30]);
  const fromTyped = (await compute.call('sum_array', [typed, typed.length])) as number;
  check('sum_array(Float64Array) === 60', fromTyped === 60, String(fromTyped));
}

/** Buffers the module writes into, returned to the caller. */
async function testOutputBuffers(compute: NativeModule): Promise<void> {
  const n = 3;
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const product = (await compute.call(
    'matrix_multiply',
    [identity, b, outBuffer(n * n), n]
  )) as number[];
  check('identity * B === B', allCloseTo(product, b), JSON.stringify(product));

  const data = [1, 2, 3, 4];
  const processed = (await compute.call(
    'process_dataset',
    [inoutBuffer(data), data.length]
  )) as number[];
  check(
    'process_dataset matches JavaScript',
    allCloseTo(processed, processDataset(data)),
    processed.map((v) => v.toFixed(4)).join(', ')
  );
}

/** Failures must reject rather than return a wrong answer. */
async function testErrors(compute: NativeModule): Promise<void> {
  await checkRejects('unknown function rejects', compute.call('nope', []));
  await checkRejects('argument count mismatch rejects', compute.call('add', [1]));
}

export async function testCorrectness(compute: NativeModule): Promise<void> {
  section('Correctness');

  check(
    'module reports its exports',
    compute.functions.includes('matrix_multiply'),
    `${compute.functions.length} functions`
  );

  await testScalars(compute);
  await testInputBuffers(compute);
  await testOutputBuffers(compute);
  await testErrors(compute);
}
