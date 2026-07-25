/**
 * Named functions, built from a module's own manifest.
 *
 * Modules compiled with `#[crossnative]` describe their signatures, so instead
 * of `module.call('matrix_multiply', [...])` returning `unknown`, the caller
 * gets `module.fns.matrixMultiply(a, b)` with the arguments and result already
 * in their natural shape.
 */

import type { CallOptions, FunctionSignature, NativeFunction } from '../types.ts';
import type { NativeArg } from './buffers.ts';

/** Convert a Rust `snake_case` name to the `camelCase` JavaScript expects. */
export function toCamelCase(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Check an argument against its declared type before it crosses the boundary,
 * so mistakes surface here rather than as a trap inside the module.
 */
function validate(
  value: unknown,
  type: string,
  functionName: string,
  paramName: string
): NativeArg {
  const fail = (expected: string): never => {
    throw new TypeError(
      `${functionName}(${paramName}): expected ${expected}, got ${typeof value}`
    );
  };

  if (type === 'string') {
    return typeof value === 'string' ? value : fail('a string');
  }

  if (type.startsWith('vec<')) {
    if (ArrayBuffer.isView(value)) {
      return Array.from(value as unknown as ArrayLike<number>);
    }
    return Array.isArray(value) ? value : fail('an array');
  }

  if (typeof value === 'boolean') return value ? 1 : 0;
  return typeof value === 'number' ? value : fail('a number');
}

/**
 * Build the callable set for one module.
 *
 * Both the original Rust name and its camelCase form are exposed, so
 * `process_dataset` and `processDataset` both work.
 */
export function buildCallables(
  manifest: FunctionSignature[],
  invoke: (name: string, args: NativeArg[], options?: CallOptions) => Promise<unknown>
): Record<string, NativeFunction> {
  const callables: Record<string, NativeFunction> = {};

  for (const signature of manifest) {
    const fn: NativeFunction = (...args: unknown[]) => {
      if (args.length !== signature.params.length) {
        return Promise.reject(
          new TypeError(
            `${signature.name} expects ${signature.params.length} argument(s), ` +
            `got ${args.length}`
          )
        );
      }

      let marshalled: NativeArg[];
      try {
        marshalled = signature.params.map((param, i) =>
          validate(args[i], param.type, signature.name, param.name)
        );
      } catch (error) {
        return Promise.reject(error);
      }

      return invoke(signature.name, marshalled);
    };

    // Carry the signature so callers (and generated types) can inspect it.
    Object.defineProperty(fn, 'signature', { value: signature, enumerable: false });
    Object.defineProperty(fn, 'name', { value: signature.name });

    callables[signature.name] = fn;

    const camel = toCamelCase(signature.name);
    if (camel !== signature.name) callables[camel] = fn;
  }

  return callables;
}
