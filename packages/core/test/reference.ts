/**
 * JavaScript implementations of the fixture's functions.
 *
 * The suite checks native results against these, so a wrong answer from the
 * WASM runtime fails rather than being quietly accepted. They double as the
 * baseline for the benchmark.
 */

/** Row-major n×n matrix multiply, O(n³). */
export function matrixMultiply(a: number[], b: number[], n: number): number[] {
  const result = new Array<number>(n * n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += a[i * n + k] * b[k * n + j];
      }
      result[i * n + j] = sum;
    }
  }

  return result;
}

/** Element-wise transform matching the fixture's `process_dataset`. */
export function processDataset(data: number[]): number[] {
  return data.map((x) => Math.sin(Math.sqrt(x)) * Math.cos(x) + Math.log1p(x));
}

/** Tight floating-point loop matching the fixture's `benchmark_heavy`. */
export function benchmarkHeavy(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.sin(Math.sqrt(i)) * Math.cos(i);
  }
  return sum;
}
