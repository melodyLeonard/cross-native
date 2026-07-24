import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import chokidar from 'chokidar';
import fg from 'fast-glob';
import { loadConfig } from '../utils/config';
import { detectLanguage, compileRust, compileGo, compileCpp } from '../utils/compiler';

interface BuildOptions {
  watch: boolean;
  release: boolean;
  target: string;
  language?: string;
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  console.log(chalk.bold('\n🔨 Building CrossNative modules\n'));
  
  const config = await loadConfig();
  const nativeDir = path.resolve(config.modulesDir || './native');
  const outputDir = path.resolve(config.outputDir || './lib/native');
  
  // Ensure output directory exists
  await fs.ensureDir(outputDir);
  
  // Find all native source files
  const spinner = ora('Finding native modules...').start();
  
  const sourceFiles = await findSourceFiles(nativeDir, options.language);
  
  if (sourceFiles.length === 0) {
    spinner.warn('No native modules found');
    console.log(chalk.yellow(`Create modules in ${config.modulesDir}/`));
    console.log(chalk.gray(`Example: npx cross-native add math`));
    return;
  }
  
  spinner.succeed(`Found ${sourceFiles.length} module(s)`);
  
  // Build each module
  const results: { file: string; success: boolean; error?: string }[] = [];
  
  for (const file of sourceFiles) {
    const buildSpinner = ora(`Building ${path.basename(file)}...`).start();
    
    try {
      const language = detectLanguage(file);
      const result = await buildModule(file, {
        outputDir,
        release: options.release,
        target: options.target,
      });
      
      if (result.success) {
        buildSpinner.succeed(`Built ${path.basename(file)}`);
      } else {
        buildSpinner.fail(`Failed to build ${path.basename(file)}`);
        console.error(chalk.red(result.error));
      }
      
      results.push(result);
    } catch (error) {
      buildSpinner.fail(`Error building ${path.basename(file)}`);
      results.push({ file, success: false, error: String(error) });
    }
  }
  
  // Summary
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log(chalk.bold('\n📊 Build Summary\n'));
  console.log(chalk.green(`  ✅ ${successCount} succeeded`));
  if (failCount > 0) {
    console.log(chalk.red(`  ❌ ${failCount} failed`));
  }
  
  // Watch mode
  if (options.watch) {
    console.log(chalk.cyan('\n👀 Watching for changes... (Ctrl+C to stop)\n'));
    
    const watcher = chokidar.watch(`${nativeDir}/**/*.{rs,go,cpp,c,zig}`, {
      ignored: /node_modules/,
      persistent: true,
    });
    
    watcher.on('change', async (filePath) => {
      console.log(chalk.gray(`\n  Changed: ${path.relative(process.cwd(), filePath)}`));
      
      const watchSpinner = ora('Rebuilding...').start();
      
      try {
        const result = await buildModule(filePath, {
          outputDir,
          release: options.release,
          target: options.target,
        });
        
        if (result.success) {
          watchSpinner.succeed('Rebuild complete');
        } else {
          watchSpinner.fail('Rebuild failed');
          console.error(chalk.red(result.error));
        }
      } catch (error) {
        watchSpinner.fail('Rebuild error');
        console.error(chalk.red(error));
      }
    });
    
    // Keep process alive
    await new Promise(() => {});
  }
  
  if (failCount > 0) {
    process.exit(1);
  }
}

async function findSourceFiles(nativeDir: string, languageFilter?: string): Promise<string[]> {
  const patterns = ['**/*.rs', '**/*.go', '**/*.cpp', '**/*.c', '**/*.zig'];
  
  if (languageFilter) {
    const ext = languageToExtension(languageFilter);
    patterns.length = 0;
    patterns.push(`**/*.${ext}`);
  }
  
  const files = await fg(patterns, {
    cwd: nativeDir,
    absolute: true,
  });
  
  return files;
}

function languageToExtension(language: string): string {
  switch (language) {
    case 'rust': return 'rs';
    case 'go': return 'go';
    case 'cpp': return 'cpp';
    case 'c': return 'c';
    case 'zig': return 'zig';
    default: return 'rs';
  }
}

interface BuildResult {
  file: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}

interface BuildConfig {
  outputDir: string;
  release: boolean;
  target: string;
}

async function buildModule(file: string, config: BuildConfig): Promise<BuildResult> {
  const language = detectLanguage(file);
  
  try {
    switch (language) {
      case 'rust':
        return await compileRust(file, config);
      case 'go':
        return await compileGo(file, config);
      case 'cpp':
        return await compileCpp(file, config);
      default:
        return {
          file,
          success: false,
          error: `Unsupported language: ${language}`,
        };
    }
  } catch (error) {
    return {
      file,
      success: false,
      error: String(error),
    };
  }
}
