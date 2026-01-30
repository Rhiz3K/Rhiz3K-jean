//! Tauri commands for Codex CLI management

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::platform::silent_command;

use super::config::{ensure_codex_cli_dir, get_codex_cli_binary_path};

/// GitHub API URL for Codex releases
const CODEX_RELEASES_API: &str = "https://api.github.com/repos/openai/codex/releases";

/// Extract semver-like version number from a version string
/// Handles formats like: "0.92.0", "v0.92.0", "codex 0.92.0"
fn extract_version_number(version_str: &str) -> Option<String> {
    // Try to find a semver-like pattern (digits.digits.digits) anywhere
    let re = regex::Regex::new(r"(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)").ok()?;
    re.captures(version_str)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

/// Status of the Codex CLI installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexCliStatus {
    /// Whether Codex CLI is installed
    pub installed: bool,
    /// Installed version (if any)
    pub version: Option<String>,
    /// Path to the CLI binary (if installed)
    pub path: Option<String>,
}

/// Information about a Codex CLI release
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexReleaseInfo {
    /// Version string (e.g., "0.92.0")
    pub version: String,
    /// Git tag name (e.g., "rust-v0.92.0")
    pub tag_name: String,
    /// Publication date in ISO format
    pub published_at: String,
    /// Whether this is a prerelease
    pub prerelease: bool,
}

/// Progress event for CLI installation
#[derive(Debug, Clone, Serialize)]
pub struct CodexInstallProgress {
    /// Current stage of installation
    pub stage: String,
    /// Progress message
    pub message: String,
    /// Percentage complete (0-100)
    pub percent: u8,
}

/// GitHub API release response structure
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    published_at: String,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// Check if Codex CLI is installed and get its status
#[tauri::command]
pub async fn check_codex_cli_installed(app: AppHandle) -> Result<CodexCliStatus, String> {
    log::trace!("Checking Codex CLI installation status");

    let binary_path = get_codex_cli_binary_path(&app)?;

    if !binary_path.exists() {
        log::trace!("Codex CLI not found at {:?}", binary_path);
        return Ok(CodexCliStatus {
            installed: false,
            version: None,
            path: None,
        });
    }

    // Try to get the version by running codex --version
    let version = match silent_command(&binary_path).arg("--version").output() {
        Ok(output) => {
            if output.status.success() {
                let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
                log::trace!("Codex CLI raw version output: {raw}");
                extract_version_number(&raw)
            } else {
                log::warn!("Failed to get Codex CLI version");
                None
            }
        }
        Err(e) => {
            log::warn!("Failed to execute Codex CLI: {e}");
            None
        }
    };

    Ok(CodexCliStatus {
        installed: true,
        version,
        path: Some(binary_path.to_string_lossy().to_string()),
    })
}

/// Get available Codex CLI versions from GitHub releases API
#[tauri::command]
pub async fn get_available_codex_versions() -> Result<Vec<CodexReleaseInfo>, String> {
    log::trace!("Fetching available Codex CLI versions from GitHub API");

    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    // Ask for more items per page so stable releases don't get pushed out by prereleases.
    let url = format!("{CODEX_RELEASES_API}?per_page=100");
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }

    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub API response: {e}"))?;

    // Convert to our format.
    // Prefer stable releases in the picker; fill remaining slots with prereleases.
    let mut stable: Vec<CodexReleaseInfo> = Vec::new();
    let mut prerelease: Vec<CodexReleaseInfo> = Vec::new();

    for r in releases.into_iter().filter(|r| !r.assets.is_empty()) {
        let version = r
            .name
            .clone()
            .and_then(|n| extract_version_number(&n))
            .or_else(|| r.tag_name.strip_prefix("rust-v").map(|s| s.to_string()))
            .unwrap_or_else(|| r.tag_name.clone());

        let info = CodexReleaseInfo {
            version,
            tag_name: r.tag_name,
            published_at: r.published_at,
            prerelease: r.prerelease,
        };

        if info.prerelease {
            prerelease.push(info);
        } else {
            stable.push(info);
        }
    }

    stable.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    prerelease.sort_by(|a, b| b.published_at.cmp(&a.published_at));

    let mut versions: Vec<CodexReleaseInfo> = stable.into_iter().take(5).collect();
    if versions.len() < 5 {
        let remaining = 5 - versions.len();
        versions.extend(prerelease.into_iter().take(remaining));
    }

    log::trace!("Found {} Codex CLI versions", versions.len());
    Ok(versions)
}

