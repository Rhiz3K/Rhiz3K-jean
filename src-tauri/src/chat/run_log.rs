//! Run log storage for JSONL-based persistence
//!
//! This module handles writing and reading JSONL log files that contain
//! the raw Claude CLI output. Each run (Claude execution) gets its own file.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use super::storage::{
    get_session_dir, list_all_session_ids, load_metadata, save_metadata, with_metadata_mut,
};
use super::types::{
    ChatAgent, ChatMessage, ContentBlock, MessageRole, RunEntry, RunStatus, ToolCall, UsageData,
};

// ============================================================================
// Run Log Writer
// ============================================================================

/// Writer for streaming JSONL log output
pub struct RunLogWriter {
    app: tauri::AppHandle,
    session_id: String,
    worktree_id: String,
    session_name: String,
    order: u32,
    run_id: String,
    #[allow(dead_code)] // Will be used when detached streaming is fully connected
    file: File,
}

impl RunLogWriter {
    /// Get the run ID
    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    /// Write a line to the JSONL log file (sync, immediate)
    #[allow(dead_code)] // Will be used when detached streaming is fully connected
    pub fn write_line(&mut self, line: &str) -> Result<(), String> {
        log::trace!(
            "RunLogWriter: writing line ({} bytes) to run {}",
            line.len(),
            self.run_id
        );

        writeln!(self.file, "{line}").map_err(|e| format!("Failed to write to run log: {e}"))?;

        // Flush immediately for crash safety
        self.file
            .flush()
            .map_err(|e| format!("Failed to flush run log: {e}"))?;

        Ok(())
    }

    /// Mark the run as completed and update the metadata
    pub fn complete(
        &mut self,
        assistant_message_id: &str,
        agent: ChatAgent,
        agent_session_id: Option<&str>,
        usage: Option<UsageData>,
    ) -> Result<(), String> {
        let now = now_timestamp();
        let run_id = self.run_id.clone();
        let session_id_for_run = agent_session_id.map(|s| s.to_string());

        with_metadata_mut(
            &self.app,
            &self.session_id,
            &self.worktree_id,
            &self.session_name,
            self.order,
            |metadata| {
                if let Some(run) = metadata.find_run_mut(&run_id) {
                    run.status = RunStatus::Completed;
                    run.ended_at = Some(now);
                    run.assistant_message_id = Some(assistant_message_id.to_string());
                    run.agent = agent.clone();
                    match agent {
                        ChatAgent::Claude => run.claude_session_id = session_id_for_run.clone(),
                        ChatAgent::Codex => run.codex_session_id = session_id_for_run.clone(),
                    }
                    run.usage = usage.clone();
                }

                // Update metadata's session ID for resumption
                if let Some(sid) = session_id_for_run {
                    match agent {
                        ChatAgent::Claude => metadata.claude_session_id = Some(sid),
                        ChatAgent::Codex => metadata.codex_session_id = Some(sid),
                    }
                }

                Ok(())
            },
        )?;

        log::trace!("Run completed: {}", self.run_id);
        Ok(())
    }

    /// Mark the run as cancelled and update the metadata
    pub fn cancel(&mut self, assistant_message_id: Option<&str>) -> Result<(), String> {
        let now = now_timestamp();
        let run_id = self.run_id.clone();
        let asst_id = assistant_message_id.map(|s| s.to_string());

        with_metadata_mut(
            &self.app,
            &self.session_id,
            &self.worktree_id,
            &self.session_name,
            self.order,
            |metadata| {
                if let Some(run) = metadata.find_run_mut(&run_id) {
                    run.status = RunStatus::Cancelled;
                    run.ended_at = Some(now);
                    run.cancelled = true;
                    run.assistant_message_id = asst_id;
                }
                Ok(())
            },
        )?;

        log::trace!("Run cancelled: {}", self.run_id);
        Ok(())
    }

    /// Mark the run as crashed (for recovery)
    #[allow(dead_code)]
    pub fn mark_crashed(&mut self) -> Result<(), String> {
        let now = now_timestamp();
        let run_id = self.run_id.clone();

        with_metadata_mut(
            &self.app,
            &self.session_id,
            &self.worktree_id,
            &self.session_name,
            self.order,
            |metadata| {
                if let Some(run) = metadata.find_run_mut(&run_id) {
                    run.status = RunStatus::Crashed;
                    run.ended_at = Some(now);
                    run.recovered = true;
                }
                Ok(())
            },
        )?;

        log::trace!("Run marked as crashed: {}", self.run_id);
        Ok(())
    }

