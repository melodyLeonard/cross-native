import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import chokidar from 'chokidar';
import fg from 'fast-glob';
import { loadConfig } from '../utils/config';
import { detectLanguage } from '../utils/compiler';

interface GenerateOptions {
  watch: boolean;
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  console.log(chalk.bold('\n📝 Generating TypeScript bindings\n'));
  
  const config = await loadConfig();
  const nativeDir = path.resolve(config.modulesDir || './native');
  const outputDir = path.resolve(config.outputDir || './lib/native');
  
  await fs.ensureDir(outputDir);
  
  // Find all source files
  const spinner = ora('Scanning native modules...').start();
  
  const sourceFiles = await fg(['**/*.{rs,go,cpp,c,zig}'], {
    cwd: nativeDir,
    absolute: true,
  });
  
  if (sourceFiles.length === 0) {
    spinner.warn('No native modules found');
    return;
  }
  
  spinner.succeed(`Found ${sourceFiles.length} module(s)`);
  
  // Generate bindings for each module
  for (const file of sourceFiles) {
    const genSpinner = ora(`Generating bindings for ${path.basename(file)}...`).start();
    
    try {
      await generateBindings(file, outputDir);
      genSpinner.succeed(`Generated ${path.basename(file, path.extname(file))}.d.ts`);
    } catch (error) {
      genSpinner.fail(`Failed to generate bindings for ${path.basename(file)}`);
      console.error(chalk.red(error));
    }
  }
  
  // Generate index file
  await generateIndex(outputDir);
  
  console.log(chalk.green('\n✅ TypeScript bindings generated!\n'));
  console.log(chalk.gray('Import modules from:'));
  console.log(chalk.white(`  import { MyModule } from './lib/native';`));
  console.log();
  
  // Watch mode
  if (options.watch) {
    console.log(chalk.cyan('👀 Watching for changes... (Ctrl+C to stop)\n'));
    
    const watcher = chokidar.watch(`${nativeDir}/**/*.{rs,go,cpp,c,zig}`, {
      persistent: true,
    });
    
    watcher.on('change', async (filePath) => {
      console.log(chalk.gray(`\n  Changed: ${path.relative(process.cwd(), filePath)}`));
      
      try {
        await generateBindings(filePath, outputDir);
        console.log(chalk.green(`  ✓ Regenerated bindings`));
      } catch (error) {
        console.error(chalk.red(`  ✗ Failed: ${error}`));
      }
    });
    
    await new Promise(() => {});
  }
}

async function generateBindings(sourceFile: string, outputDir: string): Promise<void> {
  const language = detectLanguage(sourceFile);
  const moduleName = path.basename(sourceFile, path.extname(sourceFile));
  const outputFile = path.join(outputDir, `${moduleName}.d.ts`);
  
  let bindings: string;
  
  switch (language) {
    case 'rust':
      bindings = generateRustBindings(sourceFile, moduleName);
      break;
    case 'go':
      bindings = generateGoBindings(sourceFile, moduleName);
      break;
    case 'cpp':
      bindings = generateCppBindings(sourceFile, moduleName);
      break;
    default:
      bindings = generateGenericBindings(moduleName);
  }
  
  await fs.writeFile(outputFile, bindings);
}

function generateRustBindings(sourceFile: string, moduleName: string): string {
  // Simple parser: extract #[no_mangle] pub extern "C" fn declarations
  const content = fs.readFileSync(sourceFile, 'utf8');
  const functions: { name: string; params: string[]; returnType: string }[] = [];
  
  const fnRegex = /#\[no_mangle\]\s*pub\s+extern\s+"C"\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?/g;
  let match;
  
  while ((match = fnRegex.exec(content)) !== null) {
    functions.push({
      name: match[1],
      params: match[2] ? match[2].split(',').map(p => p.trim()) : [],
      returnType: match[3] || 'void',
    });
  }
  
  let output = `// Auto-generated TypeScript bindings for ${moduleName}\n// Source: ${sourceFile}\n// Do not edit manually\n\n`;
  
  output += `export interface ${toPascalCase(moduleName)}Module {\n`;
  
  for (const fn of functions) {
    const tsParams = fn.params.map(p => {
      const [name, type] = p.split(':').map(s => s.trim());
      return `${name}: ${rustTypeToTs(type)}`;
    }).join(', ');
    
    const tsReturn = fn.returnType === 'void' ? 'void' : rustTypeToTs(fn.returnType);
    
    output += `  ${toCamelCase(fn.name)}(${tsParams}): Promise<${tsReturn}>;\n`;
  }
  
  output += `}\n`;
  
  return output;
}

function generateGoBindings(sourceFile: string, moduleName: string): string {
  return `// Auto-generated TypeScript bindings for ${moduleName}\n// Source: ${sourceFile}\n\nexport interface ${toPascalCase(moduleName)}Module {\n  // TODO: Parse Go exports\n  add(a: number, b: number): Promise<number>;\n  multiply(a: number, b: number): Promise<number>;\n}\n`;
}

function generateCppBindings(sourceFile: string, moduleName: string): string {
  return `// Auto-generated TypeScript bindings for ${moduleName}\n// Source: ${sourceFile}\n\nexport interface ${toPascalCase(moduleName)}Module {\n  // TODO: Parse C++ exports\n  add(a: number, b: number): Promise<number>;\n  multiply(a: number, b: number): Promise<number>;\n}\n`;
}

function generateGenericBindings(moduleName: string): string {
  return `// Auto-generated TypeScript bindings for ${moduleName}\n\nexport interface ${toPascalCase(moduleName)}Module {\n  [functionName: string]: (...args: any[]) => Promise<any>;\n}\n`;
}

function generateIndex(outputDir: string): Promise<void> {
  // Collect all .d.ts files
  // For now, just create a basic index
  const content = `// Auto-generated index for native modules\n\n`;
  return fs.writeFile(path.join(outputDir, 'index.d.ts'), content);
}

function rustTypeToTs(rustType: string): string {
  switch (rustType) {
    case 'f64':
    case 'f32':
    case 'i32':
    case 'i64':
    case 'u32':
    case 'u64':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'String':
    case '&str':
      return 'string';
    case 'void':
      return 'void';
    default:
      return 'any';
  }
}

function toPascalCase(str: string): string {
  return str.replace(/(^
_)([a-z])/g, (match, separator, letter) => letter.toUpperCase());
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}
