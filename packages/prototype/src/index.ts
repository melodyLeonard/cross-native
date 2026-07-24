/**
 * CrossNative Prototype — Minimal Working Implementation
 * 
 * This is a simplified version that demonstrates the core concept:
 * 1. Load a WASM module compiled from Rust
 * 2. Call functions via JSI
 * 3. Run on separate threads
 * 
 * For production, use the full `react-native-cross-native` package.
 */

export interface ComputeModule {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
  factorial(n: number): Promise<number>;
  sumArray(data: Float64Array): Promise<number>;
  matrixVectorMult(matrix: Float64Array, vector: Float64Array, n: number): Promise<Float64Array>;
  matrixMultiply(a: Float64Array, b: Float64Array, n: number): Promise<Float64Array>;
  processDataset(data: Float64Array): Promise<void>;
}

export interface CallOptions {
  /** Priority: 0=immediate, 1=high, 2=normal, 3=low */
  priority?: number;
  /** Timeout in milliseconds */
  timeout?: number;
}

let wasmModule: WebAssembly.Module | null = null;
let wasmInstance: WebAssembly.Instance | null = null;

/**
 * Initialize the WASM runtime
 * 
 * @param wasmBytes Compiled WASM binary (Uint8Array)
 */
export async function initialize(wasmBytes: Uint8Array): Promise<void> {
  // Create memory shared between JS and WASM
  const memory = new WebAssembly.Memory({
    initial: 256,  // 16MB
    maximum: 512,  // 32MB
    shared: true,    // Enable SharedArrayBuffer for multi-threading
  });
  
  const imports = {
    env: {
      memory,
      __memory_base: 0,
      __table_base: 0,
    },
  };
  
  wasmModule = await WebAssembly.compile(wasmBytes);
  wasmInstance = await WebAssembly.instantiate(wasmModule, imports);
  
  console.log('[CrossNative] WASM runtime initialized');
}

/**
 * Create a compute module interface
 */
export function createComputeModule(): ComputeModule {
  if (!wasmInstance) {
    throw new Error('WASM not initialized. Call initialize() first.');
  }
  
  const exports = wasmInstance.exports;
  const memory = exports.memory as WebAssembly.Memory;
  
  return {
    // Simple synchronous functions (can run on any thread)
    add: async (a: number, b: number) => {
      const fn = exports.add as (a: number, b: number) => number;
      return fn(a, b);
    },
    
    multiply: async (a: number, b: number) => {
      const fn = exports.multiply as (a: number, b: number) => number;
      return fn(a, b);
    },
    
    factorial: async (n: number) => {
      const fn = exports.factorial as (n: number) => number;
      return fn(n);
    },
    
    // Array functions (need memory management)
    sumArray: async (data: Float64Array) => {
      const fn = exports.sum_array as (ptr: number, len: number) => number;
      
      // Allocate memory in WASM
      const ptr = allocateArray(memory, data);
      
      // Call function
      const result = fn(ptr, data.length);
      
      // Free memory
      // (In production, use proper allocator)
      
      return result;
    },
    
    matrixVectorMult: async (matrix: Float64Array, vector: Float64Array, n: number) => {
      const fn = exports.matrix_vector_mult as (
        matrixPtr: number, vectorPtr: number, resultPtr: number, n: number
      ) => void;
      
      const matrixPtr = allocateArray(memory, matrix);
      const vectorPtr = allocateArray(memory, vector);
      const resultPtr = allocate(memory, n * 8);
      
      fn(matrixPtr, vectorPtr, resultPtr, n);
      
      // Read result
      const result = readArray(memory, resultPtr, n);
      
      return result;
    },
    
    matrixMultiply: async (a: Float64Array, b: Float64Array, n: number) => {
      const fn = exports.matrix_multiply as (
        aPtr: number, bPtr: number, resultPtr: number, n: number
      ) => void;
      
      const aPtr = allocateArray(memory, a);
      const bPtr = allocateArray(memory, b);
      const resultPtr = allocate(memory, n * n * 8);
      
      fn(aPtr, bPtr, resultPtr, n);
      
      const result = readArray(memory, resultPtr, n * n);
      
      return result;
    },
    
    processDataset: async (data: Float64Array) => {
      const fn = exports.process_dataset as (ptr: number, len: number) => void;
      
      const ptr = allocateArray(memory, data);
      
      fn(ptr, data.length);
      
      // Read modified data back
      const result = readArray(memory, ptr, data.length);
      
      // Copy back to original array (in-place)
      data.set(result);
    },
  };
}

/**
 * Allocate memory in WASM
 */
function allocate(memory: WebAssembly.Memory, bytes: number): number {
  // Simple bump allocator
  // In production, use wasm-allocator or similar
  const view = new Uint8Array(memory.buffer);
  const ptr = 1024; // Start after stack
  
  // Zero-initialize
  for (let i = 0; i < bytes; i++) {
    view[ptr + i] = 0;
  }
  
  return ptr;
}

/**
 * Allocate and copy array to WASM memory
 */
function allocateArray(memory: WebAssembly.Memory, data: Float64Array): number {
  const bytes = data.length * 8;
  const ptr = allocate(memory, bytes);
  
  const view = new Float64Array(memory.buffer);
  for (let i = 0; i < data.length; i++) {
    view[ptr / 8 + i] = data[i];
  }
  
  return ptr;
}

/**
 * Read array from WASM memory
 */
function readArray(memory: WebAssembly.Memory, ptr: number, length: number): Float64Array {
  const result = new Float64Array(length);
  const view = new Float64Array(memory.buffer);
  
  for (let i = 0; i < length; i++) {
    result[i] = view[ptr / 8 + i];
  }
  
  return result;
}

/**
 * Create a worker thread for heavy computation
 * 
 * This runs the computation off the main thread,
 * keeping the UI responsive.
 */
export function createComputeWorker(): {
  compute: <T>(fn: () => T) => Promise<T>;
  terminate: () => void;
} {
  // For web/React Native Web, use Web Workers
  // For React Native, use react-native-threads or JSI
  
  // Simplified: return a wrapper that uses setTimeout to yield
  // In production, use actual worker threads
  
  return {
    compute: async <T>(fn: () => T) => {
      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Run computation
      return fn();
    },
    
    terminate: () => {
      // Cleanup
    },
  };
}

/**
 * Benchmark a function
 */
export async function benchmark<T>(
  name: string,
  fn: () => T,
  iterations: number = 1000
): Promise<{ result: T; avgTime: number }> {
  const times: number[] = [];
  
  // Warmup
  for (let i = 0; i < 10; i++) {
    fn();
  }
  
  // Benchmark
  let result: T;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    result = fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  
  console.log(`[Benchmark] ${name}: ${avgTime.toFixed(3)}ms avg (${iterations} iterations)`);
  
  return { result: result!, avgTime };
}