    /// Set the PID of the detached Claude CLI process
    pub fn set_pid(&mut self, pid: u32) -> Result<(), String> {
        let run_id = self.run_id.clone();

        with_metadata_mut(
            &self.app,
            &self.session_id,
            &self.worktree_id,
            &self.session_name,
            self.order,
            |metadata| {
                if let Some(run) = metadata.find_run_mut(&run_id) {
                    run.pid = Some(pid);
                }
                Ok(())
            },
        )?;

        log::trace!("Set PID {} for run: {}", pid, self.run_id);
        Ok(())
    }

    /// Get the path to the JSONL output file for this run
    pub fn output_file_path(&self) -> Result<PathBuf, String> {
        let session_dir = get_session_dir(&self.app, &self.session_id)?;
        Ok(session_dir.join(format!("{}.jsonl", self.run_id)))
    }

    /// Get the path to the input file for this run
    pub fn input_file_path(&self) -> Result<PathBuf, String> {
        let session_dir = get_session_dir(&self.app, &self.session_id)?;
        Ok(session_dir.join(format!("{}.input.jsonl", self.run_id)))
    }

    /// Get the session ID
    #[allow(dead_code)] // Will be used when detached streaming is fully connected
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Resume an existing run - opens the run for updating its metadata.
    ///
    /// This is used when resuming a detached process that was still running
    /// after the app restarted.
    pub fn resume(app: &tauri::AppHandle, session_id: &str, run_id: &str) -> Result<Self, String> {
        let session_dir = get_session_dir(app, session_id)?;
        let jsonl_path = session_dir.join(format!("{run_id}.jsonl"));

        // Open existing file in append mode
        let file = OpenOptions::new()
            .append(true)
            .open(&jsonl_path)
            .map_err(|e| format!("Failed to open run log file for resume: {e}"))?;

        // Load metadata
        let metadata = load_metadata(app, session_id)?
            .ok_or_else(|| format!("No metadata found for session: {session_id}"))?;

        log::trace!("Resumed RunLogWriter for run: {run_id}");

        Ok(Self {
            app: app.clone(),
            session_id: session_id.to_string(),
            worktree_id: metadata.worktree_id.clone(),
            session_name: metadata.name.clone(),
            order: metadata.order,
            run_id: run_id.to_string(),
            file,
        })
    }

    /// Mark the run as crashed (used when resume fails)
    pub fn crash(&mut self) -> Result<(), String> {
        let now = now_timestamp();
        let run_id = self.run_id.clone();

        with_metadata_mut(
            &self.app,
            &self.session_id,
            &self.worktree_id,
            &self.session_name,
            self.order,
            |metadata| {
                if let Some(run) = metadata.find_run_mut(&run_id) {
                    run.status = RunStatus::Crashed;
                    run.ended_at = Some(now);
                    run.recovered = true;
                    run.assistant_message_id = Some(uuid::Uuid::new_v4().to_string());
                }
                Ok(())
            },
        )?;

        log::trace!("Run marked as crashed: {}", self.run_id);
        Ok(())
    }
}

