//! Types for `codex exec --json/--experimental-json` event streams.
//!
//! These mirror the public Codex SDK event/item types so we can parse Codex CLI
//! JSONL output and map it into Jean's unified chat event model.

use serde::Deserialize;

// ============================================================================
// Top-level events
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct CodexUsage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexThreadError {
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum CodexExecEvent {
    #[serde(rename = "thread.started")]
    ThreadStarted { thread_id: String },
    #[serde(rename = "turn.started")]
    TurnStarted,
    #[serde(rename = "turn.completed")]
    TurnCompleted { usage: CodexUsage },
    #[serde(rename = "turn.failed")]
    TurnFailed { error: CodexThreadError },
    #[serde(rename = "item.started")]
    ItemStarted { item: CodexThreadItem },
    #[serde(rename = "item.updated")]
    ItemUpdated { item: CodexThreadItem },
    #[serde(rename = "item.completed")]
    ItemCompleted { item: CodexThreadItem },
    #[serde(rename = "error")]
    StreamError { message: String },
}

// ============================================================================
// Thread items
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct CodexCommandExecutionItem {
    pub id: String,
    pub command: String,
    pub aggregated_output: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub exit_code: Option<i64>,
    #[allow(dead_code)]
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexFileUpdateChange {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexFileChangeItem {
    pub id: String,
    pub changes: Vec<CodexFileUpdateChange>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexMcpToolCallResult {
    #[allow(dead_code)]
    pub content: Vec<serde_json::Value>,
    #[serde(default)]
    pub structured_content: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexMcpToolCallError {
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexMcpToolCallItem {
    pub id: String,
    pub server: String,
    pub tool: String,
    pub arguments: serde_json::Value,
    #[serde(default)]
    pub result: Option<CodexMcpToolCallResult>,
    #[serde(default)]
    pub error: Option<CodexMcpToolCallError>,
    #[allow(dead_code)]
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexAgentMessageItem {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexReasoningItem {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexWebSearchItem {
    pub id: String,
    pub query: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexErrorItem {
    #[allow(dead_code)]
    pub id: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexTodoItem {
    pub text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexTodoListItem {
    pub id: String,
    pub items: Vec<CodexTodoItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum CodexThreadItem {
    #[serde(rename = "agent_message")]
    AgentMessage(CodexAgentMessageItem),
    #[serde(rename = "reasoning")]
    Reasoning(CodexReasoningItem),
    #[serde(rename = "command_execution")]
    CommandExecution(CodexCommandExecutionItem),
    #[serde(rename = "file_change")]
    FileChange(CodexFileChangeItem),
    #[serde(rename = "mcp_tool_call")]
    McpToolCall(CodexMcpToolCallItem),
    #[serde(rename = "web_search")]
    WebSearch(CodexWebSearchItem),
    #[serde(rename = "todo_list")]
    TodoList(CodexTodoListItem),
    #[serde(rename = "error")]
    Error(CodexErrorItem),
}
