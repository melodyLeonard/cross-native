/**
 * Nitro TypeScript specification for CrossNative
 * 
 * This file defines the interface that Nitrogen will use to generate
 * native bindings. The actual implementation is in C++ (shared), Swift (iOS), and Kotlin (Android).
 */

import type { HybridObject } from 'react-native-nitro-modules'

/**
 * Options for calling a native function
 */
export interface CallOptions {
  /** Thread priority: 0=immediate, 1=high, 2=normal, 3=low, 4=background */
  priority?: number
  /** Timeout in milliseconds */
  timeout?: number
  /** Use zero-copy shared memory for large arrays */
  zeroCopy?: boolean
}

/**
 * Performance metrics for a native call
 */
export interface PerformanceMetrics {
  executionTime: number
  queueTime: number
  threadId: string
  memoryUsed?: number
}

/**
 * Result from a native function call
 */
export interface NativeResult {
  /** Whether the call succeeded */
  success: boolean
  /** The return value (if success) */
  data?: string // JSON-encoded
  /** Error message (if !success) */
  error?: string
  /** Performance metrics */
  metrics?: PerformanceMetrics
}

/**
 * CrossNative HybridObject - main interface
 * 
 * All methods are async (return Promise) to avoid blocking JS thread.
 */
export interface CrossNative extends HybridObject {
  /**
   * Load a native module from source code
   * 
   * @param moduleId Unique identifier for the module
   * @param language Source language: 'rust', 'go', 'cpp', 'zig', 'wasm'
   * @param sourcePath Path to source file (relative to app bundle)
   * @returns Whether loading succeeded
   */
  loadModule(moduleId: string, language: string, sourcePath: string): Promise<boolean>

  /**
   * Call a function on a loaded module
   * 
   * @param moduleId Module identifier
   * @param functionName Function to call
   * @param argsJson JSON-encoded arguments array
   * @param options Call options
   * @returns JSON-encoded result
   */
  callFunction(
    moduleId: string,
    functionName: string,
    argsJson: string,
    options?: CallOptions
  ): Promise<NativeResult>

  /**
   * Call a function synchronously (only for very fast operations < 1ms)
   * 
   * @param moduleId Module identifier
   * @param functionName Function to call
   * @param argsJson JSON-encoded arguments array
   * @returns JSON-encoded result
   */
  callFunctionSync(
    moduleId: string,
    functionName: string,
    argsJson: string
  ): NativeResult

  /**
   * Unload a module and free its resources
   */
  unloadModule(moduleId: string): void

  /**
   * Check if a module is loaded
   */
  isModuleLoaded(moduleId: string): boolean

  /**
   * Get list of functions exported by a module
   */
  getModuleFunctions(moduleId: string): string[]

  /**
   * Create a shared buffer for zero-copy data transfer
   * 
   * @param size Buffer size in bytes
   * @returns Buffer ID (use with zeroCopy option)
   */
  createSharedBuffer(size: number): string

  /**
   * Release a shared buffer
   */
  releaseSharedBuffer(bufferId: string): void

  /**
   * Get performance statistics
   */
  getStats(): Record<string, number>

  /**
   * Set log level: 'debug', 'info', 'warn', 'error'
   */
  setLogLevel(level: string): void
}
