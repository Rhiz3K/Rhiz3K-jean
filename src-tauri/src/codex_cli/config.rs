//! Configuration and path management for the embedded Codex CLI

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Directory name for storing the Codex CLI binary
pub const CLI_DIR_NAME: &str = "codex-cli";

/// Name of the Codex CLI binary
#[cfg(target_os = "windows")]
pub const CLI_BINARY_NAME: &str = "codex.exe";
#[cfg(not(target_os = "windows"))]
pub const CLI_BINARY_NAME: &str = "codex";

/// Get the directory where Codex CLI is installed
pub fn get_codex_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    Ok(app_data_dir.join(CLI_DIR_NAME))
}

/// Get the full path to the Codex CLI binary
pub fn get_codex_cli_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_codex_cli_dir(app)?.join(CLI_BINARY_NAME))
}

/// Ensure the CLI directory exists, creating it if necessary
pub fn ensure_codex_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cli_dir = get_codex_cli_dir(app)?;
    std::fs::create_dir_all(&cli_dir)
        .map_err(|e| format!("Failed to create CLI directory: {e}"))?;
    Ok(cli_dir)
}