/// Start a new run - creates JSONL file and updates metadata
#[allow(clippy::too_many_arguments)]
pub fn start_run(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    session_name: &str,
    order: u32,
    user_message_id: &str,
    user_message: &str,
    model: Option<&str>,
    execution_mode: Option<&str>,
    thinking_level: Option<&str>,
    agent: ChatAgent,
) -> Result<RunLogWriter, String> {
    let run_id = Uuid::new_v4().to_string();
    let assistant_message_id = Uuid::new_v4().to_string();
    let now = now_timestamp();

    // Ensure session directory exists
    let session_dir = get_session_dir(app, session_id)?;

    // Create JSONL file
    let jsonl_path = session_dir.join(format!("{run_id}.jsonl"));
    log::trace!("Creating run log file at: {jsonl_path:?}");
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&jsonl_path)
        .map_err(|e| format!("Failed to create run log file: {e}"))?;

    // Write metadata header as first line (ensures file is never empty)
    let meta = serde_json::json!({
        "_run_meta": true,
        "run_id": run_id,
        "session_id": session_id,
        "worktree_id": worktree_id,
        "user_message_id": user_message_id,
        "agent": agent,
        "model": model,
        "execution_mode": execution_mode,
        "thinking_level": thinking_level,
        "started_at": now,
    });
    writeln!(file, "{meta}").map_err(|e| format!("Failed to write run log header: {e}"))?;
    file.flush()
        .map_err(|e| format!("Failed to flush run log header: {e}"))?;
    log::trace!("Run log file created with metadata header");

    // Add run entry to metadata
    let run_entry = RunEntry {
        run_id: run_id.clone(),
        user_message_id: user_message_id.to_string(),
        user_message: user_message.to_string(),
        model: model.map(|s| s.to_string()),
        execution_mode: execution_mode.map(|s| s.to_string()),
        thinking_level: thinking_level.map(|s| s.to_string()),
        started_at: now,
        ended_at: None,
        status: RunStatus::Running,
        // Assign upfront so resumable runs have a stable assistant message ID
        // (avoids the UI message flickering/disappearing across reloads).
        assistant_message_id: Some(assistant_message_id),
        cancelled: false,
        recovered: false,
        agent,
        claude_session_id: None,
        codex_session_id: None,
        pid: None,   // Set later via set_pid() after spawning detached process
        usage: None, // Set on completion via complete()
    };

    with_metadata_mut(
        app,
        session_id,
        worktree_id,
        session_name,
        order,
        |metadata| {
            metadata.runs.push(run_entry.clone());
            Ok(())
        },
    )?;

    log::trace!(
        "Started run {} for session {} (user_message_id: {})",
        run_id,
        session_id,
        user_message_id
    );

    Ok(RunLogWriter {
        app: app.clone(),
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        session_name: session_name.to_string(),
        order,
        run_id,
        file,
    })
}

/// Write the input file for a detached Claude CLI run.
///
/// The input file contains the user message in stream-json format,
/// which Claude CLI reads via stdin redirection.
pub fn write_input_file(
    app: &tauri::AppHandle,
    session_id: &str,
    run_id: &str,
    message: &str,
) -> Result<PathBuf, String> {
    let session_dir = get_session_dir(app, session_id)?;
    let input_path = session_dir.join(format!("{run_id}.input.jsonl"));

    log::trace!("Writing input file at: {input_path:?}");

    // Create the stream-json input message format
    let input_message = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": message
        }
    });

    let mut file =
        File::create(&input_path).map_err(|e| format!("Failed to create input file: {e}"))?;

    writeln!(file, "{input_message}").map_err(|e| format!("Failed to write input message: {e}"))?;

    file.flush()
        .map_err(|e| format!("Failed to flush input file: {e}"))?;

    log::trace!("Input file written successfully");

    Ok(input_path)
}

/// Write the input file for a detached Codex CLI run.
///
/// Codex accepts the prompt from stdin when you pass `-` as the PROMPT argument.
/// We write the prompt content verbatim to the input file.
pub fn write_codex_input_file(
    app: &tauri::AppHandle,
    session_id: &str,
    run_id: &str,
    message: &str,
    execution_mode: Option<&str>,
    ai_language: Option<&str>,
    parallel_execution_prompt_enabled: bool,
) -> Result<PathBuf, String> {
    let session_dir = get_session_dir(app, session_id)?;
    let input_path = session_dir.join(format!("{run_id}.input.jsonl"));

    log::trace!("Writing Codex input file at: {input_path:?}");

    let mut prompt = String::new();

    if let Some(lang) = ai_language {
        let lang = lang.trim();
        if !lang.is_empty() {
            prompt.push_str(&format!("Respond to the user in {}.\n\n", lang));
        }
    }

    if parallel_execution_prompt_enabled {
        prompt.push_str(
            "In plan mode, structure plans so tasks can be done simultaneously. \
In build/execute mode, try to parallelize work for faster implementation.\n\n",
        );
    }

    // Sandbox/network behavior
    //
    // Jean runs Codex with a sandbox in plan/build modes. In some environments this blocks
    // outbound network access, so commands that hit GitHub APIs (e.g. `gh repo list`) will fail.
    // In yolo mode we bypass the sandbox.
    match execution_mode.unwrap_or("plan") {
        "yolo" => {}
        _ => {
            prompt.push_str(
                "Note: In this mode, outbound network access may be blocked by the sandbox. \
Avoid using `gh`/GitHub API calls here. If GitHub data is required, ask the user to: \
(1) switch to YOLO mode, or (2) run the command externally and paste the output.\n\n",
            );
        }
    }

    prompt.push_str(message);
    if !prompt.ends_with('\n') {
        prompt.push('\n');
    }

    std::fs::write(&input_path, prompt)
        .map_err(|e| format!("Failed to write Codex input file: {e}"))?;

    Ok(input_path)
}

