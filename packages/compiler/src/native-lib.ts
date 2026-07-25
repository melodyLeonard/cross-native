// Builds a native static library for the iOS FFI path: parses a .zig file's
// exports, generates a dispatch shim implementing the crossnative_call/manifest
// protocol, and compiles both into a .a for the given Apple target.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './toolchain.ts';

export interface FnSig {
  name: string;
  params: { name: string; type: string }[];
  returns: string;
}

const NUMERIC = new Set([
  'f64', 'f32', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64', 'usize', 'isize',
]);

export function parseZigExports(source: string): FnSig[] {
  const sigs: FnSig[] = [];
  const re = /export\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([A-Za-z_]\w*)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, name, paramList, ret] = m;
    const params = paramList
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const [pname, ptype] = p.split(':').map(s => s.trim());
        return { name: pname, type: ptype };
      });
    sigs.push({ name, params, returns: ret ?? 'void' });
  }
  return sigs;
}

function readArg(type: string, index: number): string {
  const at = `args.items[${index}]`;
  if (type === 'bool') return `(argF64(${at}) != 0)`;
  if (type === 'f64') return `argF64(${at})`;
  if (type === 'f32') return `@as(f32, @floatCast(argF64(${at})))`;
  if (NUMERIC.has(type)) return `@as(${type}, @intFromFloat(argF64(${at})))`;
  throw new Error(
    `linked build supports only numeric/bool parameters; got '${type}'. ` +
    `Arrays and strings are not supported on the iOS linked path yet.`
  );
}

function encodeResult(sig: FnSig): string {
  const call = `${sig.name}(${sig.params.map((p, i) => readArg(p.type, i)).join(', ')})`;
  if (sig.returns === 'void') {
    return `{ ${call}; return respond("{{\\"success\\":true,\\"result\\":null,\\"outputs\\":[]}}", .{}); }`;
  }
  if (sig.returns === 'bool') {
    return `return respond("{{\\"success\\":true,\\"result\\":{},\\"outputs\\":[]}}", .{${call}});`;
  }
  if (NUMERIC.has(sig.returns)) {
    return `return respond("{{\\"success\\":true,\\"result\\":{d},\\"outputs\\":[]}}", .{${call}});`;
  }
  throw new Error(`linked build supports only numeric/bool/void returns; got '${sig.returns}'`);
}

function manifestLiteral(sigs: FnSig[]): string {
  const json = JSON.stringify(
    sigs.map(s => ({
      name: s.name,
      params: s.params.map(p => ({ name: p.name, type: p.type })),
      returns: s.returns,
    }))
  );
  return json.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[{}]/g, b => b + b);
}

export function generateZigDispatch(entryFile: string, sigs: FnSig[], suffix: string): string {
  const dispatch = sigs
    .map(s => `    if (std.mem.eql(u8, func, "${s.name}")) ${encodeResult(s)}`)
    .join('\n');

  // export fn is not pub, so call the exports through extern declarations and
  // import the user file only to force its compilation.
  const externs = sigs
    .map(s => {
      const params = s.params.map(p => `${p.name}: ${p.type}`).join(', ');
      const ret = s.returns === 'void' ? 'void' : s.returns;
      return `extern fn ${s.name}(${params}) ${ret};`;
    })
    .join('\n');

  return `// Generated file. Do not edit.
const std = @import("std");
const user = @import(${JSON.stringify(entryFile)});
comptime {
    _ = user;
}

${externs}

const alloc = std.heap.c_allocator;
var last_result: ?[:0]u8 = null;

fn respond(comptime fmt: []const u8, args: anytype) [*:0]const u8 {
    if (last_result) |b| alloc.free(b);
    const s = std.fmt.allocPrintSentinel(alloc, fmt, args, 0) catch return "";
    last_result = s;
    return s.ptr;
}

fn argF64(v: std.json.Value) f64 {
    return switch (v) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        .number_string => |s| std.fmt.parseFloat(f64, s) catch 0,
        else => 0,
    };
}

export fn crossnative_call${suffix}(req: [*:0]const u8) [*:0]const u8 {
    const request = std.mem.span(req);
    var parsed = std.json.parseFromSlice(std.json.Value, alloc, request, .{}) catch
        return respond("{{\\"success\\":false,\\"error\\":\\"bad request JSON\\"}}", .{});
    defer parsed.deinit();
    const root = parsed.value;
    const func = (root.object.get("function") orelse
        return respond("{{\\"success\\":false,\\"error\\":\\"no function\\"}}", .{})).string;
    const args = (root.object.get("args") orelse
        return respond("{{\\"success\\":false,\\"error\\":\\"no args\\"}}", .{})).array;
    _ = &args;

${dispatch}

    return respond("{{\\"success\\":false,\\"error\\":\\"function not found\\"}}", .{});
}

export fn crossnative_manifest${suffix}() [*:0]const u8 {
    return respond("${manifestLiteral(sigs)}", .{});
}
`;
}

export interface NativeLibRequest {
  sourceDir: string;
  entryFile: string;
  target: string;
  symbol: string;
  outPath: string;
}

export interface NativeLibResult {
  ok: boolean;
  artifactPath?: string;
  error?: string;
}

function resolveZig(): string {
  return process.env.CROSSNATIVE_ZIG ?? 'zig';
}

export async function compileZigNativeLib(req: NativeLibRequest): Promise<NativeLibResult> {
  const source = await readFile(join(req.sourceDir, req.entryFile), 'utf8');
  const sigs = parseZigExports(source);
  if (sigs.length === 0) {
    return { ok: false, error: `no 'export fn' declarations found in ${req.entryFile}` };
  }

  let shim: string;
  try {
    shim = generateZigDispatch(req.entryFile, sigs, req.symbol);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const shimName = `cn_dispatch${req.symbol}.zig`;
  await writeFile(join(req.sourceDir, shimName), shim);

  const { code, stderr } = await run(
    [
      resolveZig(), 'build-lib', shimName,
      '-target', req.target,
      '-O', 'ReleaseFast',
      '-lc',
      `-femit-bin=${req.outPath}`,
    ],
    req.sourceDir
  );

  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `zig build-lib exited with ${code}` };
  }
  return { ok: true, artifactPath: req.outPath };
}
