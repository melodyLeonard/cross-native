import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.rs': return 'rust';
    case '.go': return 'go';
    case '.cpp':
    case '.cxx':
    case '.cc': return 'cpp';
    case '.c': return 'c';
    case '.zig': return 'zig';
    default: return 'unknown';
  }
}

interface CompileOptions {
  outputDir: string;
  release: boolean;
  target: string;
}

export async function compileRust(
  file: string,
  options: CompileOptions
): Promise<{ file: string; success: boolean; outputPath?: string; error?: string }> {
  const filename = path.basename(file, '.rs');
  const outputPath = path.join(options.outputDir, `${filename}.wasm`);
  
  try {
    // Check if wasm-pack is available
    try {
      await execa('wasm-pack', ['--version']);
    } catch {
      // Fallback to rustc
      await execa('rustc', [
        '--target', 'wasm32-unknown-unknown',
        '--crate-type=cdylib',
        options.release ? '-O' : '-g',
        file,
        '-o', outputPath,
      ]);
      
      return { file, success: true, outputPath };
    }
    
    // Use wasm-pack for better DX
    const pkgDir = path.join(options.outputDir, filename);
    await fs.ensureDir(pkgDir);
    
    await execa('wasm-pack', [
      'build',
      '--target', 'web',
      options.release ? '--release' : '--dev',
      '--out-dir', pkgDir,
      path.dirname(file),
    ]);
    
    return { file, success: true, outputPath: pkgDir };
    
  } catch (error: any) {
    return {
      file,
      success: false,
      error: `Rust compilation failed: ${error.message}`,
    };
  }
}

export async function compileGo(
  file: string,
  options: CompileOptions
): Promise<{ file: string; success: boolean; outputPath?: string; error?: string }> {
  const filename = path.basename(file, '.go');
  const outputPath = path.join(options.outputDir, `${filename}.wasm`);
  
  try {
    // Use TinyGo for WASM compilation
    await execa('tinygo', [
      'build',
      '-target', 'wasm',
      options.release ? '-opt=2' : '-opt=0',
      '-o', outputPath,
      file,
    ]);
    
    return { file, success: true, outputPath };
    
  } catch (error: any) {
    // Fallback to standard Go (larger binary)
    try {
      await execa('go', [
        'build',
        '-o', outputPath,
        file,
      ]);
      
      return { file, success: true, outputPath };
    } catch (fallbackError: any) {
      return {
        file,
        success: false,
        error: `Go compilation failed: ${error.message}. TinyGo not found? Install: https://tinygo.org/getting-started/`,
      };
    }
  }
}

export async function compileCpp(
  file: string,
  options: CompileOptions
): Promise<{ file: string; success: boolean; outputPath?: string; error?: string }> {
  const filename = path.basename(file, path.extname(file));
  
  // Platform-specific extension
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const libExt = isWindows ? '.dll' : isMac ? '.dylib' : '.so';
  const outputPath = path.join(options.outputDir, `lib${filename}${libExt}`);
  
  try {
    if (isMac || isWindows) {
      // Use clang
      await execa('clang++', [
        '-shared',
        '-fPIC',
        options.release ? '-O3' : '-O0 -g',
        '-std=c++20',
        file,
        '-o', outputPath,
      ]);
    } else {
      // Use g++
      await execa('g++', [
        '-shared',
        '-fPIC',
        options.release ? '-O3' : '-O0 -g',
        '-std=c++20',
        file,
        '-o', outputPath,
      ]);
    }
    
    return { file, success: true, outputPath };
    
  } catch (error: any) {
    return {
      file,
      success: false,
      error: `C++ compilation failed: ${error.message}`,
    };
  }
}
