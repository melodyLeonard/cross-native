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
  /** The C symbol to call, if it differs from `name` (Go's cgo exports are
   *  prefixed because //export can't reuse the Go function's name). */
  cName?: string;
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

const GO_TO_ZIG: Record<string, string> = {
  float64: 'f64', float32: 'f32',
  int8: 'i8', int16: 'i16', int32: 'i32', int64: 'i64', int: 'i64',
  uint8: 'u8', uint16: 'u16', uint32: 'u32', uint64: 'u64', uint: 'u64', byte: 'u8',
  bool: 'bool',
};

function goType(t: string): string {
  const zig = GO_TO_ZIG[t.trim()];
  if (!zig) throw new Error(`unsupported Go type '${t.trim()}' on the linked path`);
  return zig;
}

// Parse //go:wasmexport-marked functions and their signatures. The C symbol is
// prefixed with cn_ because the generated cgo wrapper can't reuse the Go name.
export function parseGoExports(source: string): FnSig[] {
  const sigs: FnSig[] = [];
  const re = /\/\/go:wasmexport\s+(\w+)\s*\n\s*func\s+\w+\s*\(([^)]*)\)\s*([A-Za-z_]\w*)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, name, paramList, ret] = m;
    const params = paramList
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const parts = p.split(/\s+/);
        return { name: parts[0], type: goType(parts[1]) };
      });
    sigs.push({ name, params, returns: ret ? goType(ret) : 'void', cName: `cn_${name}` });
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
  const call = `${sig.cName ?? sig.name}(${sig.params.map((p, i) => readArg(p.type, i)).join(', ')})`;
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
      return `extern fn ${s.cName ?? s.name}(${params}) ${ret};`;
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

function resolveGo(): string {
  return process.env.CROSSNATIVE_GO ?? 'go';
}

// Go's native path: build a c-archive (the whole Go runtime) exporting cn_<name>
// wrappers, then archive it with the Zig dispatch shim. Apple targets only.
export async function compileGoNativeLib(req: NativeLibRequest): Promise<NativeLibResult> {
  if (!req.target.includes('ios')) {
    return { ok: false, error: 'Go native lib is only supported for Apple targets' };
  }
  const { mkdtemp, cp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');

  const source = await readFile(join(req.sourceDir, req.entryFile), 'utf8');
  const sigs = parseGoExports(source);
  if (sigs.length === 0) {
    return { ok: false, error: `no //go:wasmexport functions found in ${req.entryFile}` };
  }

  // Build in a temp module: the user source with //go:wasmexport stripped (it is
  // wasm-only), plus a cgo wrapper that re-exports each function as cn_<name>.
  const dir = await mkdtemp(join(tmpdir(), 'cn-go-'));
  const stripped = source.replace(/^[ \t]*\/\/go:wasmexport.*\n/gm, '');
  await writeFile(join(dir, 'main.go'), stripped);
  const wrappers = sigs
    .map(s => {
      const params = s.params.map(p => `${p.name} ${goName(p.type)}`).join(', ');
      const args = s.params.map(p => p.name).join(', ');
      const ret = s.returns === 'void' ? '' : goName(s.returns);
      const body = s.returns === 'void' ? `${s.name}(${args})` : `return ${s.name}(${args})`;
      return `//export ${s.cName}\nfunc ${s.cName}(${params}) ${ret} { ${body} }`;
    })
    .join('\n');
  await writeFile(join(dir, 'cn_cgo.go'), `package main\n\nimport "C"\n\n${wrappers}\n`);
  await writeFile(join(dir, 'go.mod'), 'module cnpi\n\ngo 1.24\n');

  const sdk = req.target.includes('simulator') ? 'iphonesimulator' : 'iphoneos';
  const minFlag = sdk === 'iphonesimulator'
    ? '-mios-simulator-version-min=15.0'
    : '-miphoneos-version-min=15.0';
  const sdkPath = (await run(['xcrun', '--sdk', sdk, '--show-sdk-path'])).stdout.trim();
  const clang = (await run(['xcrun', '--sdk', sdk, '-f', 'clang'])).stdout.trim();
  const ccFlags = `${clang} -isysroot ${sdkPath} ${minFlag} -arch arm64`;

  const goArchive = join(dir, 'libgo_raw.a');
  const r = await run(
    [resolveGo(), 'build', '-buildmode=c-archive', '-o', goArchive, '.'],
    dir,
    { CGO_ENABLED: '1', GOOS: 'ios', GOARCH: 'arm64', CC: ccFlags, CGO_CFLAGS: `-isysroot ${sdkPath} ${minFlag} -arch arm64` }
  );
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'go c-archive failed' };

  // Dispatch shim: extern cn_<name>, called via the FnSig.cName the parser set.
  const shim = generateDispatch(sigs, req.symbol);
  const shimName = `cn_dispatch${req.symbol}.zig`;
  await writeFile(join(dir, shimName), shim);
  const shimObj = join(dir, `cn_shim${req.symbol}.o`);
  const sr = await run(
    [resolveZig(), 'build-obj', shimName, '-target', req.target, '-O', 'ReleaseFast', `-femit-bin=${shimObj}`],
    dir
  );
  if (sr.code !== 0) return { ok: false, error: sr.stderr.trim() || 'shim build failed' };

  // Combine the Go archive and the shim into the output library.
  const lr = await run(['xcrun', 'libtool', '-static', goArchive, shimObj, '-o', req.outPath], dir);
  if (lr.code !== 0) return { ok: false, error: lr.stderr.trim() || 'libtool failed' };
  await cp(join(dir, shimName), join(req.sourceDir, shimName)).catch(() => {});
  return { ok: true, artifactPath: req.outPath };
}

