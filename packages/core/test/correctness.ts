/**
 * Correctness checks for the TypeScript API against the real WASM runtime.
 *
 * Every call here goes through the named functions the module describes about
 * itself — no explicit buffers, no length arguments.
 */

import type { NativeModule } from '../src/types.ts';
import { NativeBridge } from '../src/bridge/bridge.ts';
import {
  LanguageNotReadyError,
  UnsupportedLanguageError,
  requireLanguageForFile,
  getLanguageForFile,
} from '@cross-native/languages';
import { allCloseTo, check, checkRejects, section } from './harness.ts';
import { processDataset } from './reference.ts';

/** Scalar arguments and return values. */
async function testScalars(compute: NativeModule): Promise<void> {
  const sum = (await compute.fns.add(1.5, 2.5)) as number;
  check('add(1.5, 2.5) === 4', sum === 4, String(sum));

  const factorial = (await compute.fns.factorial(10)) as number;
  check('factorial(10) === 3628800', factorial === 3628800, String(factorial));
}

/** Arrays cross as arrays, in both directions. */
async function testArrays(compute: NativeModule): Promise<void> {
  const total = (await compute.fns.sum_array([1, 2, 3, 4, 5])) as number;
  check('sum_array([1..5]) === 15', total === 15, String(total));

  // TypedArrays are accepted too.
  const typed = (await compute.fns.sum_array(new Float64Array([10, 20, 30]))) as number;
  check('sum_array(Float64Array) === 60', typed === 60, String(typed));

  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const product = (await compute.fns.matrix_multiply(identity, b)) as number[];
  check('identity x B === B', allCloseTo(product, b), JSON.stringify(product));

  const data = [1, 2, 3, 4];
  const processed = (await compute.fns.process_dataset(data)) as number[];
  check(
    'process_dataset matches JavaScript',
    allCloseTo(processed, processDataset(data)),
    processed.map((v) => v.toFixed(4)).join(', ')
  );
}

/** Strings round-trip as UTF-8. */
async function testStrings(compute: NativeModule): Promise<void> {
  const greeting = (await compute.fns.greet('world')) as string;
  check('greet("world")', greeting === 'Hello, world!', greeting);
}

/** camelCase aliases exist alongside the original Rust names. */
async function testNaming(compute: NativeModule): Promise<void> {
  check(
    'camelCase alias is present',
    typeof compute.fns.matrixMultiply === 'function' &&
      compute.fns.matrixMultiply === compute.fns.matrix_multiply
  );
}

/** Mistakes are caught before they reach the module. */
async function testErrors(compute: NativeModule): Promise<void> {
  await checkRejects('wrong argument count rejects', compute.fns.add(1));
  await checkRejects('wrong argument type rejects', compute.fns.sum_array(42));
  await checkRejects('unknown function rejects', compute.call('nope', []));
}

/**
 * A misconfigured language must fail immediately, naming what is supported —
 * not somewhere deep in the native layer.
 */
async function testLanguageValidation(): Promise<void> {
  const load = (language: string) =>
    new NativeBridge().loadModule({
      name: 'nope',
      source: 'native/lib.ml',
      language: language as never,
    });

  await load('ocaml').then(
    () => check('unknown language is rejected', false, 'it loaded'),
    (error: Error) =>
      check(
        'unknown language is rejected',
        error instanceof UnsupportedLanguageError &&
          error.message.includes('rust'),
        error.constructor.name
      )
  );

  await load('assemblyscript').then(
    () => check('planned language is rejected', false, 'it loaded'),
    (error: Error) =>
      check(
        'planned language is rejected',
        error instanceof LanguageNotReadyError &&
          error.message.includes('not implemented yet'),
        error.constructor.name
      )
  );

  check(
    'extensions map to languages',
    getLanguageForFile('native/compute.rs')?.id === 'rust' &&
      getLanguageForFile('native/lib.ml') === undefined
  );

  try {
    requireLanguageForFile('native/lib.ml');
    check('unknown extension is rejected', false, 'no error');
  } catch (error) {
    check(
      'unknown extension is rejected',
      (error as Error).message.includes('.ml'),
      (error as Error).constructor.name
    );
  }
}

export async function testCorrectness(compute: NativeModule): Promise<void> {
  section('Correctness');

  check(
    'module describes itself',
    compute.manifest.length > 0,
    `${compute.manifest.length} signatures`
  );

  await testScalars(compute);
  await testArrays(compute);
  await testStrings(compute);
  await testNaming(compute);
  await testErrors(compute);

  section('Language validation');
  await testLanguageValidation();
}
