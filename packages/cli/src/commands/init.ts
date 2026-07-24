import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { checkReactNativeProject, installDependencies, createConfig } from '../utils/project';
import { detectLanguageToolchain } from '../utils/toolchain';

interface InitOptions {
  path: string;
  language: string;
  skipInstall: boolean;
  template: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.bold('\n🚀 Initializing CrossNative\n'));
  
  const projectPath = path.resolve(options.path);
  
  // Check if this is a React Native project
  const spinner = ora('Checking project structure...').start();
  
  try {
    const isRN = await checkReactNativeProject(projectPath);
    if (!isRN) {
      spinner.fail('Not a React Native project');
      console.log(chalk.yellow('Please run this in a React Native project directory.'));
      console.log(chalk.gray('Create one with: npx react-native init MyApp'));
      return;
    }
    spinner.succeed('React Native project detected');
  } catch (error) {
    spinner.fail('Failed to check project');
    throw error;
  }
  
  // Interactive prompts
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'language',
      message: 'Which language will you primarily use?',
      choices: [
        { name: 'Rust (Recommended)', value: 'rust' },
        { name: 'Go', value: 'go' },
        { name: 'C++', value: 'cpp' },
        { name: 'Zig', value: 'zig' },
      ],
      default: options.language,
    },
    {
      type: 'confirm',
      name: 'installDeps',
      message: 'Install dependencies now?',
      default: !options.skipInstall,
    },
    {
      type: 'confirm',
      name: 'createExample',
      message: 'Create example native module?',
      default: true,
    },
  ]);
  
  // Create project structure
  const structureSpinner = ora('Creating project structure...').start();
  
  try {
    await createProjectStructure(projectPath, answers.language);
    structureSpinner.succeed('Project structure created');
  } catch (error) {
    structureSpinner.fail('Failed to create structure');
    throw error;
  }
  
  // Check toolchain
  const toolchainSpinner = ora('Checking language toolchain...').start();
  
  try {
    const toolchain = await detectLanguageToolchain(answers.language);
    if (toolchain.installed) {
      toolchainSpinner.succeed(`${answers.language} toolchain found: ${toolchain.version}`);
    } else {
      toolchainSpinner.warn(`${answers.language} not found`);
      console.log(chalk.yellow(`Install ${answers.language}:`));
      console.log(chalk.gray(toolchain.installInstructions));
    }
  } catch (error) {
    toolchainSpinner.fail('Failed to check toolchain');
  }
  
  // Install dependencies
  if (answers.installDeps && !options.skipInstall) {
    const installSpinner = ora('Installing dependencies...').start();
    
    try {
      await installDependencies(projectPath);
      installSpinner.succeed('Dependencies installed');
    } catch (error) {
      installSpinner.fail('Failed to install dependencies');
      console.log(chalk.yellow('Install manually: npm install react-native-cross-native react-native-nitro-modules'));
    }
  }
  
  // Create example module
  if (answers.createExample) {
    const exampleSpinner = ora('Creating example module...').start();
    
    try {
      await createExampleModule(projectPath, answers.language);
      exampleSpinner.succeed('Example module created');
    } catch (error) {
      exampleSpinner.fail('Failed to create example');
    }
  }
  
  // Create config
  await createConfig(projectPath, {
    language: answers.language,
    modulesDir: './native',
    outputDir: './lib/native',
  });
  
  // Update package.json scripts
  await updatePackageScripts(projectPath);
  
  // Final message
  console.log(chalk.bold('\n✅ CrossNative initialized!\n'));
  console.log(chalk.gray('Next steps:'));
  console.log(chalk.white('  1. ') + chalk.cyan('cd native && code .'));
  console.log(chalk.white('  2. ') + chalk.cyan('npx cross-native build'));
  console.log(chalk.white('  3. ') + chalk.cyan('npx cross-native run'));
  console.log();
}

async function createProjectStructure(projectPath: string, language: string): Promise<void> {
  const dirs = [
    'native',
    'lib/native',
    '.cross-native',
  ];
  
  for (const dir of dirs) {
    await fs.ensureDir(path.join(projectPath, dir));
  }
  
  // Create .gitignore additions
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (await fs.pathExists(gitignorePath)) {
    const content = await fs.readFile(gitignorePath, 'utf8');
    if (!content.includes('# CrossNative')) {
      await fs.appendFile(gitignorePath, '\n# CrossNative\nlib/native/\n.cross-native/cache/\n*.wasm\n');
    }
  }
}

async function createExampleModule(projectPath: string, language: string): Promise<void> {
  const nativeDir = path.join(projectPath, 'native');
  
  switch (language) {
    case 'rust':
      await fs.writeFile(
        path.join(nativeDir, 'compute.rs'),
        `// Example Rust module for CrossNative\n\n#[no_mangle]\npub extern "C" fn add(a: f64, b: f64) -> f64 {\n    a + b\n}\n\n#[no_mangle]\npub extern "C" fn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\n`
      );
      break;
      
    case 'go':
      await fs.writeFile(
        path.join(nativeDir, 'compute.go'),
        `package main\n\n//export Add\nfunc Add(a, b float64) float64 {\n    return a + b\n}\n\nfunc main() {}\n`
      );
      break;
      
    case 'cpp':
      await fs.writeFile(
        path.join(nativeDir, 'compute.cpp'),
        `#include <string>\n\nextern "C" {\n    double add(double a, double b) {\n        return a + b;\n    }\n}\n`
      );
      break;
  }
}

async function updatePackageScripts(projectPath: string): Promise<void> {
  const packagePath = path.join(projectPath, 'package.json');
  const pkg = await fs.readJson(packagePath);
  
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['native:build'] = 'cross-native build';
  pkg.scripts['native:run'] = 'cross-native run';
  pkg.scripts['native:watch'] = 'cross-native build --watch';
  
  await fs.writeJson(packagePath, pkg, { spaces: 2 });
}
