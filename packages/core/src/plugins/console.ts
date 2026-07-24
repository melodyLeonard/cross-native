/**
 * Console logging plugin for CrossNative
 * Logs native calls to the console for debugging
 */

import type { Plugin, CallContext, PerformanceMetrics } from '../types.ts';

export interface ConsolePluginOptions {
  /** Whether to log call arguments */
  logArgs?: boolean;
  /** Whether to log results */
  logResults?: boolean;
  /** Whether to include performance metrics */
  logMetrics?: boolean;
  /** Custom logger function */
  logger?: typeof console.log;
}

/** Identifies which call a log line belongs to. */
function prefixFor(context: CallContext): string {
  return `[CrossNative:${context.moduleId}.${context.methodId}]`;
}

export function ConsolePlugin(options: ConsolePluginOptions = {}): Plugin {
  const {
    logArgs = false,
    logResults = false,
    logMetrics = true,
    logger = console.log,
  } = options;

  return {
    name: 'console',
    version: '1.0.0',

    beforeCall: (context: CallContext) => {
      if (logArgs) {
        logger(`${prefixFor(context)} Call args:`, context.args);
      } else {
        logger(`${prefixFor(context)} Calling...`);
      }
      return context;
    },

    afterCall: (context: CallContext, result: unknown) => {
      const duration = Date.now() - context.startTime;

      if (logResults) {
        logger(`${prefixFor(context)} Completed in ${duration}ms:`, result);
      } else {
        logger(`${prefixFor(context)} Completed in ${duration}ms`);
      }
    },

    onError: (context: CallContext, error: Error) => {
      console.error(`${prefixFor(context)} Error:`, error.message, error);
    },

    onMetrics: (metrics: PerformanceMetrics) => {
      if (!logMetrics) return;
      
      logger(
        `[CrossNative:Metrics] ${metrics.moduleId}.${metrics.methodId}: ` +
        `${metrics.executionTime}ms (queue: ${metrics.queueTime}ms)`
      );
    },
  };
}