/// Delete the input file for a run (cleanup after completion).
pub fn delete_input_file(
    app: &tauri::AppHandle,
    session_id: &str,
    run_id: &str,
) -> Result<(), String> {
    let session_dir = get_session_dir(app, session_id)?;
    let input_path = session_dir.join(format!("{run_id}.input.jsonl"));

    if input_path.exists() {
        fs::remove_file(&input_path).map_err(|e| format!("Failed to delete input file: {e}"))?;
        log::trace!("Deleted input file: {input_path:?}");
    }

    Ok(())
}

// ============================================================================
// Run Log Reader & Parser
// ============================================================================

/// Get the path to a run's JSONL file
pub fn get_run_log_path(
    app: &tauri::AppHandle,
    session_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    let session_dir = get_session_dir(app, session_id)?;
    Ok(session_dir.join(format!("{run_id}.jsonl")))
}

/// Read all lines from a run's JSONL file
pub fn read_run_log(
    app: &tauri::AppHandle,
    session_id: &str,
    run_id: &str,
) -> Result<Vec<String>, String> {
    let path = get_run_log_path(app, session_id, run_id)?;

    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&path).map_err(|e| format!("Failed to open run log: {e}"))?;

    let reader = BufReader::new(file);
    let lines: Result<Vec<_>, _> = reader.lines().collect();

    lines.map_err(|e| format!("Failed to read run log: {e}"))
}

/// Parse JSONL lines and build a ChatMessage
/// This replicates the parsing logic from execute_claude_streaming
pub fn parse_run_to_message(lines: &[String], run: &RunEntry) -> Result<ChatMessage, String> {
    match run.agent {
        ChatAgent::Claude => parse_claude_run_to_message(lines, run),
        ChatAgent::Codex => parse_codex_run_to_message(lines, run),
    }
}

