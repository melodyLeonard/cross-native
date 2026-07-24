/**
 * Shared memory utilities for zero-copy data transfer
 */

/**
 * Create a SharedArrayBuffer for zero-copy data transfer
 * between JS and native code
 */
export function createSharedBuffer(size: number): SharedArrayBuffer {
  return new SharedArrayBuffer(size);
}

/**
 * View a SharedArrayBuffer as typed array
 */
export function viewAsFloat64Array(buffer: SharedArrayBuffer): Float64Array {
  return new Float64Array(buffer);
}

export function viewAsInt32Array(buffer: SharedArrayBuffer): Int32Array {
  return new Int32Array(buffer);
}

export function viewAsUint8Array(buffer: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

/**
 * Copy data to shared buffer
 */
export function copyToBuffer(
  data: number[],
  buffer: SharedArrayBuffer,
  offset: number = 0
): void {
  const view = new Float64Array(buffer);
  for (let i = 0; i < data.length; i++) {
    view[offset + i] = data[i];
  }
}

/**
 * Read data from shared buffer
 */
export function readFromBuffer(
  buffer: SharedArrayBuffer,
  length: number,
  offset: number = 0
): number[] {
  const view = new Float64Array(buffer);
  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    result.push(view[offset + i]);
  }
  return result;
}
