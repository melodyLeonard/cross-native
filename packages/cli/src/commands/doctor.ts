import chalk from 'chalk';
import { execa } from 'execa';
import { detectLanguageToolchain } from '../utils/toolchain';
import { checkReactNativeProject } from '../utils/project';

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold('\n🏥 CrossNative Doctor\n'));
  
  const checks: { name: string; status: 'ok' | 'warn' | 'error'; message: string }[] = [];
  
  // Check Node.js
  try {
    const { stdout } = await execa('node', ['--version']);
    const version = stdout.trim();
    const major = parseInt(version.slice(1).split('.')[0]);
    
    if (major >= 18) {
      checks.push({ name: 'Node.js', status: 'ok', message: version });
    } else {
      checks.push({ name: 'Node.js', status: 'warn', message: `${version} (recommended: >=18)` });
    }
  } catch {
    checks.push({ name: 'Node.js', status: 'error', message: 'Not found' });
  }
  
  // Check React Native
  try {
    const { stdout } = await execa('npx', ['react-native', '--version']);
    checks.push({ name: 'React Native CLI', status: 'ok', message: stdout.trim() });
  } catch {
    checks.push({ name: 'React Native CLI', status: 'warn', message: 'Not installed globally' });
  }
  
  // Check if in React Native project
  const isRN = await checkReactNativeProject('.');
  if (isRN) {
    checks.push({ name: 'Project Type', status: 'ok', message: 'React Native project detected' });
  } else {
    checks.push({ name: 'Project Type', status: 'warn', message: 'Not in a React Native project' });
  }
  
  // Check language toolchains
  const languages = ['rust', 'go', 'cpp'];
  
  for (const language of languages) {
    const toolchain = await detectLanguageToolchain(language);
    
    if (toolchain.installed) {
      checks.push({ 
        name: `${language.charAt(0).toUpperCase() + language.slice(1)} toolchain`, 
        status: 'ok', 
        message: toolchain.version || 'Installed' 
      });
    } else {
      checks.push({ 
        name: `${language.charAt(0).toUpperCase() + language.slice(1)} toolchain`, 
        status: 'warn', 
        message: 'Not installed (optional)' 
      });
    }
  }
  
  // Check iOS development
  if (process.platform === 'darwin') {
    try {
      await execa('xcrun', ['--version']);
      checks.push({ name: 'iOS Development', status: 'ok', message: 'Xcode tools available' });
    } catch {
      checks.push({ name: 'iOS Development', status: 'warn', message: 'Xcode tools not found' });
    }
  }
  
  // Check Android development
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (androidHome) {
    checks.push({ name: 'Android SDK', status: 'ok', message: androidHome });
  } else {
    checks.push({ name: 'Android SDK', status: 'warn', message: 'ANDROID_HOME not set' });
  }
  
  // Print results
  console.log(chalk.bold('Environment Checks:\n'));
  
  for (const check of checks) {
    const icon = check.status === 'ok' ? chalk.green('✓') : 
                 check.status === 'warn' ? chalk.yellow('⚠') : 
                 chalk.red('✗');
    
    const color = check.status === 'ok' ? chalk.green : 
                  check.status === 'warn' ? chalk.yellow : 
                  chalk.red;
    
    console.log(`  ${icon} ${color(check.name.padEnd(20))} ${check.message}`);
  }
  
  // Summary
  const okCount = checks.filter(c => c.status === 'ok').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const errorCount = checks.filter(c => c.status === 'error').length;
  
  console.log(chalk.bold('\nSummary:\n'));
  console.log(chalk.green(`  ${okCount} passing`));
  if (warnCount > 0) console.log(chalk.yellow(`  ${warnCount} warnings`));
  if (errorCount > 0) console.log(chalk.red(`  ${errorCount} errors`));
  
  if (errorCount > 0) {
    console.log(chalk.red('\nPlease fix errors before continuing.\n'));
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(chalk.yellow('\nSome optional dependencies are missing. You can still continue.\n'));
  } else {
    console.log(chalk.green('\n✅ All checks passed!\n'));
  }
}