/// Get the asset name and extracted filename for the current platform
fn get_codex_asset() -> Result<(&'static str, &'static str), String> {
    // Returns (asset_name, extracted_filename_inside_tar)
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok((
            "codex-aarch64-apple-darwin.tar.gz",
            "codex-aarch64-apple-darwin",
        ));
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok((
            "codex-x86_64-apple-darwin.tar.gz",
            "codex-x86_64-apple-darwin",
        ));
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok((
            "codex-x86_64-unknown-linux-gnu.tar.gz",
            "codex-x86_64-unknown-linux-gnu",
        ));
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok((
            "codex-aarch64-unknown-linux-gnu.tar.gz",
            "codex-aarch64-unknown-linux-gnu",
        ));
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok((
            "codex-x86_64-pc-windows-msvc.exe.tar.gz",
            "codex-x86_64-pc-windows-msvc.exe",
        ));
    }

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return Ok((
            "codex-aarch64-pc-windows-msvc.exe.tar.gz",
            "codex-aarch64-pc-windows-msvc.exe",
        ));
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

/// Fetch a specific Codex release by tag
async fn fetch_release(tag_name: &str) -> Result<GitHubRelease, String> {
    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let url = format!("{CODEX_RELEASES_API}/tags/{tag_name}");
    log::trace!("Fetching Codex release: {url}");

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch release: HTTP {}", response.status()));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release: {e}"))
}

/// Fetch the latest stable Codex version (non-prerelease)
async fn fetch_latest_codex_version() -> Result<String, String> {
    log::trace!("Fetching latest Codex CLI version");

    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(CODEX_RELEASES_API)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch releases: HTTP {}",
            response.status()
        ));
    }

    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {e}"))?;

    let latest = releases
        .into_iter()
        .find(|r| !r.prerelease && !r.assets.is_empty())
        .ok_or_else(|| "No stable Codex releases found".to_string())?;

    let version = latest
        .name
        .and_then(|n| extract_version_number(&n))
        .or_else(|| latest.tag_name.strip_prefix("rust-v").map(|s| s.to_string()))
        .unwrap_or(latest.tag_name);

    log::trace!("Latest Codex CLI version: {version}");
    Ok(version)
}

