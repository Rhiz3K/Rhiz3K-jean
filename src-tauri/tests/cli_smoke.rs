use std::path::{Path, PathBuf};
use std::process::Command;

fn find_on_path(binary_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary_name);
        if candidate.is_file() {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            let exe = dir.join(format!("{binary_name}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

fn resolve_cli_path(env_key: &str, binary_name: &str) -> Option<PathBuf> {
    if let Ok(p) = std::env::var(env_key) {
        if !p.trim().is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    find_on_path(binary_name)
}

fn assert_cli_responds(path: &Path, args: &[&str]) {
    let out = Command::new(path)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("Failed to spawn {}: {e}", path.display()));

    assert!(
        out.status.success(),
        "CLI exited non-zero ({}): code={:?}, stderr={}",
        path.display(),
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !(stdout.trim().is_empty() && stderr.trim().is_empty()),
        "CLI produced no output ({}).",
        path.display()
    );
}

/// Smoke test: verify Codex CLI is installed/executable and responds.
///
/// This does NOT attempt a live model request (no network/API keys required).
/// Set `JEAN_TEST_CODEX_CLI=/path/to/codex` if it's not on PATH.
#[test]
fn smoke_codex_cli_responds() {
    let Some(path) = resolve_cli_path("JEAN_TEST_CODEX_CLI", "codex") else {
        eprintln!("SKIP smoke_codex_cli_responds: codex not found on PATH and JEAN_TEST_CODEX_CLI not set");
        return;
    };

    assert_cli_responds(&path, &["--version"]);
    assert_cli_responds(&path, &["--help"]);
    assert_cli_responds(&path, &["exec", "--help"]);
}

/// Smoke test: verify Claude Code CLI is installed/executable and responds.
///
/// This does NOT attempt a live model request (no network/API keys required).
/// Set `JEAN_TEST_CLAUDE_CLI=/path/to/claude` if it's not on PATH.
#[test]
fn smoke_claude_cli_responds() {
    let Some(path) = resolve_cli_path("JEAN_TEST_CLAUDE_CLI", "claude") else {
        eprintln!("SKIP smoke_claude_cli_responds: claude not found on PATH and JEAN_TEST_CLAUDE_CLI not set");
        return;
    };

    // Claude CLI commonly supports --version; if not, --help will still validate it runs.
    // Keep this permissive because subcommand surface changes across versions.
    let _ = Command::new(&path).args(["--version"]).output();
    assert_cli_responds(&path, &["--help"]);
}

