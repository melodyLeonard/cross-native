import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';

interface AddOptions {
  language: string;
  path: string;
  template: string;
}

export async function addCommand(name: string, options: AddOptions): Promise<void> {
  console.log(chalk.bold(`\n➕ Adding ${name} module\n`));
  
  const nativeDir = path.resolve(options.path);
  await fs.ensureDir(nativeDir);
  
  const modulePath = path.join(nativeDir, `${name}.${getExtension(options.language)}`);
  
  // Check if module already exists
  if (await fs.pathExists(modulePath)) {
    console.log(chalk.yellow(`Module ${name} already exists at ${modulePath}`));
    return;
  }
  
  // Generate module from template
  const template = getTemplate(name, options.language, options.template);
  
  await fs.writeFile(modulePath, template);
  
  console.log(chalk.green(`✅ Created ${name} module`));
  console.log(chalk.gray(`   ${modulePath}`));
  
  // Generate TypeScript bindings
  console.log(chalk.gray('\nGenerate bindings:'));
  console.log(chalk.white(`  npx cross-native generate`));
  
  // Build
  console.log(chalk.gray('\nBuild module:'));
  console.log(chalk.white(`  npx cross-native build`));
  
  console.log();
}

function getExtension(language: string): string {
  switch (language) {
    case 'rust': return 'rs';
    case 'go': return 'go';
    case 'cpp': return 'cpp';
    case 'c': return 'c';
    case 'zig': return 'zig';
    default: return 'rs';
  }
}

function getTemplate(name: string, language: string, template: string): string {
  switch (language) {
    case 'rust':
      return `// ${name}.rs — CrossNative module\n\n/// Add two numbers\n#[no_mangle]\npub extern "C" fn ${name}_add(a: f64, b: f64) -> f64 {\n    a + b\n}\n\n/// Multiply two numbers\n#[no_mangle]\npub extern "C" fn ${name}_multiply(a: f64, b: f64) -> f64 {\n    a * b\n}\n\n/// Your custom function here\n#[no_mangle]\npub extern "C" fn ${name}_compute(input: f64) -> f64 {\n    // TODO: Implement your computation\n    input * 2.0\n}\n`;

    case 'go':
      return `package ${name}\n\n//export Add\nfunc Add(a, b float64) float64 {\n    return a + b\n}\n\n//export Multiply\nfunc Multiply(a, b float64) float64 {\n    return a * b\n}\n\n//export Compute\nfunc Compute(input float64) float64 {\n    return input * 2.0\n}\n\nfunc main() {}\n`;

    case 'cpp':
      return `#include <math>\n\nextern "C" {\n    double ${name}_add(double a, double b) {\n        return a + b;\n    }\n\n    double ${name}_multiply(double a, double b) {\n        return a * b;\n    }\n\n    double ${name}_compute(double input) {\n        return input * 2.0;\n    }\n}\n`;

    default:
      return `// ${name} module\n// TODO: Implement ${language} module\n`;
  }
}
