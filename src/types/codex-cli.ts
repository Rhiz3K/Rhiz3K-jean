/**
 * Types for Codex CLI management
 */

/**
 * Status of the Codex CLI installation
 */
export interface CodexCliStatus {
  /** Whether Codex CLI is installed */
  installed: boolean
  /** Installed version (if any) */
  version: string | null
  /** Path to the CLI binary (if installed) */
  path: string | null
}

/**
 * Result of checking Codex CLI authentication status
 */
export interface CodexAuthStatus {
  /** Whether the CLI is authenticated */
  authenticated: boolean
  /** Error message if authentication check failed */
  error: string | null
}

/**
 * Information about a Codex CLI release
 */
export interface CodexReleaseInfo {
  /** Version string (e.g., "0.92.0") */
  version: string
  /** Git tag name (e.g., "rust-v0.92.0") - camelCase alias */
  tagName: string
  /** Publication date in ISO format - camelCase alias */
  publishedAt: string
  /** Whether this is a prerelease */
  prerelease: boolean
}

/**
 * Progress event for CLI installation
 */
export interface CodexInstallProgress {
  /** Current stage of installation */
  stage:
    | 'starting'
    | 'fetching_release'
    | 'downloading'
    | 'extracting'
    | 'installing'
    | 'verifying'
    | 'complete'
  /** Progress message */
  message: string
  /** Percentage complete (0-100) */
  percent: number
}