fn parse_claude_run_to_message(lines: &[String], run: &RunEntry) -> Result<ChatMessage, String> {
    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();
    let mut current_parent_tool_use_id: Option<String> = None;

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let msg: serde_json::Value = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        // Skip metadata header line (has _run_meta: true)
        if msg
            .get("_run_meta")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }

        // Track parent_tool_use_id for sub-agent tool calls
        if let Some(parent_id) = msg.get("parent_tool_use_id").and_then(|v| v.as_str()) {
            current_parent_tool_use_id = Some(parent_id.to_string());
        }

        let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match msg_type {
            "assistant" => {
                if let Some(message) = msg.get("message") {
                    if let Some(blocks) = message.get("content").and_then(|c| c.as_array()) {
                        for block in blocks {
                            let block_type =
                                block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                            match block_type {
                                "text" => {
                                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                        // Skip CLI placeholder text emitted when extended
                                        // thinking starts before any real text content
                                        if text == "(no content)" {
                                            continue;
                                        }
                                        content.push_str(text);
                                        content_blocks.push(ContentBlock::Text {
                                            text: text.to_string(),
                                        });
                                    }
                                }
                                "tool_use" => {
                                    let id = block
                                        .get("id")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let name = block
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let input = block
                                        .get("input")
                                        .cloned()
                                        .unwrap_or(serde_json::Value::Null);

                                    tool_calls.push(ToolCall {
                                        id: id.clone(),
                                        name,
                                        input,
                                        output: None,
                                        parent_tool_use_id: current_parent_tool_use_id.clone(),
                                    });

                                    content_blocks.push(ContentBlock::ToolUse { tool_call_id: id });
                                }
                                "thinking" => {
                                    if let Some(thinking) =
                                        block.get("thinking").and_then(|v| v.as_str())
                                    {
                                        content_blocks.push(ContentBlock::Thinking {
                                            thinking: thinking.to_string(),
                                        });
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            "user" => {
                // User messages contain tool results
                if let Some(message) = msg.get("message") {
                    if let Some(blocks) = message.get("content").and_then(|c| c.as_array()) {
                        for block in blocks {
                            let block_type =
                                block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                            if block_type == "tool_result" {
                                let tool_id = block
                                    .get("tool_use_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let output =
                                    block.get("content").and_then(|v| v.as_str()).unwrap_or("");

                                // Update matching tool call's output
                                if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                    tc.output = Some(output.to_string());
                                }
                            }
                        }
                    }
                }
            }
            "result" => {
                // Use result if we somehow missed content
                if content.is_empty() {
                    if let Some(result) = msg.get("result").and_then(|v| v.as_str()) {
                        content = result.to_string();
                    }
                }
            }
            _ => {}
        }
    }

    Ok(ChatMessage {
        id: run
            .assistant_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        session_id: String::new(), // Will be set by caller
        role: MessageRole::Assistant,
        content,
        timestamp: run.started_at,
        tool_calls,
        content_blocks,
        cancelled: run.cancelled,
        plan_approved: false,
        model: None,
        execution_mode: None,
        thinking_level: None,
        recovered: run.recovered,
        usage: run.usage.clone(), // Token usage from metadata
    })
}

fn parse_codex_run_to_message(lines: &[String], run: &RunEntry) -> Result<ChatMessage, String> {
    use super::codex_exec::CodexExecEvent;
    use std::collections::HashMap;

    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();

    let mut agent_message_seen: HashMap<String, String> = HashMap::new();
    let mut reasoning_seen: HashMap<String, String> = HashMap::new();
    let mut todo_list_seen: HashMap<String, String> = HashMap::new();
    let mut todo_list_seq: HashMap<String, usize> = HashMap::new();

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        if line.contains("\"_run_meta\"") {
            continue;
        }

        let event: CodexExecEvent = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        match event {
            CodexExecEvent::ItemStarted { item }
            | CodexExecEvent::ItemUpdated { item }
            | CodexExecEvent::ItemCompleted { item } => {
                apply_codex_item_to_message(
                    &item,
                    &mut content,
                    &mut tool_calls,
                    &mut content_blocks,
                    &mut agent_message_seen,
                    &mut reasoning_seen,
                    &mut todo_list_seen,
                    &mut todo_list_seq,
                );
            }
            CodexExecEvent::ThreadStarted { .. }
            | CodexExecEvent::TurnStarted
            | CodexExecEvent::TurnCompleted { .. }
            | CodexExecEvent::TurnFailed { .. }
            | CodexExecEvent::StreamError { .. } => {}
        }
    }

    Ok(ChatMessage {
        id: run
            .assistant_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        session_id: String::new(), // Will be set by caller
        role: MessageRole::Assistant,
        content,
        timestamp: run.started_at,
        tool_calls,
        content_blocks,
        cancelled: run.cancelled,
        plan_approved: false,
        model: None,
        execution_mode: None,
        thinking_level: None,
        recovered: run.recovered,
        usage: run.usage.clone(),
    })
}

fn apply_codex_item_to_message(
    item: &super::codex_exec::CodexThreadItem,
    content: &mut String,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    agent_message_seen: &mut std::collections::HashMap<String, String>,
    reasoning_seen: &mut std::collections::HashMap<String, String>,
    todo_list_seen: &mut std::collections::HashMap<String, String>,
    todo_list_seq: &mut std::collections::HashMap<String, usize>,
) {
    match item {
        super::codex_exec::CodexThreadItem::AgentMessage(m) => {
            let prev = agent_message_seen.entry(m.id.clone()).or_default();
            let new_text = &m.text;

            if new_text.starts_with(prev.as_str()) {
                let delta = &new_text[prev.len()..];
                if !delta.is_empty() {
                    content.push_str(delta);
                    content_blocks.push(ContentBlock::Text {
                        text: delta.to_string(),
                    });
                }
            } else if !new_text.is_empty() && new_text != prev.as_str() {
                content.push_str(new_text);
                content_blocks.push(ContentBlock::Text {
                    text: new_text.to_string(),
                });
            }

            *prev = new_text.to_string();
        }
        super::codex_exec::CodexThreadItem::Reasoning(r) => {
            let prev = reasoning_seen.entry(r.id.clone()).or_default();
            let new_text = &r.text;

            if new_text.starts_with(prev.as_str()) {
                let delta = &new_text[prev.len()..];
                if !delta.is_empty() {
                    content_blocks.push(ContentBlock::Thinking {
                        thinking: delta.to_string(),
                    });
                }
            } else if !new_text.is_empty() && new_text != prev.as_str() {
                content_blocks.push(ContentBlock::Thinking {
                    thinking: new_text.to_string(),
                });
            }

            *prev = new_text.to_string();
        }
        super::codex_exec::CodexThreadItem::CommandExecution(cmd) => {
            let tool_id = cmd.id.clone();
            let tool_name = "Bash".to_string();
            let input = serde_json::json!({ "command": cmd.command });
            ensure_tool_call_for_message(tool_calls, content_blocks, &tool_id, &tool_name, input);

            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                tc.output = Some(cmd.aggregated_output.clone());
            }
        }
        super::codex_exec::CodexThreadItem::FileChange(fc) => {
            if fc.changes.len() <= 1 {
                let tool_id = fc.id.clone();
                let tool_name = "Edit".to_string();
                let input = fc
                    .changes
                    .first()
                    .map(|c| serde_json::json!({ "file_path": c.path, "kind": c.kind }))
                    .unwrap_or_else(|| {
                        let changes: Vec<serde_json::Value> = fc
                            .changes
                            .iter()
                            .map(|c| serde_json::json!({ "path": c.path, "kind": c.kind }))
                            .collect();
                        serde_json::json!({ "changes": changes })
                    });
                ensure_tool_call_for_message(
                    tool_calls,
                    content_blocks,
                    &tool_id,
                    &tool_name,
                    input,
                );
                if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                    tc.output = Some(format!("status: {}", fc.status));
                }
            } else {
                for (idx, change) in fc.changes.iter().enumerate() {
                    let tool_id = format!("{}:{}", fc.id, idx);
                    let tool_name = "Edit".to_string();
                    let input =
                        serde_json::json!({ "file_path": change.path, "kind": change.kind });
                    ensure_tool_call_for_message(
                        tool_calls,
                        content_blocks,
                        &tool_id,
                        &tool_name,
                        input,
                    );
                    if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                        tc.output = Some(format!("status: {}", fc.status));
                    }
                }
            }
        }
        super::codex_exec::CodexThreadItem::McpToolCall(tc) => {
            let tool_id = tc.id.clone();
            let tool_name = format!("MCP:{}:{}", tc.server, tc.tool);
            let input = tc.arguments.clone();
            ensure_tool_call_for_message(tool_calls, content_blocks, &tool_id, &tool_name, input);

            if let Some(tc_msg) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                if let Some(result) = &tc.result {
                    tc_msg.output = Some(
                        serde_json::to_string_pretty(&result.structured_content)
                            .unwrap_or_else(|_| "(failed to serialize result)".to_string()),
                    );
                } else if let Some(err) = &tc.error {
                    tc_msg.output = Some(format!("error: {}", err.message));
                }
            }
        }
        super::codex_exec::CodexThreadItem::WebSearch(ws) => {
            let tool_id = ws.id.clone();
            let tool_name = "WebSearch".to_string();
            let input = serde_json::json!({ "query": ws.query });
            ensure_tool_call_for_message(tool_calls, content_blocks, &tool_id, &tool_name, input);
        }
        super::codex_exec::CodexThreadItem::TodoList(todo) => {
            let tool_name = "TodoWrite".to_string();
            let mapped_todos: Vec<serde_json::Value> = todo
                .items
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "content": t.text,
                        "activeForm": t.text,
                        "status": if t.completed { "completed" } else { "pending" },
                    })
                })
                .collect();
            let input = serde_json::json!({ "todos": mapped_todos });

            // Codex reuses the same todo_list ID while updating items. When reconstructing
            // a message from NDJSON, preserve each distinct snapshot with a unique tool id
            // so the UI can pick the latest TodoWrite.
            let snapshot = serde_json::to_string(&input).unwrap_or_default();
            if todo_list_seen
                .get(&todo.id)
                .map(|prev| prev == &snapshot)
                .unwrap_or(false)
            {
                return;
            }
            todo_list_seen.insert(todo.id.clone(), snapshot);

            let seq = todo_list_seq.entry(todo.id.clone()).or_insert(0);
            *seq += 1;
            let tool_id = format!("{}:{}", todo.id, seq);

            ensure_tool_call_for_message(tool_calls, content_blocks, &tool_id, &tool_name, input);
        }
        super::codex_exec::CodexThreadItem::Error(_) => {}
    }
}

