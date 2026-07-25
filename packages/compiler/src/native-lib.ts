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

const C_TO_ZIG: Record<string, string> = {
  double: 'f64', float: 'f32',
  uint8_t: 'u8', uint16_t: 'u16', uint32_t: 'u32', uint64_t: 'u64',
  int8_t: 'i8', int16_t: 'i16', int32_t: 'i32', int64_t: 'i64',
  int: 'i32', unsigned: 'u32', 'unsigned int': 'u32',
  long: 'i64', 'unsigned long': 'u64', size_t: 'u64',
  char: 'i8', bool: 'bool', _Bool: 'bool', void: 'void',
};

function cType(t: string): string {
  const zig = C_TO_ZIG[t.trim().replace(/\s+/g, ' ')];
  if (!zig) throw new Error(`unsupported C type '${t.trim()}' on the linked path`);
  return zig;
}

// Parse functions marked __attribute__((export_name("..."))) — the same
// annotation the WASM build uses to decide exports — and their C signatures.
export function parseCExports(source: string): FnSig[] {
  const sigs: FnSig[] = [];
  const re = /export_name\("(\w+)"\)\s*\)\s*\)\s*([A-Za-z_][A-Za-z0-9_\s]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, , retType, name, paramList] = m;
    const params = paramList
      .split(',')
      .map(p => p.trim())
      .filter(p => p && p !== 'void')
      .map(p => {
        const parts = p.replace(/\*/g, ' ').split(/\s+/).filter(Boolean);
        const pname = parts.pop() as string;
        return { name: pname, type: cType(parts.join(' ')) };
      });
    sigs.push({ name, params, returns: cType(retType) });
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

// Generate the Zig dispatch shim. The exported functions are always called
// through `extern` declarations (they're C-ABI symbols). For Zig, importFile is
// the .zig source, imported to force its compilation; for C/C++ the source is
// passed to `zig build-lib` separately and importFile is omitted.
export function generateDispatch(sigs: FnSig[], suffix: string, importFile?: string): string {
  const dispatch = sigs
    .map(s => `    if (std.mem.eql(u8, func, "${s.name}")) ${encodeResult(s)}`)
    .join('\n');

  const externs = sigs
    .map(s => {
      const params = s.params.map(p => `${p.name}: ${p.type}`).join(', ');
      const ret = s.returns === 'void' ? 'void' : s.returns;
      return `extern fn ${s.name}(${params}) ${ret};`;
    })
    .join('\n');

  const importBlock = importFile
    ? `const user = @import(${JSON.stringify(importFile)});\ncomptime {\n    _ = user;\n}\n\n`
    : '';

  return `// Generated file. Do not edit.
const std = @import("std");
${importBlock}${externs}

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
  return build(req, 'zig');
}

export async function compileClangNativeLib(
  req: NativeLibRequest,
  lang: 'c' | 'cpp'
): Promise<NativeLibResult> {
  return build(req, lang);
}

async function build(req: NativeLibRequest, lang: 'zig' | 'c' | 'cpp'): Promise<NativeLibResult> {
  const source = await readFile(join(req.sourceDir, req.entryFile), 'utf8');
  const sigs = lang === 'zig' ? parseZigExports(source) : parseCExports(source);
  if (sigs.length === 0) {
    const what = lang === 'zig' ? "'export fn' declarations" : 'export_name-marked functions';
    return { ok: false, error: `no ${what} found in ${req.entryFile}` };
  }

  let shim: string;
  try {
    // Zig imports its source; C/C++ pass the source to build-lib as a sibling.
    shim = generateDispatch(sigs, req.symbol, lang === 'zig' ? req.entryFile : undefined);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const shimName = `cn_dispatch${req.symbol}.zig`;
  await writeFile(join(req.sourceDir, shimName), shim);

  const cmd = [resolveZig(), 'build-lib', shimName];
  if (lang !== 'zig') cmd.push(req.entryFile); // compile + link the C/C++ source
  cmd.push('-target', req.target, '-O', 'ReleaseFast', lang === 'cpp' ? '-lc++' : '-lc');

  // Compiling C/C++ for an Apple target needs that SDK's headers (<math.h> etc.).
  // Zig source is freestanding and doesn't.
  if (lang !== 'zig' && req.target.includes('ios')) {
    const sdk = req.target.includes('simulator') ? 'iphonesimulator' : 'iphoneos';
    const { code, stdout } = await run(['xcrun', '--sdk', sdk, '--show-sdk-path']);
    if (code === 0 && stdout.trim()) cmd.push('--sysroot', stdout.trim());
  }
  cmd.push(`-femit-bin=${req.outPath}`);

  const { code, stderr } = await run(cmd, req.sourceDir);
  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `zig build-lib exited with ${code}` };
  }
  return { ok: true, artifactPath: req.outPath };
}
