/**
 * Looking languages up, and failing usefully when that is not possible.
 */

import { LANGUAGES } from './definitions.ts';
import {
  LanguageNotReadyError,
  UnknownExtensionError,
  UnsupportedLanguageError,
} from './errors.ts';
import type { LanguageDefinition, LanguageId, SupportLevel } from './types.ts';

/** Every language CrossNative recognises. */
export function listLanguages(): readonly LanguageDefinition[] {
  return LANGUAGES;
}

/** Languages that can actually be built today. */
export function listUsableLanguages(): LanguageDefinition[] {
  return LANGUAGES.filter((language) => isUsable(language.support));
}

/** Whether a support level means "you can use this now". */
export function isUsable(support: SupportLevel): boolean {
  return support === 'stable' || support === 'experimental';
}

/** Look a language up by id. Returns undefined rather than throwing. */
export function getLanguage(id: string): LanguageDefinition | undefined {
  const normalized = id.trim().toLowerCase();
  return LANGUAGES.find((language) => language.id === normalized);
}

/** Every extension a usable language owns, for diagnostics. */
export function usableExtensions(): string[] {
  return listUsableLanguages().flatMap((language) => language.extensions);
}

/** Find the language that owns a file, by its extension. */
export function getLanguageForFile(path: string): LanguageDefinition | undefined {
  const lower = path.toLowerCase();
  // Longest extension first, so ".as.ts" wins over ".ts".
  const byLength = [...LANGUAGES].sort(
    (a, b) => longestExtension(b) - longestExtension(a)
  );
  return byLength.find((language) =>
    language.extensions.some((extension) => lower.endsWith(extension))
  );
}

function longestExtension(language: LanguageDefinition): number {
  return Math.max(...language.extensions.map((extension) => extension.length));
}

/** The trailing extension of a path, for error messages. */
function extensionOf(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  const dot = name.indexOf('.');
  return dot === -1 ? '(no extension)' : name.slice(dot);
}

/** A table of what is available, used in every failure message. */
function availabilitySummary(): string {
  const usable = listUsableLanguages();
  const planned = LANGUAGES.filter((language) => !isUsable(language.support));

  const describe = (language: LanguageDefinition) =>
    `  ${language.id.padEnd(16)}${language.extensions.join(', ')}`;

  const lines: string[] = [];
  if (usable.length > 0) {
    lines.push('Supported today:', ...usable.map(describe));
  }
  if (planned.length > 0) {
    lines.push('', 'Recognised but not implemented yet:', ...planned.map(describe));
  }
  return lines.join('\n');
}

/**
 * Look a language up, or explain why that failed.
 *
 * @throws UnsupportedLanguageError if the name is not recognised at all
 */
export function requireLanguage(id: string): LanguageDefinition {
  const language = getLanguage(id);
  if (!language) {
    throw new UnsupportedLanguageError(id, availabilitySummary());
  }
  return language;
}

/**
 * Look a language up and confirm it can be built.
 *
 * @throws UnsupportedLanguageError if unrecognised
 * @throws LanguageNotReadyError if recognised but not implemented
 */
export function requireUsableLanguage(id: string): LanguageDefinition {
  const language = requireLanguage(id);
  assertUsable(language);
  return language;
}

/**
 * Find the language that owns a file, or explain why that failed.
 *
 * @throws UnknownExtensionError if nothing claims the extension
 */
export function requireLanguageForFile(path: string): LanguageDefinition {
  const language = getLanguageForFile(path);
  if (!language) {
    throw new UnknownExtensionError(extensionOf(path), path, availabilitySummary());
  }
  return language;
}

/**
 * Fail if a recognised language is not implemented yet.
 *
 * Separate from lookup so callers that only need metadata — listing supported
 * extensions, say — do not trip over it.
 */
export function assertUsable(language: LanguageDefinition): void {
  if (isUsable(language.support)) return;

  throw new LanguageNotReadyError(
    language.id,
    language.displayName,
    language.notReadyReason ?? 'No compile step exists for it yet.'
  );
}

/** Type guard for callers holding an untrusted string. */
export function isLanguageId(id: string): id is LanguageId {
  return getLanguage(id) !== undefined;
}