fn ensure_tool_call_for_message(
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    id: &str,
    name: &str,
    input: serde_json::Value,
) {
    if tool_calls.iter().any(|t| t.id == id) {
        return;
    }

    tool_calls.push(ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        input,
        output: None,
        parent_tool_use_id: None,
    });

    content_blocks.push(ContentBlock::ToolUse {
        tool_call_id: id.to_string(),
    });
}

// ============================================================================
// Message Loading
// ============================================================================

/// Load all messages for a session by parsing JSONL files
/// Returns messages in chronological order (user message, then assistant response)
pub fn load_session_messages(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let metadata = match load_metadata(app, session_id)? {
        Some(m) => m,
        None => return Ok(vec![]),
    };

    let mut messages = Vec::new();

    for run in &metadata.runs {
        // Skip user message for instant-cancelled runs (undo_send)
        // These have Cancelled status but no assistant_message_id
        let is_undo_send = run.status == RunStatus::Cancelled && run.assistant_message_id.is_none();

        if !is_undo_send {
            // Add user message
            messages.push(ChatMessage {
                id: run.user_message_id.clone(),
                session_id: session_id.to_string(),
                role: MessageRole::User,
                content: run.user_message.clone(),
                timestamp: run.started_at,
                tool_calls: vec![],
                content_blocks: vec![],
                cancelled: false,
                plan_approved: false,
                model: run.model.clone(),
                execution_mode: run.execution_mode.clone(),
                thinking_level: run.thinking_level.clone(),
                recovered: false,
                usage: None, // User messages don't have token usage
            });
        }

        // Add assistant message if run has completed/cancelled/crashed
        if run.status != RunStatus::Running && !is_undo_send {
            let lines = read_run_log(app, session_id, &run.run_id)?;

            // Parse JSONL content (may only have metadata header if crashed early)
            let mut assistant_msg = parse_run_to_message(&lines, run)?;
            assistant_msg.session_id = session_id.to_string();

            // For crashed runs with no content (only metadata header), add placeholder
            if run.status == RunStatus::Crashed
                && assistant_msg.content.is_empty()
                && assistant_msg.tool_calls.is_empty()
            {
                assistant_msg.content =
                    "*Response lost - Jean was closed before receiving a response.*".to_string();
            }

            messages.push(assistant_msg);
        }
    }

    Ok(messages)
}

