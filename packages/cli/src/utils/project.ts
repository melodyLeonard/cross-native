import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';

export async function checkReactNativeProject(projectPath: string): Promise<boolean> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  
  if (!await fs.pathExists(packageJsonPath)) {
    return false;
  }
  
  try {
    const pkg = await fs.readJson(packageJsonPath);
    
    // Check for react-native dependency
    const hasRN = pkg.dependencies?.['react-native'] != null ||
                  pkg.devDependencies?.['react-native'] != null;
    
    // Check for react-native.config.js or metro.config.js
    const hasConfig = await fs.pathExists(path.join(projectPath, 'react-native.config.js')) ||
                      await fs.pathExists(path.join(projectPath, 'metro.config.js')) ||
                      await fs.pathExists(path.join(projectPath, 'app.json')); // Expo
    
    return hasRN || hasConfig;
  } catch {
    return false;
  }
}

export async function installDependencies(projectPath: string): Promise<void> {
  const pkgManager = await detectPackageManager(projectPath);
  
  await execa(pkgManager, ['install', 'react-native-cross-native', 'react-native-nitro-modules'], {
    cwd: projectPath,
    stdio: 'inherit',
  });
}

export async function createConfig(
  projectPath: string,
  config: Record<string, any>
): Promise<void> {
  const configPath = path.join(projectPath, '.cross-native', 'config.json');
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, config, { spaces: 2 });
}

async function detectPackageManager(projectPath: string): Promise<string> {
  if (await fs.pathExists(path.join(projectPath, 'yarn.lock'))) {
    return 'yarn';
  }
  if (await fs.pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  return 'npm';
}
