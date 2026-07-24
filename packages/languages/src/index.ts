/**
 * @cross-native/languages
 *
 * The single source of truth for which languages CrossNative supports, which
 * file extensions they own, and what has to be installed to build them.
 *
 * Dependency-free and side-effect-free on purpose: the runtime, the build
 * tooling and the editor integration all read from here, so none of them can
 * disagree about what "supported" means.
 */

export type {
  LanguageId,
  SupportLevel,
  ArtifactKind,
  ToolchainTool,
  LanguageDefinition,
} from './types.ts';

export {
  LanguageError,
  UnsupportedLanguageError,
  UnknownExtensionError,
  LanguageNotReadyError,
  type LanguageErrorCode,
} from './errors.ts';

export {
  listLanguages,
  listUsableLanguages,
  isUsable,
  getLanguage,
  getLanguageForFile,
  requireLanguage,
  requireUsableLanguage,
  requireLanguageForFile,
  assertUsable,
  isLanguageId,
  usableExtensions,
} from './registry.ts';