/// Mark any running run for this session as cancelled (called by cancel_process)
/// This is called synchronously when the user cancels, before emitting chat:cancelled event.
/// This ensures the metadata is updated immediately, not after tail_claude_output times out.
pub fn mark_running_run_cancelled(app: &tauri::AppHandle, session_id: &str) -> Result<(), String> {
    let mut metadata = match load_metadata(app, session_id)? {
        Some(m) => m,
        None => return Ok(()), // No metadata = nothing to cancel
    };

    let now = now_timestamp();
    let mut modified = false;

    for run in &mut metadata.runs {
        if run.status == RunStatus::Running {
            run.status = RunStatus::Cancelled;
            run.ended_at = Some(now);
            run.cancelled = true;
            // Leave assistant_message_id as None (undo_send case)
            modified = true;
            log::trace!(
                "Marked run {} as cancelled for session {}",
                run.run_id,
                session_id
            );
        }
    }

    if modified {
        save_metadata(app, &metadata)?;
    }

    Ok(())
}

// ============================================================================
// Recovery Functions
// ============================================================================

/// Info about a recovered run
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecoveredRun {
    pub session_id: String,
    pub worktree_id: String,
    pub run_id: String,
    pub user_message: String,
    /// True if the process is still running and can be resumed
    pub resumable: bool,
}

