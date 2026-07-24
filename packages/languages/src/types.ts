/**
 * The vocabulary of language support.
 *
 * This package is deliberately dependency-free and side-effect-free: it is the
 * single place that answers "is this a language we support, what file
 * extensions does it own, and what has to be installed to build it". Both the
 * runtime and the build tooling read from it, so the two cannot drift.
 */

/** Every language CrossNative recognises, whether or not it works yet. */
export type LanguageId = 'rust' | 'go' | 'zig' | 'assemblyscript' | 'cpp';

/**
 * How far along a language is.
 *
 * `planned` languages are recognised so that using one produces an honest
 * "not implemented yet" message rather than "unknown language".
 */
export type SupportLevel = 'stable' | 'experimental' | 'planned';

/** What a compiled module ends up as. */
export type ArtifactKind = 'wasm' | 'library';

/** One executable a language needs in order to build. */
export interface ToolchainTool {
  /** Executable name, also used as the identifier in diagnostics. */
  id: string;
  /** Human-readable name for messages. */
  label: string;
  /** Command that succeeds when the tool is present. */
  probe: string[];
  /** Where to get it. */
  installUrl: string;
  /** One line telling the developer what to run or install. */
  installHint: string;
  /**
   * A command CrossNative may offer to run itself.
   *
   * Only for additive, reversible steps within an already-installed toolchain —
   * adding a compilation target, for instance. Never for installing the
   * toolchain itself, which stays the developer's decision.
   */
  autoFix?: {
    command: string[];
    /** What running it will do, shown before asking. */
    describes: string;
  };
}

/** Everything CrossNative knows about one language. */
export interface LanguageDefinition {
  id: LanguageId;
  /** Name as a human writes it: "Rust", "AssemblyScript". */
  displayName: string;
  /** File extensions this language owns, lowercase and dot-prefixed. */
  extensions: string[];
  support: SupportLevel;
  /** What compiling it produces. */
  artifact: ArtifactKind;
  /** Tools that must be present to build it. */
  toolchain: ToolchainTool[];
  /**
   * Why a `planned` language is not usable yet, and what to do instead.
   * Ignored for stable and experimental languages.
   */
  notReadyReason?: string;
}
