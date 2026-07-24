/**
 * Node backend.
 *
 * Talks to the `crossnative-host` binary over line-delimited JSON on stdio.
 * This is the development path: it runs the real C++ core — same thread pool,
 * same wasm3 runtime — so the JS API can be tested and benchmarked on a laptop
 * without building a React Native app.
 *
 * Build the binary with:
 *   make -C packages/nitro-module crossnative-host
 */

import type { Backend, CallResponse, LoadedModule, ModuleSource } from './backend.ts';
import { BackendError } from './backend.ts';
import type { CallOptions } from '../types.ts';

export interface NodeHostOptions {
  /** Explicit path to the crossnative-host binary. */
  hostPath?: string;
  /** Forward the host's stderr to console.error. Defaults to CROSSNATIVE_DEBUG. */
  debug?: boolean;
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

const HOST_BINARY = 'crossnative-host';
const HOST_RELATIVE_PATH = ['packages', 'nitro-module', HOST_BINARY];

export class NodeHostBackend implements Backend {
  readonly name = 'node-host';

  private child: any = null;
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private disposed = false;
  private readonly debug: boolean;

  private constructor(child: any, debug: boolean) {
    this.child = child;
    this.debug = debug;
  }

  /** Spawn the host process and wait until it answers a ping. */
  static async create(options: NodeHostOptions = {}): Promise<NodeHostBackend> {
    const { spawn } = await import('node:child_process');
    const debug = options.debug ?? Boolean(process.env.CROSSNATIVE_DEBUG);

    const hostPath = options.hostPath
      ?? process.env.CROSSNATIVE_HOST
      ?? (await findHostBinary());

    if (!hostPath) {
      throw new BackendError(
        `Could not find the ${HOST_BINARY} binary. Build it with ` +
        `"make -C packages/nitro-module crossnative-host", or set ` +
        `CROSSNATIVE_HOST to its path.`
      );
    }

    const child = spawn(hostPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const backend = new NodeHostBackend(child, debug);
    backend.attach();

    // Fail fast if the binary is not runnable.
    await backend.request({ op: 'ping' });
    return backend;
  }

  /** Wire up stdout parsing and process lifecycle handling. */
  private attach(): void {
    let buffer = '';

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this.handleLine(line);
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      if (this.debug) process.stderr.write(chunk);
    });

    this.child.on('exit', (code: number | null) => {
      const error = new BackendError(
        `crossnative-host exited${code === null ? '' : ` with code ${code}`}`
      );
      this.rejectAll(error);
      this.child = null;
    });

    this.child.on('error', (error: Error) => {
      this.rejectAll(new BackendError(`crossnative-host failed: ${error.message}`));
    });
  }

  private handleLine(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      if (this.debug) console.error('[CrossNative] unparseable host output:', line);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if (message.success) {
      pending.resolve(message);
    } else {
      pending.reject(new BackendError(message.error ?? 'Unknown native error'));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /** Send one request and await its matching response. */
  private request(payload: Record<string, unknown>): Promise<any> {
    if (this.disposed || !this.child) {
      return Promise.reject(new BackendError('Backend has been disposed'));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, ...payload }) + '\n', (error?: Error) => {
        if (error) {
          this.pending.delete(id);
          reject(new BackendError(`Failed to write to host: ${error.message}`));
        }
      });
    });
  }

  async load(moduleId: string, language: string, source: ModuleSource): Promise<LoadedModule> {
    // The host loads from a path, so in-memory modules are staged to a temp
    // file. On device the JSI backend hands the bytes over directly.
    const path = source.kind === 'path'
      ? source.path
      : await writeTempModule(moduleId, source.bytes);

    const response = await this.request({ op: 'load', moduleId, language, path });
    return {
      functions: response.functions ?? [],
      manifest: response.manifest ?? [],
    };
  }

  async call(
    moduleId: string,
    functionName: string,
    args: unknown[],
    options?: CallOptions
  ): Promise<CallResponse> {
    try {
      const response = await this.request({
        op: 'call',
        moduleId,
        function: functionName,
        args,
        priority: options?.priority ?? 'normal',
        zeroCopy: options?.zeroCopy ?? false,
      });

      return {
        result: response.result ?? null,
        outputs: response.outputs ?? [],
        metrics: response.metrics,
      };
    } catch (error) {
      if (error instanceof BackendError) {
        throw new BackendError(error.message, moduleId, functionName);
      }
      throw error;
    }
  }

  async unload(moduleId: string): Promise<void> {
    await this.request({ op: 'unload', moduleId });
  }

  /** Native-side counters (thread pool size, queue depth, loaded modules). */
  async stats(): Promise<Record<string, number>> {
    const response = await this.request({ op: 'stats' });
    return response.result ?? {};
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.rejectAll(new BackendError('Backend disposed'));
    if (this.child) {
      this.child.stdin.end();
      this.child = null;
    }
  }
}

/**
 * Look for the host binary in the current working directory and its ancestors,
 * which covers running from anywhere inside the monorepo.
 */
async function findHostBinary(): Promise<string | null> {
  const { access } = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  const path = await import('node:path');

  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ...HOST_RELATIVE_PATH);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep walking up
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Stage in-memory module bytes to a temp file so the host can load them.
 *
 * This exists because the development host speaks in paths; it has no
 * equivalent on device.
 */
async function writeTempModule(moduleId: string, bytes: Uint8Array): Promise<string> {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const dir = await mkdtemp(path.join(tmpdir(), 'crossnative-'));
  const file = path.join(dir, `${moduleId}.wasm`);
  await writeFile(file, bytes);
  return file;
}