/// Check for and recover incomplete runs across all sessions
/// Called on app startup to handle crashed runs from previous session
pub fn recover_incomplete_runs(app: &tauri::AppHandle) -> Result<Vec<RecoveredRun>, String> {
    use super::detached::is_process_alive;

    let session_ids = list_all_session_ids(app)?;
    let mut recovered = Vec::new();

    for session_id in session_ids {
        let mut metadata = match load_metadata(app, &session_id)? {
            Some(m) => m,
            None => continue,
        };

        let mut modified = false;

        for run in &mut metadata.runs {
            if run.status == RunStatus::Running {
                // Check if the detached process is still running
                let process_alive = run.pid.map(is_process_alive).unwrap_or(false);

                if process_alive {
                    // Process is still running - mark as resumable so we can tail it
                    run.status = RunStatus::Resumable;
                    modified = true;

                    recovered.push(RecoveredRun {
                        session_id: session_id.clone(),
                        worktree_id: metadata.worktree_id.clone(),
                        run_id: run.run_id.clone(),
                        user_message: run.user_message.clone(),
                        resumable: true,
                    });

                    log::trace!(
                        "Found resumable run: {} in session {} (PID: {:?})",
                        run.run_id,
                        session_id,
                        run.pid
                    );
                } else {
                    // Process is dead - mark as crashed
                    run.status = RunStatus::Crashed;
                    run.ended_at = Some(now_timestamp());
                    run.recovered = true;
                    run.assistant_message_id = Some(Uuid::new_v4().to_string());
                    modified = true;

                    recovered.push(RecoveredRun {
                        session_id: session_id.clone(),
                        worktree_id: metadata.worktree_id.clone(),
                        run_id: run.run_id.clone(),
                        user_message: run.user_message.clone(),
                        resumable: false,
                    });

                    log::trace!(
                        "Recovered crashed run: {} in session {} (user message: {})",
                        run.run_id,
                        session_id,
                        run.user_message.chars().take(50).collect::<String>()
                    );
                }
            }
        }

        if modified {
            save_metadata(app, &metadata)?;
        }
    }

    if !recovered.is_empty() {
        log::trace!(
            "Recovered {} crashed run(s) from previous session",
            recovered.len()
        );
    }

    Ok(recovered)
}

/// Find all runs with status = Running (incomplete runs that need recovery)
#[allow(dead_code)]
pub fn find_incomplete_runs(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<Vec<RunEntry>, String> {
    let metadata = match load_metadata(app, session_id)? {
        Some(m) => m,
        None => return Ok(vec![]),
    };

    let incomplete: Vec<RunEntry> = metadata
        .runs
        .into_iter()
        .filter(|r| r.status == RunStatus::Running)
        .collect();

    Ok(incomplete)
}

/// Mark a run as crashed and recovered
#[allow(dead_code)]
pub fn mark_run_as_crashed(
    app: &tauri::AppHandle,
    session_id: &str,
    run_id: &str,
) -> Result<(), String> {
    let mut metadata = load_metadata(app, session_id)?
        .ok_or_else(|| format!("Metadata not found for session: {session_id}"))?;

    let now = now_timestamp();

    if let Some(run) = metadata.find_run_mut(run_id) {
        run.status = RunStatus::Crashed;
        run.ended_at = Some(now);
        run.recovered = true;
        run.assistant_message_id = Some(Uuid::new_v4().to_string());
    }

    save_metadata(app, &metadata)?;
    Ok(())
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/// Delete all JSONL files for a session (called when deleting session)
#[allow(dead_code)]
pub fn delete_run_logs(app: &tauri::AppHandle, session_id: &str) -> Result<usize, String> {
    let session_dir = get_session_dir(app, session_id)?;

    let mut deleted = 0;

    if session_dir.exists() {
        for entry in fs::read_dir(&session_dir)
            .map_err(|e| format!("Failed to read session directory: {e}"))?
            .flatten()
        {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "jsonl") {
                fs::remove_file(&path).map_err(|e| format!("Failed to delete run log: {e}"))?;
                deleted += 1;
            }
        }
    }

    Ok(deleted)
}

// ============================================================================
// Utility Functions
// ============================================================================

fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
