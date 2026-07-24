/**
 * Language errors.
 *
 * These are the messages a developer sees when they misconfigure something, so
 * each one names what was wrong, what is available instead, and what to do.
 * A vague failure here costs far more than the code it takes to avoid it.
 */

export type LanguageErrorCode =
  | 'UNSUPPORTED_LANGUAGE'
  | 'UNKNOWN_EXTENSION'
  | 'LANGUAGE_NOT_READY';

export class LanguageError extends Error {
  readonly code: LanguageErrorCode;

  constructor(code: LanguageErrorCode, message: string) {
    super(message);
    this.name = 'LanguageError';
    this.code = code;
  }
}

/** The identifier is not a language CrossNative has heard of. */
export class UnsupportedLanguageError extends LanguageError {
  readonly requested: string;

  constructor(requested: string, summary: string) {
    super(
      'UNSUPPORTED_LANGUAGE',
      `CrossNative does not support the language "${requested}".\n\n${summary}`
    );
    this.name = 'UnsupportedLanguageError';
    this.requested = requested;
  }
}

/** No language claims this file extension. */
export class UnknownExtensionError extends LanguageError {
  readonly extension: string;
  readonly path: string;

  constructor(extension: string, path: string, summary: string) {
    super(
      'UNKNOWN_EXTENSION',
      `No CrossNative language handles "${extension}" files (${path}).\n\n${summary}`
    );
    this.name = 'UnknownExtensionError';
    this.extension = extension;
    this.path = path;
  }
}

/** The language is recognised, but CrossNative cannot build it yet. */
export class LanguageNotReadyError extends LanguageError {
  readonly language: string;

  constructor(language: string, displayName: string, reason: string) {
    super(
      'LANGUAGE_NOT_READY',
      `${displayName} support is planned but not implemented yet.\n\n${reason}`
    );
    this.name = 'LanguageNotReadyError';
    this.language = language;
  }
}
