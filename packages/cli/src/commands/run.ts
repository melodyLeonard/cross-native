import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';

interface RunOptions {
  port: string;
  ios: boolean;
  android: boolean;
  device?: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
  console.log(chalk.bold('\n🏃 Starting development mode\n'));
  
  // Determine platform
  let platform: string;
  if (options.ios) {
    platform = 'ios';
  } else if (options.android) {
    platform = 'android';
  } else {
    // Auto-detect
    platform = process.platform === 'darwin' ? 'ios' : 'android';
  }
  
  console.log(chalk.gray(`Platform: ${platform}`));
  console.log(chalk.gray(`Metro port: ${options.port}`));
  console.log();
  
  // Start Metro bundler
  const metroSpinner = ora('Starting Metro bundler...').start();
  
  try {
    const metro = execa('npx', ['react-native', 'start', '--port', options.port], {
      stdio: 'pipe',
      detached: true,
    });
    
    // Wait for Metro to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(); // Assume it's starting
      }, 3000);
      
      metro.stdout?.on('data', (data) => {
        if (data.toString().includes('Metro waiting')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    
    metroSpinner.succeed('Metro bundler started');
  } catch (error) {
    metroSpinner.fail('Failed to start Metro');
    throw error;
  }
  
  // Build native modules in watch mode
  const buildSpinner = ora('Building native modules...').start();
  
  try {
    await execa('npx', ['cross-native', 'build', '--watch'], {
      stdio: 'pipe',
      detached: true,
    });
    
    buildSpinner.succeed('Native modules building (watch mode)');
  } catch (error) {
    buildSpinner.fail('Build failed');
    console.error(error);
  }
  
  // Run the app
  const runSpinner = ora(`Running on ${platform}...`).start();
  
  try {
    const args = ['react-native', 'run-' + platform];
    
    if (options.device) {
      args.push('--device', options.device);
    }
    
    if (options.port !== '8081') {
      args.push('--port', options.port);
    }
    
    const app = execa('npx', args, {
      stdio: 'inherit',
    });
    
    await app;
    
    runSpinner.succeed(`App running on ${platform}`);
  } catch (error) {
    runSpinner.fail(`Failed to run on ${platform}`);
    throw error;
  }
}