/// Install Codex CLI by downloading from GitHub releases
#[tauri::command]
pub async fn install_codex_cli(app: AppHandle, version: Option<String>) -> Result<(), String> {
    log::trace!("Installing Codex CLI, version: {:?}", version);

    // Check if any processes are running - cannot replace binary while in use
    let running_sessions = crate::chat::registry::get_running_sessions();
    if !running_sessions.is_empty() {
        let count = running_sessions.len();
        return Err(format!(
            "Cannot install Codex CLI while {} session {} running. Please stop all active sessions first.",
            count,
            if count == 1 { "is" } else { "are" }
        ));
    }

    let cli_dir = ensure_codex_cli_dir(&app)?;
    let binary_path = get_codex_cli_binary_path(&app)?;

    emit_progress(&app, "starting", "Preparing installation...", 0);

    // Determine version (use provided or fetch latest stable)
    let version = match version {
        Some(v) => v,
        None => fetch_latest_codex_version().await?,
    };

    let tag_name = if version.starts_with("rust-v") {
        version.clone()
    } else {
        format!("rust-v{version}")
    };

    let (asset_name, extracted_name) = get_codex_asset()?;
    log::trace!("Installing tag {tag_name}, asset {asset_name}");

    emit_progress(&app, "fetching_release", "Fetching release info...", 10);
    let release = fetch_release(&tag_name).await?;

    // Find asset download URL
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| format!("Asset not found in release: {asset_name}"))?;

    emit_progress(&app, "downloading", "Downloading Codex CLI...", 25);

    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download Codex CLI: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download Codex CLI: HTTP {}",
            response.status()
        ));
    }

    let archive_content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read archive content: {e}"))?;

    log::trace!("Downloaded {} bytes", archive_content.len());

    emit_progress(&app, "extracting", "Extracting archive...", 45);

    // Create temp directory for extraction
    let temp_dir = cli_dir.join("temp");
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    // Extract tar.gz
    let extracted_binary_path = extract_tar_gz(&archive_content, &temp_dir, extracted_name)?;

    emit_progress(&app, "installing", "Installing Codex CLI...", 65);

    // Copy binary to final location
    std::fs::copy(&extracted_binary_path, &binary_path)
        .map_err(|e| format!("Failed to copy Codex binary: {e}"))?;

    // Clean up temp directory
    let _ = std::fs::remove_dir_all(&temp_dir);

    emit_progress(&app, "verifying", "Verifying installation...", 85);

    // Make sure the binary is executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get binary metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set binary permissions: {e}"))?;
    }

    // Remove macOS quarantine attribute to allow execution
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&binary_path)
            .output();
    }

    // Verify the binary works
    let version_output = silent_command(&binary_path)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to verify Codex CLI: {e}"))?;

    if !version_output.status.success() {
        let stderr = String::from_utf8_lossy(&version_output.stderr);
        let stdout = String::from_utf8_lossy(&version_output.stdout);
        log::error!(
            "Codex CLI verification failed - exit code: {:?}, stdout: {}, stderr: {}",
            version_output.status.code(),
            stdout,
            stderr
        );
        return Err(format!(
            "Codex CLI binary verification failed: {}",
            if !stderr.is_empty() {
                stderr.to_string()
            } else {
                "Unknown error".to_string()
            }
        ));
    }

    emit_progress(&app, "complete", "Installation complete!", 100);
    log::trace!("Codex CLI installed successfully at {:?}", binary_path);
    Ok(())
}

fn extract_tar_gz(
    archive_content: &[u8],
    temp_dir: &std::path::Path,
    extracted_filename: &str,
) -> Result<std::path::PathBuf, String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    use tar::Archive;

    let cursor = Cursor::new(archive_content);
    let decoder = GzDecoder::new(cursor);
    let mut archive = Archive::new(decoder);

    archive
        .unpack(temp_dir)
        .map_err(|e| format!("Failed to extract tar.gz archive: {e}"))?;

    let binary_path = temp_dir.join(extracted_filename);
    if !binary_path.exists() {
        return Err(format!("Binary not found in archive at {:?}", binary_path));
    }
    Ok(binary_path)
}

/// Result of checking Codex CLI authentication status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthStatus {
    /// Whether the CLI is authenticated
    pub authenticated: bool,
    /// Error message if authentication check failed
    pub error: Option<String>,
}

/// Check if Codex CLI is authenticated by running `codex login status`
#[tauri::command]
pub async fn check_codex_cli_auth(app: AppHandle) -> Result<CodexAuthStatus, String> {
    log::trace!("Checking Codex CLI authentication status");

    let binary_path = get_codex_cli_binary_path(&app)?;

    if !binary_path.exists() {
        return Ok(CodexAuthStatus {
            authenticated: false,
            error: Some("Codex CLI not installed".to_string()),
        });
    }

    log::trace!("Running auth check: codex login status");

    let output = silent_command(&binary_path)
        .args(["login", "status"])
        .output()
        .map_err(|e| format!("Failed to execute Codex CLI: {e}"))?;

    if output.status.success() {
        Ok(CodexAuthStatus {
            authenticated: true,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(CodexAuthStatus {
            authenticated: false,
            error: Some(if stderr.is_empty() {
                "Not authenticated".to_string()
            } else {
                stderr
            }),
        })
    }
}

/// Helper function to emit installation progress events
fn emit_progress(app: &AppHandle, stage: &str, message: &str, percent: u8) {
    let progress = CodexInstallProgress {
        stage: stage.to_string(),
        message: message.to_string(),
        percent,
    };

    if let Err(e) = app.emit("codex-cli:install-progress", &progress) {
        log::warn!("Failed to emit install progress: {e}");
    }
}