// Zig type back to a Go type, for the generated cgo wrapper signatures.
function goName(zig: string): string {
  for (const [go, z] of Object.entries(GO_TO_ZIG)) if (z === zig && go !== 'int' && go !== 'uint' && go !== 'byte') return go;
  return zig;
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
  const zig = resolveZig();

  // Apple targets: build objects and archive so that only the crossnative_call
  // entry symbols are exported. Several languages get force-loaded into one app,
  // and their plain C exports (add, estimate_pi, …) would otherwise collide.
  if (req.target.includes('ios')) {
    return buildAppleLinked(req, lang, shimName, zig);
  }

  // Zig, or C/C++ on the host: a single zig build-lib links everything.
  const cmd = [zig, 'build-lib', shimName];
  if (lang !== 'zig') cmd.push(req.entryFile);
  cmd.push('-target', req.target, '-O', 'ReleaseFast', lang === 'cpp' ? '-lc++' : '-lc');
  cmd.push(`-femit-bin=${req.outPath}`);

  const { code, stderr } = await run(cmd, req.sourceDir);
  if (code !== 0) {
    return { ok: false, error: stderr.trim() || `zig build-lib exited with ${code}` };
  }
  return { ok: true, artifactPath: req.outPath };
}

async function buildAppleLinked(
  req: NativeLibRequest,
  lang: 'zig' | 'c' | 'cpp',
  shimName: string,
  zig: string
): Promise<NativeLibResult> {
  const objs: string[] = [];
  const sdk = req.target.includes('simulator') ? 'iphonesimulator' : 'iphoneos';

  if (lang === 'zig') {
    // The shim @imports the .zig source, so one build-obj compiles both.
    const obj = join(req.sourceDir, `cn${req.symbol}.o`);
    const r = await run(
      [zig, 'build-obj', shimName, '-target', req.target, '-O', 'ReleaseFast', `-femit-bin=${obj}`],
      req.sourceDir
    );
    if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'zig build-obj failed' };
    objs.push(obj);
  } else {
    // Zig shim object + the C/C++ source compiled by Xcode clang (which finds
    // the iOS SDK headers). export_name is a wasm attribute clang ignores, so
    // silence that warning.
    const shimObj = join(req.sourceDir, `cn_shim${req.symbol}.o`);
    let r = await run(
      [zig, 'build-obj', shimName, '-target', req.target, '-O', 'ReleaseFast', `-femit-bin=${shimObj}`],
      req.sourceDir
    );
    if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'shim build failed' };

    const srcObj = join(req.sourceDir, `cn_src${req.symbol}.o`);
    const cc = lang === 'cpp' ? 'clang++' : 'clang';
    const extra = lang === 'cpp' ? ['-std=gnu++17', '-fno-exceptions', '-fno-rtti'] : [];
    r = await run(
      ['xcrun', '--sdk', sdk, cc, '-arch', 'arm64', '-O3', '-Wno-ignored-attributes',
       ...extra, '-c', req.entryFile, '-o', srcObj],
      req.sourceDir
    );
    if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'clang compile failed' };
    objs.push(shimObj, srcObj);
  }

  // Partial-link into one object, exporting only the two entry symbols; every
  // other global (the user's functions) becomes local, so libraries for
  // different languages can coexist in one app.
  const combined = join(req.sourceDir, `cn_combined${req.symbol}.o`);
  let r = await run(
    ['xcrun', 'ld', '-r',
     '-exported_symbol', `_crossnative_call${req.symbol}`,
     '-exported_symbol', `_crossnative_manifest${req.symbol}`,
     ...objs, '-o', combined],
    req.sourceDir
  );
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'partial link failed' };

  r = await run(['xcrun', 'libtool', '-static', combined, '-o', req.outPath], req.sourceDir);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'libtool failed' };
  return { ok: true, artifactPath: req.outPath };
}
