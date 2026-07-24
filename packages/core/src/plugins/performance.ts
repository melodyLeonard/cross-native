/**
 * Performance metrics plugin.
 *
 * Records how long each native call took, warns about slow ones, and can keep
 * a bounded history for later analysis.
 */

import type { Plugin, CallContext, PerformanceMetrics } from '../types.ts';

export interface PerformancePluginOptions {
  /** Report metrics to a callback */
  onReport?: (metrics: PerformanceMetrics) => void;
  /** Warn when a call takes longer than this */
  slowThresholdMs?: number;
  /** Keep history of metrics */
  keepHistory?: boolean;
  /** Maximum history size */
  maxHistorySize?: number;
}

/** A performance plugin, plus the queries it exposes over its history. */
export interface PerformancePluginInstance extends Plugin {
  getHistory(): PerformanceMetrics[];
  getAverageTime(moduleId?: string, methodId?: string): number;
  getSlowestCalls(limit?: number): PerformanceMetrics[];
}

/** A bounded FIFO of metrics, with the queries the plugin exposes. */
class MetricsHistory {
  private entries: PerformanceMetrics[] = [];
  private readonly enabled: boolean;
  private readonly maxSize: number;

  constructor(enabled: boolean, maxSize: number) {
    this.enabled = enabled;
    this.maxSize = maxSize;
  }

  add(metrics: PerformanceMetrics): void {
    if (!this.enabled) return;

    this.entries.push(metrics);
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
  }

  all(): PerformanceMetrics[] {
    return [...this.entries];
  }

  averageTime(moduleId?: string, methodId?: string): number {
    const matching = this.entries.filter(
      (m) =>
        (!moduleId || m.moduleId === moduleId) &&
        (!methodId || m.methodId === methodId)
    );
    if (matching.length === 0) return 0;

    const total = matching.reduce((sum, m) => sum + m.executionTime, 0);
    return total / matching.length;
  }

  slowest(limit: number): PerformanceMetrics[] {
    return [...this.entries]
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, limit);
  }
}

function toMetrics(context: CallContext, executionTime: number): PerformanceMetrics {
  return {
    moduleId: context.moduleId,
    methodId: context.methodId,
    executionTime,
    queueTime: 0, // set by the native layer when it reports one
    threadId: context.threadId ?? 'unknown',
    timestamp: Date.now(),
  };
}

export function PerformancePlugin(
  options: PerformancePluginOptions = {}
): PerformancePluginInstance {
  const {
    onReport,
    slowThresholdMs = 100,
    keepHistory = false,
    maxHistorySize = 1000,
  } = options;

  const history = new MetricsHistory(keepHistory, maxHistorySize);

  return {
    name: 'performance',
    version: '1.0.0',

    afterCall: (context: CallContext) => {
      const executionTime = Date.now() - context.startTime;
      const metrics = toMetrics(context, executionTime);

      if (executionTime > slowThresholdMs) {
        console.warn(
          `[CrossNative:Slow] ${context.moduleId}.${context.methodId} ` +
          `took ${executionTime}ms (threshold: ${slowThresholdMs}ms)`
        );
      }

      history.add(metrics);
      onReport?.(metrics);
    },

    onMetrics: (metrics: PerformanceMetrics) => history.add(metrics),

    getHistory: () => history.all(),
    getAverageTime: (moduleId?: string, methodId?: string) =>
      history.averageTime(moduleId, methodId),
    getSlowestCalls: (limit = 10) => history.slowest(limit),
  };
}
