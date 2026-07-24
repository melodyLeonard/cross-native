/**
 * Nitro-based CrossNative module
 * 
 * Uses Nitro Modules (by Margelo) for high-performance native interop.
 * Provides a HybridObject interface for calling native functions.
 */

import { NitroModules } from 'react-native-nitro-modules'
import type { CrossNative as CrossNativeType } from './CrossNative.nitro'

/**
 * Get the native CrossNative instance
 */
export const CrossNative = NitroModules.createCrossNative<CrossNativeType>('CrossNative')

export type { CrossNativeType }
export { CrossNative }

// Re-export all core types and utilities
export * from '@cross-native/core'
