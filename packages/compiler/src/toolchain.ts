/**
 * Toolchain detection.
 *
 * CrossNative cannot ship a Rust or Go compiler inside an npm package, so the
 * honest goal is not "no installs" but "no guessing": if something is missing,
 * say exactly what, and give the one command that fixes it.
 */

import { spawn } from 'node:child_process';
import { requireUsableLanguage } from '@melodyleonard/languages';
import type { LanguageDefinition, ToolchainTool } from '@melodyleonard/languages';

export interface ToolStatus {
  tool: ToolchainTool;
  present: boolean;
  /** First line of the probe's output, when it succeeded. */
  version?: string;
  /** True when the tool is absent but CrossNative can add it for you. */
  fixable: boolean;
}

export interface ToolchainReport {
  language: LanguageDefinition;
  tools: ToolStatus[];
  ready: boolean;
  /** Missing pieces that an autoFix command could resolve. */
  fixable: ToolStatus[];
}

/** Run a command, capturing output. Never throws. */
export function run(
  command: string[],
  cwd?: string,
  env?: Record<string, string>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      stdio: 'pipe',
      env: env ? { ...process.env, ...env } : process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));

    child.on('error', () => resolve({ code: -1, stdout, stderr }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Check one tool.
 *
 * A target like wasm32-unknown-unknown is not a separate executable — the probe
 * lists what is installed and we look for the id in the output.
 */
async function probe(tool: ToolchainTool): Promise<ToolStatus> {
  const { code, stdout } = await run(tool.probe);

  const found = code === 0 && (
    // `rustup target list --installed` prints the targets it has.
    tool.probe.includes('list') ? stdout.includes(tool.id) : true
  );

  return {
    tool,
    present: found,
    version: found ? stdout.split('\n')[0]?.trim() : undefined,
    fixable: !found && tool.autoFix !== undefined,
  };
}

/** Check everything a language needs. */
export async function inspectToolchain(languageId: string): Promise<ToolchainReport> {
  const language = requireUsableLanguage(languageId);
  const tools = await Promise.all(language.toolchain.map(probe));

  return {
    language,
    tools,
    ready: tools.every((status) => status.present),
    fixable: tools.filter((status) => status.fixable),
  };
}

/** A message naming what is missing and how to fix it. */
export function describeMissing(report: ToolchainReport): string {
  const missing = report.tools.filter((status) => !status.present);
  if (missing.length === 0) return '';

  const lines = [
    `Cannot build ${report.language.displayName}: ` +
    `${missing.length} required tool${missing.length === 1 ? '' : 's'} missing.`,
    '',
  ];

  for (const status of missing) {
    lines.push(`  ${status.tool.label}`);
    lines.push(`    ${status.tool.installHint}`);
    if (status.tool.autoFix) {
      lines.push(`    CrossNative can do this for you — re-run with --fix`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Run the autoFix commands for whatever is missing and fixable.
 *
 * Only ever additive steps inside an already-installed toolchain, such as
 * adding a compilation target. Installing a toolchain stays the developer's
 * decision, so this never attempts one.
 */
export async function applyFixes(report: ToolchainReport): Promise<boolean> {
  let allFixed = true;

  for (const status of report.fixable) {
    const fix = status.tool.autoFix;
    if (!fix) continue;

    console.log(`Running: ${fix.command.join(' ')}  (to ${fix.describes})`);
    const { code, stderr } = await run(fix.command);

    if (code !== 0) {
      console.error(`  failed: ${stderr.trim() || `exit code ${code}`}`);
      allFixed = false;
    }
  }

  return allFixed;
}
