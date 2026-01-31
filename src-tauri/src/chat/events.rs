//! Shared event payloads for streaming chat updates to the frontend.
//!
//! Both Claude CLI and Codex CLI integrations emit these events so the
//! frontend can render a unified streaming experience.

/// Payload for text chunk events sent to frontend
#[derive(serde::Serialize, Clone)]
pub struct ChunkEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub content: String,
}

/// Payload for tool use events sent to frontend
#[derive(serde::Serialize, Clone)]
pub struct ToolUseEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
    /// Parent tool use ID for sub-agent tool calls (for parallel task attribution)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
}

/// Payload for tool block position events sent to frontend
/// Signals where a tool_use block appears in the content stream
#[derive(serde::Serialize, Clone)]
pub struct ToolBlockEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub tool_call_id: String,
}

/// Payload for thinking events sent to frontend (extended thinking)
#[derive(serde::Serialize, Clone)]
pub struct ThinkingEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub content: String,
}

/// Payload for tool result events sent to frontend
/// Contains the output from a tool execution
#[derive(serde::Serialize, Clone)]
pub struct ToolResultEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub tool_use_id: String,
    pub output: String,
}

/// Payload for done events sent to frontend
#[derive(serde::Serialize, Clone)]
pub struct DoneEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
}

/// Payload for error events sent to frontend
#[derive(serde::Serialize, Clone)]
pub struct ErrorEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub error: String,
}

/// Payload for cancelled events sent to frontend
#[derive(serde::Serialize, Clone)]
pub struct CancelledEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub undo_send: bool, // True if user message should be restored to input (instant cancellation)
}

/// Payload for non-fatal streaming warnings.
///
/// This is emitted when the backend detects an issue while tailing/parsing the
/// agent stream, but can continue.
#[derive(serde::Serialize, Clone)]
pub struct StreamWarningEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_preview: Option<String>,
}

/// A single permission denial for the permission approval UI.
#[derive(serde::Serialize, Clone)]
pub struct PermissionDenialEvent {
    pub tool_name: String,
    pub tool_use_id: String,
    pub tool_input: serde_json::Value,
}

/// Payload for permission denied events sent to frontend.
///
/// Claude emits this when its CLI returns `permission_denials`.
/// Codex can also emit this when running interactively and waiting for y/n input.
#[derive(serde::Serialize, Clone)]
pub struct PermissionDeniedEvent {
    pub session_id: String,
    pub worktree_id: String, // Kept for backward compatibility
    pub denials: Vec<PermissionDenialEvent>,
}
