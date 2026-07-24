import { execa } from 'execa';

interface ToolchainInfo {
  installed: boolean;
  version?: string;
  installInstructions: string;
}

export async function detectLanguageToolchain(language: string): Promise<ToolchainInfo> {
  switch (language) {
    case 'rust':
      return detectRust();
    case 'go':
      return detectGo();
    case 'cpp':
      return detectCpp();
    case 'zig':
      return detectZig();
    default:
      return {
        installed: false,
        installInstructions: `Unknown language: ${language}`,
      };
  }
}

async function detectRust(): Promise<ToolchainInfo> {
  try {
    const { stdout } = await execa('rustc', ['--version']);
    return {
      installed: true,
      version: stdout.trim(),
      installInstructions: 'Already installed',
    };
  } catch {
    return {
      installed: false,
      installInstructions: `Install Rust:\n  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`,
    };
  }
}

async function detectGo(): Promise<ToolchainInfo> {
  try {
    const { stdout } = await execa('go', ['version']);
    return {
      installed: true,
      version: stdout.trim(),
      installInstructions: 'Already installed',
    };
  } catch {
    return {
      installed: false,
      installInstructions: `Install Go:\n  https://go.dev/dl/`,
    };
  }
}

async function detectCpp(): Promise<ToolchainInfo> {
  const compilers = ['clang++', 'g++'];
  
  for (const compiler of compilers) {
    try {
      const { stdout } = await execa(compiler, ['--version']);
      return {
        installed: true,
        version: stdout.split('\n')[0].trim(),
        installInstructions: 'Already installed',
      };
    } catch {
      continue;
    }
  }
  
  return {
    installed: false,
    installInstructions: `Install C++ compiler:\n  macOS: xcode-select --install\n  Ubuntu: sudo apt install build-essential`,
  };
}

async function detectZig(): Promise<ToolchainInfo> {
  try {
    const { stdout } = await execa('zig', ['version']);
    return {
      installed: true,
      version: stdout.trim(),
      installInstructions: 'Already installed',
    };
  } catch {
    return {
      installed: false,
      installInstructions: `Install Zig:\n  https://ziglang.org/download/`,
    };
  }
}
