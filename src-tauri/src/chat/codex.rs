use std::collections::HashMap;

use tauri::Emitter;

use super::codex_exec::{CodexExecEvent, CodexThreadItem};
use super::events::{
    CancelledEvent, ChunkEvent, DoneEvent, ErrorEvent, ThinkingEvent, ToolBlockEvent,
    ToolResultEvent, ToolUseEvent,
};
use super::types::{ChatAgent, ContentBlock, ThinkingLevel, ToolCall, UsageData};

/// Response from Codex CLI execution
pub struct CodexResponse {
    /// The text response from Codex
    pub content: String,
    /// The session/thread ID (for resuming conversations)
    pub session_id: String,
    /// Tool calls made during this response (mapped from Codex items)
    pub tool_calls: Vec<ToolCall>,
    /// Ordered content blocks preserving tool position in response
    pub content_blocks: Vec<ContentBlock>,
    /// Whether the response was cancelled by the user
    pub cancelled: bool,
    /// Token usage for this response
    pub usage: Option<UsageData>,
}

// =============================================================================
// Detached Codex CLI execution
// =============================================================================

/// Build CLI arguments for Codex CLI `exec`.
///
/// Returns a tuple of (args, env_vars) where env_vars are (key, value) pairs.
#[allow(clippy::too_many_arguments)]
fn build_codex_args(
    session_id: &str,
    worktree_id: &str,
    existing_codex_session_id: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&ThinkingLevel>,
    execution_mode: Option<&str>,
    working_dir: &std::path::Path,
    ai_language: Option<&str>,
) -> (Vec<String>, Vec<(String, String)>) {
    let mut args = Vec::new();
    let mut env_vars = Vec::new();

    // Global flags (must appear before `exec`)
    //
    // Jean runs Codex in detached/non-interactive mode, so we must never block
    // waiting for interactive approvals.
    args.push("--ask-for-approval".to_string());
    args.push("never".to_string());

    // Command: codex exec ...
    args.push("exec".to_string());

    // Allow running outside a Git repository (some worktrees may not be git repos)
    args.push("--skip-git-repo-check".to_string());

    // Make sure Codex operates on the intended workspace
    args.push("--cd".to_string());
    args.push(working_dir.to_string_lossy().to_string());

    // Model override (only if passed and non-empty)
    if let Some(m) = model {
        let m = m.trim();
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(m.to_string());
        }
    }

    // Reasoning effort override (Codex config)
    if let Some(level) = reasoning_effort {
        if let Some(effort) = level.codex_reasoning_effort() {
            args.push("--config".to_string());
            args.push(format!("model_reasoning_effort=\"{effort}\""));
        }
    }

    // Permission/sandbox mapping
    // - plan: read-only sandbox
    // - build: workspace-write sandbox
    // - yolo: bypass approvals + sandbox (no sandbox; dangerous)
    match execution_mode.unwrap_or("plan") {
        "build" => {
            args.push("--sandbox".to_string());
            args.push("workspace-write".to_string());
        }
        "yolo" => {
            args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        }
        _ => {
            args.push("--sandbox".to_string());
            args.push("read-only".to_string());
        }
    }

    // Ensure machine-readable streaming output for both `exec` and `exec resume`.
    //
    // Note: `--json` is an `exec` option. When resuming, it MUST appear before the
    // `resume` subcommand token (otherwise the CLI treats it as a `resume` option).
    args.push("--json".to_string());

    // Resume if we have a session/thread id
    //
    // Important: `exec resume` accepts fewer flags than `exec`, so we place all
    // exec-level options (like `--cd` and `--sandbox`) BEFORE the `resume` token.
    if let Some(sid) = existing_codex_session_id {
        args.push("resume".to_string());
        args.push(sid.to_string());
    }

    // Prompt comes from stdin ("-")
    // Include an optional language hint in the prompt stream by prefixing the
    // input file content (handled in run_log::write_codex_input_file).
    args.push("-".to_string());

    // Debug env vars (useful when inspecting spawned processes)
    env_vars.push(("JEAN_SESSION_ID".to_string(), session_id.to_string()));
    env_vars.push(("JEAN_WORKTREE_ID".to_string(), worktree_id.to_string()));
    env_vars.push((
        "JEAN_AGENT".to_string(),
        format!("{:?}", ChatAgent::Codex).to_lowercase(),
    ));
    if let Some(lang) = ai_language {
        env_vars.push(("JEAN_AI_LANGUAGE".to_string(), lang.to_string()));
    }

    (args, env_vars)
}

