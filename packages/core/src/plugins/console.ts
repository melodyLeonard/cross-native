/**
 * Console logging plugin for CrossNative
 * Logs native calls to the console for debugging
 */

import type { Plugin, CallContext, PerformanceMetrics } from '../types.ts';

export interface ConsolePluginOptions {
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Whether to log call arguments */
  logArgs?: boolean;
  /** Whether to log results */
  logResults?: boolean;
  /** Whether to include performance metrics */
  logMetrics?: boolean;
  /** Custom logger function */
  logger?: typeof console.log;
}

export function ConsolePlugin(options: ConsolePluginOptions = {}): Plugin {
  const {
    level = 'debug',
    logArgs = false,
    logResults = false,
    logMetrics = true,
    logger = console.log,
  } = options;

  return {
    name: 'console',
    version: '1.0.0',

    beforeCall: (context: CallContext) => {
      const prefix = `[CrossNative:${context.moduleId}.${context.methodId}]`;
      
      if (logArgs) {
        logger(`${prefix} Call args:`, context.args);
      } else {
        logger(`${prefix} Calling...`);
      }

      return context;
    },

    afterCall: (context: CallContext, result: unknown) => {
      const duration = Date.now() - context.startTime;
      const prefix = `[CrossNative:${context.moduleId}.${context.methodId}]`;
      
      if (logResults) {
        logger(`${prefix} Completed in ${duration}ms:`, result);
      } else {
        logger(`${prefix} Completed in ${duration}ms`);
      }
    },

    onError: (context: CallContext, error: Error) => {
      const prefix = `[CrossNative:${context.moduleId}.${context.methodId}]`;
      console.error(`${prefix} Error:`, error.message, error);
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
