import fs from 'fs-extra';
import path from 'path';

const CONFIG_FILES = [
  '.cross-native/config.json',
  'cross-native.config.js',
  'cross-native.config.json',
];

interface CrossNativeConfig {
  /** Default language for new modules */
  language?: string;
  /** Directory containing native source files */
  modulesDir?: string;
  /** Directory for compiled output */
  outputDir?: string;
  /** Build configuration */
  build?: {
    /** Optimization level: 0-3 */
    optLevel?: number;
    /** Target: wasm, native, all */
    target?: string;
    /** Enable debug info */
    debug?: boolean;
  };
  /** Plugin configuration */
  plugins?: string[];
}

export async function loadConfig(cwd?: string): Promise<CrossNativeConfig> {
  const projectPath = cwd || process.cwd();
  
  for (const configFile of CONFIG_FILES) {
    const configPath = path.join(projectPath, configFile);
    
    if (await fs.pathExists(configPath)) {
      if (configFile.endsWith('.js')) {
        return require(configPath);
      } else {
        return await fs.readJson(configPath);
      }
    }
  }
  
  // Return defaults
  return {
    language: 'rust',
    modulesDir: './native',
    outputDir: './lib/native',
    build: {
      optLevel: 2,
      target: 'all',
      debug: false,
    },
  };
}

export async function saveConfig(
  projectPath: string,
  config: CrossNativeConfig
): Promise<void> {
  const configPath = path.join(projectPath, '.cross-native', 'config.json');
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, config, { spaces: 2 });
}
