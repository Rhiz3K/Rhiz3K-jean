//! Helpers for running Codex CLI synchronously (non-detached).
//!
//! Used by background tasks (e.g. commit message generation, PR content generation)
//! where we need a one-shot response rather than a streamed session.

use std::process::Stdio;

use serde::Deserialize;
use tauri::AppHandle;

use crate::platform::silent_command;

use super::get_codex_cli_binary_path;

fn normalize_reasoning_effort(effort: Option<&str>) -> Option<&str> {
    match effort {
        Some("minimal") => Some("low"),
        Some(other) if other.trim().is_empty() => None,
        Some(other) => Some(other),
        None => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum CodexJsonEvent {
    #[serde(rename = "turn.failed")]
    TurnFailed { error: CodexTurnError },
    #[serde(rename = "error")]
    StreamError { message: String },
    #[serde(rename = "item.started")]
    ItemStarted { item: CodexItem },
    #[serde(rename = "item.updated")]
    ItemUpdated { item: CodexItem },
    #[serde(rename = "item.completed")]
    ItemCompleted { item: CodexItem },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct CodexTurnError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct CodexAgentMessageItem {
    id: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum CodexItem {
    #[serde(rename = "agent_message")]
    AgentMessage(CodexAgentMessageItem),
    #[serde(other)]
    Other,
}

fn extract_final_agent_message(stdout: &str) -> Result<String, String> {
    let mut last_agent_message_id: Option<String> = None;
    let mut agent_message_text_by_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let event: CodexJsonEvent = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        match event {
            CodexJsonEvent::TurnFailed { error } => {
                return Err(format!("Codex turn failed: {}", error.message));
            }
            CodexJsonEvent::StreamError { message } => {
                return Err(format!("Codex stream error: {message}"));
            }
            CodexJsonEvent::ItemStarted { item }
            | CodexJsonEvent::ItemUpdated { item }
            | CodexJsonEvent::ItemCompleted { item } => {
                if let CodexItem::AgentMessage(m) = item {
                    last_agent_message_id = Some(m.id.clone());
                    agent_message_text_by_id.insert(m.id, m.text);
                }
            }
            CodexJsonEvent::Other => {}
        }
    }

    let text = last_agent_message_id
        .and_then(|id| agent_message_text_by_id.get(&id).cloned())
        .unwrap_or_default();

    if text.trim().is_empty() {
        return Err("Empty response from Codex CLI".to_string());
    }

    Ok(text)
}

/// Run Codex CLI once, returning the final assistant text.
pub fn run_codex_prompt(
    app: &AppHandle,
    working_dir: &str,
    prompt: &str,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Result<String, String> {
    let codex_path = get_codex_cli_binary_path(app)?;

    if !codex_path.exists() {
        return Err("Codex CLI not installed".to_string());
    }

    let mut cmd = silent_command(&codex_path);
    cmd.args([
        "--ask-for-approval",
        "never",
        "exec",
        "--skip-git-repo-check",
        "--cd",
        working_dir,
    ]);

    if let Some(m) = model.filter(|m| !m.trim().is_empty()) {
        cmd.args(["--model", m]);
    }

    if let Some(effort) = normalize_reasoning_effort(reasoning_effort) {
        cmd.args(["--config", &format!("model_reasoning_effort=\"{effort}\"")]);
    }

    // Always sandbox (read-only). Background tasks should not execute commands.
    cmd.args(["--sandbox", "read-only"]);
    cmd.args(["--json", "-"]);

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Codex CLI: {e}"))?;

    {
        use std::io::Write;
        let stdin = child.stdin.as_mut().ok_or("Failed to open stdin")?;
        write!(stdin, "{prompt}").map_err(|e| format!("Failed to write to stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Codex CLI: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Codex CLI failed (exit code {:?}): stderr={}, stdout={}",
            output.status.code(),
            stderr.trim(),
            stdout.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_final_agent_message(&stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_reasoning_effort_maps_minimal_to_low() {
        assert_eq!(normalize_reasoning_effort(Some("minimal")), Some("low"));
    }

    #[test]
    fn normalize_reasoning_effort_strips_empty() {
        assert_eq!(normalize_reasoning_effort(Some("   ")), None);
    }

    #[test]
    fn normalize_reasoning_effort_passes_through_known_values() {
        assert_eq!(normalize_reasoning_effort(Some("low")), Some("low"));
        assert_eq!(normalize_reasoning_effort(Some("xhigh")), Some("xhigh"));
    }

    #[test]
    fn extract_final_agent_message_returns_last_agent_message_text() {
        let stdout = r#"
{"type":"item.completed","item":{"type":"agent_message","id":"m1","text":"First"}}
{"type":"item.completed","item":{"type":"agent_message","id":"m2","text":"Second"}}
"#;
        assert_eq!(extract_final_agent_message(stdout).unwrap(), "Second");
    }

    #[test]
    fn extract_final_agent_message_handles_incremental_updates() {
        let stdout = r#"
{"type":"item.started","item":{"type":"agent_message","id":"m1","text":""}}
{"type":"item.updated","item":{"type":"agent_message","id":"m1","text":"H"}}
{"type":"item.updated","item":{"type":"agent_message","id":"m1","text":"Hi"}}
{"type":"item.completed","item":{"type":"agent_message","id":"m1","text":"Hi"}}
"#;
        assert_eq!(extract_final_agent_message(stdout).unwrap(), "Hi");
    }

    #[test]
    fn extract_final_agent_message_ignores_non_json_lines() {
        let stdout = r#"
not-json
{"type":"item.completed","item":{"type":"agent_message","id":"m1","text":"OK"}}
"#;
        assert_eq!(extract_final_agent_message(stdout).unwrap(), "OK");
    }

    #[test]
    fn extract_final_agent_message_surfaces_turn_failed() {
        let stdout = r#"
{"type":"turn.failed","error":{"message":"boom"}}
{"type":"item.completed","item":{"type":"agent_message","id":"m1","text":"OK"}}
"#;
        let err = extract_final_agent_message(stdout).unwrap_err();
        assert!(err.contains("Codex turn failed: boom"));
    }

    #[test]
    fn extract_final_agent_message_surfaces_stream_error() {
        let stdout = r#"
{"type":"error","message":"stream broke"}
{"type":"item.completed","item":{"type":"agent_message","id":"m1","text":"OK"}}
"#;
        let err = extract_final_agent_message(stdout).unwrap_err();
        assert!(err.contains("Codex stream error: stream broke"));
    }

    #[test]
    fn extract_final_agent_message_errors_on_empty_text() {
        let stdout = r#"
{"type":"item.completed","item":{"type":"agent_message","id":"m1","text":""}}
"#;
        assert_eq!(
            extract_final_agent_message(stdout).unwrap_err(),
            "Empty response from Codex CLI"
        );
    }
}