/// Execute Codex CLI in detached mode.
///
/// Spawns Codex CLI as a fully detached process that survives Jean quitting.
/// The process reads the prompt from stdin (our input file) and writes JSONL
/// events to stdout, which we append to the run's output file.
#[allow(clippy::too_many_arguments)]
pub fn execute_codex_detached(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    input_file: &std::path::Path,
    output_file: &std::path::Path,
    working_dir: &std::path::Path,
    existing_codex_session_id: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&ThinkingLevel>,
    execution_mode: Option<&str>,
    ai_language: Option<&str>,
) -> Result<(u32, CodexResponse), String> {
    use super::detached::spawn_detached_codex;
    use crate::codex_cli::get_codex_cli_binary_path;

    log::trace!("Executing Codex CLI (detached) for session: {session_id}");
    log::trace!("Input file: {input_file:?}");
    log::trace!("Output file: {output_file:?}");
    log::trace!("Working directory: {working_dir:?}");

    // Get CLI path
    let cli_path = get_codex_cli_binary_path(app).map_err(|e| {
        let error_msg = format!(
            "Failed to get Codex CLI path: {e}. Please complete setup in Settings > Advanced."
        );
        log::error!("{error_msg}");
        let error_event = ErrorEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            error: error_msg.clone(),
        };
        let _ = app.emit("chat:error", &error_event);
        error_msg
    })?;

    if !cli_path.exists() {
        let error_msg =
            "Codex CLI not installed. Please complete setup in Settings > Advanced.".to_string();
        log::error!("{error_msg}");
        let error_event = ErrorEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            error: error_msg.clone(),
        };
        let _ = app.emit("chat:error", &error_event);
        return Err(error_msg);
    }

    // Build args
    let (args, env_vars) = build_codex_args(
        session_id,
        worktree_id,
        existing_codex_session_id,
        model,
        reasoning_effort,
        execution_mode,
        working_dir,
        ai_language,
    );

    log::debug!(
        "Codex CLI command: {} {}",
        cli_path.display(),
        args.join(" ")
    );

    let env_refs: Vec<(&str, &str)> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    // Spawn detached process
    let pid = spawn_detached_codex(
        &cli_path,
        &args,
        input_file,
        output_file,
        working_dir,
        &env_refs,
    )?;

    log::trace!("Detached Codex CLI spawned with PID: {pid}");

    // Register the process for cancellation
    super::registry::register_process(session_id.to_string(), pid);

    // Tail the output file for real-time updates
    let response = match tail_codex_output(app, session_id, worktree_id, output_file, pid) {
        Ok(resp) => {
            super::registry::unregister_process(session_id);
            resp
        }
        Err(e) => {
            super::registry::unregister_process(session_id);
            return Err(e);
        }
    };

    Ok((pid, response))
}

// =============================================================================
// File-based tailing for detached Codex CLI
// =============================================================================

