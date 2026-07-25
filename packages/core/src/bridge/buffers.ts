/**
 * Array arguments.
 *
 * Numbers cross into WASM by value, but arrays have to be copied into the
 * module's linear memory. These helpers describe that intent so the native
 * layer knows what to allocate, copy and read back.
 */

export type BufferElementType =
  | 'f64' | 'f32'
  | 'i32' | 'u32'
  | 'i64' | 'u64'
  | 'i16' | 'u16'
  | 'i8'  | 'u8';

/** Copy an array into WASM memory; the module only reads it. */
export interface InBuffer {
  in: number[];
  type: BufferElementType;
}

/** Allocate a zeroed buffer; the module writes into it and we read it back. */
export interface OutBuffer {
  out: number;
  type: BufferElementType;
}

/** Copy in, let the module mutate in place, read it back. */
export interface InOutBuffer {
  inout: number[];
  type: BufferElementType;
}

export type BufferArg = InBuffer | OutBuffer | InOutBuffer;

/** A value that can be passed to a native function. */
export type NativeArg = number | boolean | string | BufferArg | ArrayLike<number>;

/**
 * Pass an array the module will only read.
 *
 * @example
 * await mod.call('sum_array', [inBuffer([1, 2, 3]), 3]);
 */
export function inBuffer(
  data: ArrayLike<number>,
  type: BufferElementType = 'f64'
): InBuffer {
  return { in: toNumberArray(data), type };
}

/**
 * Reserve a buffer for the module to write into. The contents come back in
 * the call's outputs.
 *
 * @example
 * const product = await mod.call('matrix_multiply', [a, b, outBuffer(n * n), n]);
 */
export function outBuffer(
  count: number,
  type: BufferElementType = 'f64'
): OutBuffer {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`outBuffer count must be a positive integer, got ${count}`);
  }
  return { out: count, type };
}

/**
 * Pass an array the module mutates in place.
 *
 * @example
 * const processed = await mod.call('process_dataset', [inoutBuffer(data), data.length]);
 */
export function inoutBuffer(
  data: ArrayLike<number>,
  type: BufferElementType = 'f64'
): InOutBuffer {
  return { inout: toNumberArray(data), type };
}

type TypedArrayCtor = new (...args: never[]) => ArrayBufferView;

const TYPED_ARRAY_TYPES: Array<[TypedArrayCtor, BufferElementType]> = [
  [Float64Array, 'f64'],
  [Float32Array, 'f32'],
  [Int32Array, 'i32'],
  [Uint32Array, 'u32'],
  [Int16Array, 'i16'],
  [Uint16Array, 'u16'],
  [Int8Array, 'i8'],
  [Uint8Array, 'u8'],
];

/** Map a TypedArray to its WASM element type, if it is one. */
function typedArrayElementType(value: object): BufferElementType | null {
  for (const [ctor, type] of TYPED_ARRAY_TYPES) {
    if (value instanceof (ctor as any)) return type;
  }
  return null;
}

function toNumberArray(data: ArrayLike<number>): number[] {
  return Array.from(data as ArrayLike<number>, Number);
}

/** True if the value already describes a buffer argument. */
export function isBufferArg(value: unknown): value is BufferArg {
  if (typeof value !== 'object' || value === null) return false;
  return 'in' in value || 'out' in value || 'inout' in value;
}

/**
 * Normalise a user-supplied argument into the wire format the native layer
 * expects.
 *
 * Plain numbers pass through. TypedArrays and plain arrays become read-only
 * input buffers — pass {@link inoutBuffer} or {@link outBuffer} explicitly when
 * you need the data back.
 */
export function normalizeArg(arg: NativeArg, index: number): unknown {
  if (typeof arg === 'number') return arg;
  if (typeof arg === 'boolean') return arg ? 1 : 0;

  if (isBufferArg(arg)) return arg;

  if (ArrayBuffer.isView(arg)) {
    const type = typedArrayElementType(arg);
    if (!type) {
      throw new TypeError(
        `Argument ${index} is a ${arg.constructor.name}, which has no WASM equivalent`
      );
    }
    return { in: toNumberArray(arg as unknown as ArrayLike<number>), type };
  }

  if (Array.isArray(arg)) {
    return { in: toNumberArray(arg), type: 'f64' };
  }

  throw new TypeError(
    `Argument ${index} must be a number, an array, or a buffer helper, got ${typeof arg}`
  );
}
