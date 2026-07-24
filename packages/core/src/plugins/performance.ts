/**
 * Performance metrics plugin for CrossNative
 * Tracks execution time, memory usage, and throughput
 */

import type { Plugin, CallContext, PerformanceMetrics } from '../types.ts';

export interface PerformancePluginOptions {
  /** Report metrics to a callback */
  onReport?: (metrics: PerformanceMetrics) => void;
  /** Automatically log slow calls */
  slowThresholdMs?: number;
  /** Keep history of metrics */
  keepHistory?: boolean;
  /** Maximum history size */
  maxHistorySize?: number;
}

export function PerformancePlugin(options: PerformancePluginOptions = {}): Plugin {
  const {
    onReport,
    slowThresholdMs = 100,
    keepHistory = false,
    maxHistorySize = 1000,
  } = options;

  const history: PerformanceMetrics[] = [];

  return {
    name: 'performance',
    version: '1.0.0',

    afterCall: (context: CallContext, result: unknown) => {
      const executionTime = Date.now() - context.startTime;
      const metrics: PerformanceMetrics = {
        moduleId: context.moduleId,
        methodId: context.methodId,
        executionTime,
        queueTime: 0, // Will be set by native layer
        threadId: context.threadId || 'unknown',
        timestamp: Date.now(),
      };

      // Report slow calls
      if (executionTime > slowThresholdMs) {
        console.warn(
          `[CrossNative:Slow] ${context.moduleId}.${context.methodId} ` +
          `took ${executionTime}ms (threshold: ${slowThresholdMs}ms)`
        );
      }

      // Store in history
      if (keepHistory) {
        history.push(metrics);
        if (history.length > maxHistorySize) {
          history.shift();
        }
      }

      // Report to callback
      onReport?.(metrics);
    },

    onMetrics: (metrics: PerformanceMetrics) => {
      if (keepHistory) {
        history.push(metrics);
        if (history.length > maxHistorySize) {
          history.shift();
        }
      }
    },

    // Expose history for analysis
    // This is accessible via the plugin instance
    // @ts-ignore - extending plugin for developer convenience
    getHistory: () => [...history],
    
    // @ts-ignore
    getAverageTime: (moduleId?: string, methodId?: string) => {
      const filtered = history.filter(
        m => 
          (!moduleId || m.moduleId === moduleId) &&
          (!methodId || m.methodId === methodId)
      );
      
      if (filtered.length === 0) return 0;
      
      const total = filtered.reduce((sum, m) => sum + m.executionTime, 0);
      return total / filtered.length;
    },

    // @ts-ignore
    getSlowestCalls: (limit: number = 10) => {
      return [...history]
        .sort((a, b) => b.executionTime - a.executionTime)
        .slice(0, limit);
    },
  } as Plugin;
}