/// Tail an NDJSON output file and emit events as new lines appear.
///
/// Returns when:
/// - A `turn.completed` or `turn.failed` event is received
/// - The process is no longer running and no new output (timeout)
/// - An error occurs
pub fn tail_codex_output(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    output_file: &std::path::Path,
    pid: u32,
) -> Result<CodexResponse, String> {
    use super::detached::is_process_alive;
    use super::tail::{NdjsonTailer, POLL_INTERVAL};
    use std::io::{Read, Seek, SeekFrom};
    use std::time::{Duration, Instant};

    log::trace!("Starting to tail Codex NDJSON output for session: {session_id}");
    log::trace!("Output file: {output_file:?}, PID: {pid}");

    fn read_stderr_tail(stderr_file: &std::path::Path) -> Option<String> {
        let mut file = std::fs::File::open(stderr_file).ok()?;
        let len = file.metadata().ok()?.len();
        // Read a small tail chunk to avoid loading huge logs into memory.
        let start = len.saturating_sub(8 * 1024);
        file.seek(SeekFrom::Start(start)).ok()?;

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).ok()?;

        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim_end)
            .filter(|l| !l.trim().is_empty())
            .collect();
        if lines.is_empty() {
            return None;
        }

        let tail_lines = lines.iter().rev().take(10).cloned().collect::<Vec<_>>();
        Some(tail_lines.into_iter().rev().collect::<Vec<_>>().join("\n"))
    }

    let mut tailer = NdjsonTailer::new_from_start(output_file)?;

    let mut full_content = String::new();
    let mut codex_session_id = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();

    // Track incremental text for agent_message items
    let mut agent_message_seen: HashMap<String, String> = HashMap::new();
    // Track incremental text for reasoning items
    let mut reasoning_seen: HashMap<String, String> = HashMap::new();
    // Track TodoWrite snapshots so we only emit when changed
    let mut todo_list_seen: HashMap<String, String> = HashMap::new();
    // Per-todo-list sequence to generate unique tool IDs for updates
    let mut todo_list_seq: HashMap<String, usize> = HashMap::new();

    let mut completed = false;
    let mut cancelled = false;
    let mut usage: Option<UsageData> = None;
    let mut failure_error: Option<String> = None;
    let stderr_file = output_file.with_extension("stderr.log");

    // Timeout configuration (mirrors Claude tailer)
    let startup_timeout = Duration::from_secs(120);
    let dead_process_timeout = Duration::from_secs(2);
    let started_at = Instant::now();
    let mut last_output_time = Instant::now();
    let mut received_codex_output = false;

    loop {
        let lines = tailer.poll()?;

        if !lines.is_empty() {
            last_output_time = Instant::now();
        }

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }

            // Skip run metadata header (our own)
            if line.contains("\"_run_meta\"") {
                continue;
            }

            if !received_codex_output {
                log::trace!("Received first Codex output for session: {session_id}");
                received_codex_output = true;
            }

            let event: CodexExecEvent = match serde_json::from_str(&line) {
                Ok(e) => e,
                Err(e) => {
                    log::trace!("Failed to parse Codex event line: {e}");
                    continue;
                }
            };

            match event {
                CodexExecEvent::ThreadStarted { thread_id } => {
                    if !thread_id.is_empty() {
                        codex_session_id = thread_id;
                    }
                }
                CodexExecEvent::TurnCompleted { usage: u } => {
                    usage = Some(UsageData {
                        input_tokens: u.input_tokens,
                        output_tokens: u.output_tokens,
                        cache_read_input_tokens: u.cached_input_tokens,
                        cache_creation_input_tokens: 0,
                    });
                    completed = true;
                }
                CodexExecEvent::TurnFailed { error } => {
                    let error_msg = format!("Codex turn failed: {}", error.message);
                    log::error!("{error_msg}");
                    let error_event = ErrorEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        error: error_msg.clone(),
                    };
                    let _ = app.emit("chat:error", &error_event);
                    return Err(error_msg);
                }
                CodexExecEvent::StreamError { message } => {
                    let error_msg = format!("Codex stream error: {message}");
                    log::error!("{error_msg}");
                    let error_event = ErrorEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        error: error_msg.clone(),
                    };
                    let _ = app.emit("chat:error", &error_event);
                    return Err(error_msg);
                }
                CodexExecEvent::ItemStarted { item }
                | CodexExecEvent::ItemUpdated { item }
                | CodexExecEvent::ItemCompleted { item } => {
                    handle_codex_item_event(
                        app,
                        session_id,
                        worktree_id,
                        &item,
                        &mut full_content,
                        &mut codex_session_id,
                        &mut tool_calls,
                        &mut content_blocks,
                        &mut agent_message_seen,
                        &mut reasoning_seen,
                        &mut todo_list_seen,
                        &mut todo_list_seq,
                    );
                }
                CodexExecEvent::TurnStarted => {}
            }
        }

        if completed {
            break;
        }

        // External cancellation
        if !super::registry::is_process_running(session_id) {
            log::trace!("Session {session_id} cancelled externally, stopping Codex tail");
            cancelled = true;
            break;
        }

        let process_alive = is_process_alive(pid);

        if received_codex_output {
            if !process_alive && last_output_time.elapsed() > dead_process_timeout {
                log::trace!(
                    "Process {pid} is no longer running and no new output after receiving content"
                );
                let stderr_tail = read_stderr_tail(&stderr_file);
                let mut msg = format!(
                    "Codex process exited unexpectedly and stopped streaming output. (stderr: {})",
                    stderr_file.display()
                );
                if let Some(tail) = stderr_tail {
                    msg.push_str("\n\nstderr (tail):\n");
                    msg.push_str(&tail);
                }
                failure_error = Some(msg);
                cancelled = true;
                break;
            }
        } else {
            let elapsed = started_at.elapsed();

            // If the process died before emitting any JSON, fail fast (don't wait for startup timeout).
            if !process_alive && last_output_time.elapsed() > dead_process_timeout {
                let stderr_tail = read_stderr_tail(&stderr_file);
                let mut msg = format!(
                    "Codex process exited before producing any output. (stderr: {})",
                    stderr_file.display()
                );
                if let Some(tail) = stderr_tail {
                    msg.push_str("\n\nstderr (tail):\n");
                    msg.push_str(&tail);
                }
                failure_error = Some(msg);
                cancelled = true;
                break;
            }

            if elapsed > startup_timeout {
                log::warn!(
                    "Startup timeout ({:?}) exceeded waiting for Codex output, process_alive: {process_alive}",
                    startup_timeout
                );
                // If Codex is still running but isn't producing JSON, stop waiting and try to
                // clean up the process to avoid orphaned runs.
                if process_alive {
                    use crate::platform::{kill_process, kill_process_tree};
                    let _ = kill_process_tree(pid);
                    let _ = kill_process(pid);
                }

                let stderr_tail = read_stderr_tail(&stderr_file);
                let mut msg = format!(
                    "Codex startup timeout ({:?}): no output received. (stderr: {})",
                    startup_timeout,
                    stderr_file.display()
                );
                if let Some(tail) = stderr_tail {
                    msg.push_str("\n\nstderr (tail):\n");
                    msg.push_str(&tail);
                }
                failure_error = Some(msg);
                cancelled = true;
                break;
            }

            let secs = elapsed.as_secs();
            if secs > 0 && secs % 10 == 0 && elapsed.subsec_millis() < 100 {
                log::trace!(
                    "Waiting for Codex output... {secs}s elapsed, process_alive: {process_alive}"
                );
            }
        }

        std::thread::sleep(POLL_INTERVAL);
    }

    if let Some(error_msg) = &failure_error {
        log::error!("{error_msg}");
        let error_event = ErrorEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            error: error_msg.clone(),
        };
        let _ = app.emit("chat:error", &error_event);
    }

    if !cancelled {
        let done_event = DoneEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
        };
        if let Err(e) = app.emit("chat:done", &done_event) {
            log::error!("Failed to emit done event: {e}");
        }
    }

    Ok(CodexResponse {
        content: full_content,
        session_id: codex_session_id,
        tool_calls,
        content_blocks,
        cancelled,
        usage,
    })
}

