/**
 * CrossNative CLI
 * 
 * Command-line tool for building and managing native modules.
 * 
 * @example
 * ```bash
 * # Initialize in React Native project
 * npx cross-native init
 * 
 * # Add a new module
 * npx cross-native add math --language rust
 * 
 * # Build all modules
 * npx cross-native build
 * 
 * # Watch mode
 * npx cross-native build --watch
 * 
 * # Run with hot reload
 * npx cross-native run --ios
 * ```
 */

export { initCommand } from './commands/init';
export { addCommand } from './commands/add';
export { buildCommand } from './commands/build';
export { runCommand } from './commands/run';
export { doctorCommand } from './commands/doctor';
export { generateCommand } from './commands/generate';

// Re-export utilities for programmatic use
export { detectLanguageToolchain } from './utils/toolchain';
export { loadConfig, saveConfig } from './utils/config';
export { compileRust, compileGo, compileCpp, detectLanguage } from './utils/compiler';
export { checkReactNativeProject, installDependencies } from './utils/project';
