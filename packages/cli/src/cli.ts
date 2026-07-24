import { program } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { addCommand } from './commands/add';
import { buildCommand } from './commands/build';
import { runCommand } from './commands/run';
import { doctorCommand } from './commands/doctor';
import { generateCommand } from './commands/generate';

const packageJson = require('../package.json');

program
  .name('cross-native')
  .description('CLI for CrossNative — run any language in React Native')
  .version(packageJson.version, '-v, --version', 'Display version number')
  .option('-d, --debug', 'Enable debug logging', false)
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().debug) {
      process.env.DEBUG = 'cross-native:*';
    }
  });

// init — Initialize CrossNative in a React Native project
program
  .command('init')
  .description('Initialize CrossNative in your React Native project')
  .option('-p, --path <path>', 'Project path', '.')
  .option('-l, --language <lang>', 'Default language (rust, go, cpp)', 'rust')
  .option('--skip-install', 'Skip npm install', false)
  .option('--template <template>', 'Project template', 'default')
  .action(async (options) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error(chalk.red('✖ Init failed:'), error);
      process.exit(1);
    }
  });

// add — Add a new native module
program
  .command('add <name>')
  .description('Add a new native module')
  .option('-l, --language <lang>', 'Module language', 'rust')
  .option('-p, --path <path>', 'Module path', './native')
  .option('--template <template>', 'Module template', 'default')
  .action(async (name, options) => {
    try {
      await addCommand(name, options);
    } catch (error) {
      console.error(chalk.red('✖ Add failed:'), error);
      process.exit(1);
    }
  });

// build — Compile native modules
program
  .command('build')
  .description('Compile native modules to WASM/native libraries')
  .option('-w, --watch', 'Watch for changes and rebuild', false)
  .option('--release', 'Release build (optimized)', false)
  .option('--target <target>', 'Build target (wasm, native, all)', 'all')
  .option('--language <lang>', 'Build specific language only')
  .action(async (options) => {
    try {
      await buildCommand(options);
    } catch (error) {
      console.error(chalk.red('✖ Build failed:'), error);
      process.exit(1);
    }
  });

// run — Development mode with hot reload
program
  .command('run')
  .description('Start development mode with hot reload')
  .option('-p, --port <port>', 'Metro bundler port', '8081')
  .option('--ios', 'Run on iOS simulator', false)
  .option('--android', 'Run on Android emulator', false)
  .option('--device <device>', 'Specific device ID')
  .action(async (options) => {
    try {
      await runCommand(options);
    } catch (error) {
      console.error(chalk.red('✖ Run failed:'), error);
      process.exit(1);
    }
  });

// doctor — Check environment
program
  .command('doctor')
  .description('Check development environment and dependencies')
  .action(async () => {
    try {
      await doctorCommand();
    } catch (error) {
      console.error(chalk.red('✖ Doctor failed:'), error);
      process.exit(1);
    }
  });

// generate — Generate TypeScript bindings
program
  .command('generate')
  .alias('gen')
  .description('Generate TypeScript bindings from native source')
  .option('-w, --watch', 'Watch for changes', false)
  .action(async (options) => {
    try {
      await generateCommand(options);
    } catch (error) {
      console.error(chalk.red('✖ Generate failed:'), error);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