fn handle_codex_item_event(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    item: &CodexThreadItem,
    full_content: &mut String,
    _codex_session_id: &mut String,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    agent_message_seen: &mut HashMap<String, String>,
    reasoning_seen: &mut HashMap<String, String>,
    todo_list_seen: &mut HashMap<String, String>,
    todo_list_seq: &mut HashMap<String, usize>,
) {
    match item {
        CodexThreadItem::AgentMessage(m) => {
            // Codex emits the full text so far; compute delta and emit chunk.
            let prev = agent_message_seen.entry(m.id.clone()).or_default();
            let new_text = &m.text;

            if new_text.starts_with(prev.as_str()) {
                let delta = &new_text[prev.len()..];
                if !delta.is_empty() {
                    full_content.push_str(delta);
                    content_blocks.push(ContentBlock::Text {
                        text: delta.to_string(),
                    });
                    let event = ChunkEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        content: delta.to_string(),
                    };
                    let _ = app.emit("chat:chunk", &event);
                }
            } else if !new_text.is_empty() && new_text != prev.as_str() {
                // Fallback: treat entire text as new when diff isn't a suffix (rare).
                full_content.push_str(new_text);
                content_blocks.push(ContentBlock::Text {
                    text: new_text.to_string(),
                });
                let event = ChunkEvent {
                    session_id: session_id.to_string(),
                    worktree_id: worktree_id.to_string(),
                    content: new_text.to_string(),
                };
                let _ = app.emit("chat:chunk", &event);
            }

            *prev = new_text.to_string();
        }
        CodexThreadItem::Reasoning(r) => {
            let prev = reasoning_seen.entry(r.id.clone()).or_default();
            let new_text = &r.text;

            if new_text.starts_with(prev.as_str()) {
                let delta = &new_text[prev.len()..];
                if !delta.is_empty() {
                    content_blocks.push(ContentBlock::Thinking {
                        thinking: delta.to_string(),
                    });
                    let event = ThinkingEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        content: delta.to_string(),
                    };
                    let _ = app.emit("chat:thinking", &event);
                }
            } else if !new_text.is_empty() && new_text != prev.as_str() {
                content_blocks.push(ContentBlock::Thinking {
                    thinking: new_text.to_string(),
                });
                let event = ThinkingEvent {
                    session_id: session_id.to_string(),
                    worktree_id: worktree_id.to_string(),
                    content: new_text.to_string(),
                };
                let _ = app.emit("chat:thinking", &event);
            }

            *prev = new_text.to_string();
        }
        CodexThreadItem::CommandExecution(cmd) => {
            // Treat command execution as a Bash tool call.
            let tool_id = cmd.id.clone();
            let tool_name = "Bash".to_string();
            let input = serde_json::json!({ "command": cmd.command });

            ensure_tool_call(
                tool_calls,
                content_blocks,
                app,
                session_id,
                worktree_id,
                &tool_id,
                &tool_name,
                input,
            );

            // Update output on each update
            let output = cmd.aggregated_output.clone();
            update_tool_output(app, session_id, worktree_id, tool_calls, &tool_id, output);
        }
        CodexThreadItem::FileChange(fc) => {
            // Map file changes to "Edit" tool calls so the UI can show edited files.
            // If there are multiple files, create one synthetic tool call per file.
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

                ensure_tool_call(
                    tool_calls,
                    content_blocks,
                    app,
                    session_id,
                    worktree_id,
                    &tool_id,
                    &tool_name,
                    input,
                );
                update_tool_output(
                    app,
                    session_id,
                    worktree_id,
                    tool_calls,
                    &tool_id,
                    format!("status: {}", fc.status),
                );
            } else {
                for (idx, change) in fc.changes.iter().enumerate() {
                    let tool_id = format!("{}:{}", fc.id, idx);
                    let tool_name = "Edit".to_string();
                    let input =
                        serde_json::json!({ "file_path": change.path, "kind": change.kind });
                    ensure_tool_call(
                        tool_calls,
                        content_blocks,
                        app,
                        session_id,
                        worktree_id,
                        &tool_id,
                        &tool_name,
                        input,
                    );
                    update_tool_output(
                        app,
                        session_id,
                        worktree_id,
                        tool_calls,
                        &tool_id,
                        format!("status: {}", fc.status),
                    );
                }
            }
        }
        CodexThreadItem::McpToolCall(tc) => {
            let tool_id = tc.id.clone();
            let tool_name = format!("MCP:{}:{}", tc.server, tc.tool);
            let input = tc.arguments.clone();
            ensure_tool_call(
                tool_calls,
                content_blocks,
                app,
                session_id,
                worktree_id,
                &tool_id,
                &tool_name,
                input,
            );

            if let Some(result) = &tc.result {
                let output = serde_json::to_string_pretty(&result.structured_content)
                    .unwrap_or_else(|_| "(failed to serialize result)".to_string());
                update_tool_output(app, session_id, worktree_id, tool_calls, &tool_id, output);
            } else if let Some(err) = &tc.error {
                update_tool_output(
                    app,
                    session_id,
                    worktree_id,
                    tool_calls,
                    &tool_id,
                    format!("error: {}", err.message),
                );
            }
        }
        CodexThreadItem::WebSearch(ws) => {
            let tool_id = ws.id.clone();
            let tool_name = "WebSearch".to_string();
            let input = serde_json::json!({ "query": ws.query });
            ensure_tool_call(
                tool_calls,
                content_blocks,
                app,
                session_id,
                worktree_id,
                &tool_id,
                &tool_name,
                input,
            );
        }
        CodexThreadItem::TodoList(todo) => {
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

            // Codex re-emits the same todo_list item ID as it updates. Jean's UI only
            // updates on new tool_use events, so generate a new tool id for each
            // distinct snapshot.
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

            ensure_tool_call(
                tool_calls,
                content_blocks,
                app,
                session_id,
                worktree_id,
                &tool_id,
                &tool_name,
                input,
            );
        }
        CodexThreadItem::Error(err) => {
            let error_event = ErrorEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                error: err.message.clone(),
            };
            let _ = app.emit("chat:error", &error_event);
        }
    }
}

fn ensure_tool_call(
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
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
        input: input.clone(),
        output: None,
        parent_tool_use_id: None,
    });

    content_blocks.push(ContentBlock::ToolUse {
        tool_call_id: id.to_string(),
    });

    let event = ToolUseEvent {
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    };
    let _ = app.emit("chat:tool_use", &event);

    let block_event = ToolBlockEvent {
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        tool_call_id: id.to_string(),
    };
    let _ = app.emit("chat:tool_block", &block_event);
}

fn update_tool_output(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    tool_calls: &mut Vec<ToolCall>,
    tool_use_id: &str,
    output: String,
) {
    if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_use_id) {
        tc.output = Some(output.clone());
    }

    let event = ToolResultEvent {
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        tool_use_id: tool_use_id.to_string(),
        output,
    };
    let _ = app.emit("chat:tool_result", &event);
}

#[allow(dead_code)]
fn emit_cancelled(app: &tauri::AppHandle, session_id: &str, worktree_id: &str, undo_send: bool) {
    let event = CancelledEvent {
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        undo_send,
    };
    let _ = app.emit("chat:cancelled", &event);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_for(
        existing_session_id: Option<&str>,
        execution_mode: Option<&str>,
        model: Option<&str>,
        reasoning_effort: Option<ThinkingLevel>,
    ) -> Vec<String> {
        build_codex_args(
            "s1",
            "w1",
            existing_session_id,
            model,
            reasoning_effort.as_ref(),
            execution_mode,
            std::path::Path::new("/tmp"),
            None,
        )
        .0
    }

    #[test]
    fn codex_args_global_flags_are_first() {
        let args = args_for(None, Some("plan"), Some("gpt-5.2-codex"), None);
        assert_eq!(args.get(0).map(String::as_str), Some("--ask-for-approval"));
        assert_eq!(args.get(1).map(String::as_str), Some("never"));
        assert_eq!(args.get(2).map(String::as_str), Some("exec"));
    }

    #[test]
    fn codex_args_never_uses_claude_flags() {
        let args = args_for(None, Some("plan"), Some("gpt-5.2-codex"), None);
        let joined = args.join(" ");
        assert!(!joined.contains("--permission-mode"));
        assert!(!joined.contains("--allowedTools"));
        assert!(!joined.contains("--output-format"));
        assert!(!joined.contains("--input-format"));
        assert!(!joined.contains("--experimental-json"));
        assert!(!joined.contains("--color"));
        assert!(joined.contains("--json"));
    }

    #[test]
    fn codex_args_plan_uses_read_only_sandbox() {
        let args = args_for(None, Some("plan"), Some("gpt-5.2-codex"), None);
        let sandbox_idx = args.iter().position(|a| a == "--sandbox").unwrap();
        assert_eq!(
            args.get(sandbox_idx + 1).map(String::as_str),
            Some("read-only")
        );
    }

    #[test]
    fn codex_args_resume_orders_exec_flags_before_resume() {
        let args = args_for(
            Some("019c0af8-581d-77b3-af91-ce573a2d1d97"),
            Some("plan"),
            Some("gpt-5.2-codex"),
            None,
        );

        let resume_idx = args.iter().position(|a| a == "resume").unwrap();
        let cd_idx = args.iter().position(|a| a == "--cd").unwrap();
        let sandbox_idx = args.iter().position(|a| a == "--sandbox").unwrap();
        let json_idx = args.iter().position(|a| a == "--json").unwrap();

        // `--cd`/`--sandbox` are exec-level flags and must be BEFORE `resume`
        assert!(cd_idx < resume_idx);
        assert!(sandbox_idx < resume_idx);

        // `--json` is an exec option and must be BEFORE `resume <id>`
        assert!(json_idx < resume_idx);

        // Prompt from stdin, always the last arg
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }

    #[test]
    fn codex_args_build_uses_workspace_write_sandbox() {
        let args = args_for(None, Some("build"), Some("gpt-5.2-codex"), None);
        let sandbox_idx = args.iter().position(|a| a == "--sandbox").unwrap();
        assert_eq!(
            args.get(sandbox_idx + 1).map(String::as_str),
            Some("workspace-write")
        );
    }

    #[test]
    fn codex_args_yolo_uses_dangerous_flag() {
        let args = args_for(None, Some("yolo"), Some("gpt-5.2-codex"), None);
        assert!(args
            .iter()
            .any(|a| a == "--dangerously-bypass-approvals-and-sandbox"));
    }

    #[test]
    fn codex_args_yolo_does_not_set_sandbox() {
        let args = args_for(None, Some("yolo"), Some("gpt-5.2-codex"), None);
        assert!(!args.iter().any(|a| a == "--sandbox"));
    }

    #[test]
    fn codex_args_omits_empty_model() {
        let args = args_for(None, Some("plan"), Some("   "), None);
        assert!(!args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn codex_args_adds_reasoning_effort_config() {
        let args = args_for(
            None,
            Some("plan"),
            Some("gpt-5.2"),
            Some(ThinkingLevel::High),
        );
        let config_idx = args.iter().position(|a| a == "--config").unwrap();
        assert_eq!(
            args.get(config_idx + 1).map(String::as_str),
            Some("model_reasoning_effort=\"high\"")
        );
    }
}
