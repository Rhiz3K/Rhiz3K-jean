#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionMode {
    Plan,
    Build,
    Yolo,
}

impl ExecutionMode {
    pub fn from_optional_str(mode: Option<&str>) -> Self {
        match mode.unwrap_or("plan") {
            "build" => Self::Build,
            "yolo" => Self::Yolo,
            _ => Self::Plan,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexSandbox {
    ReadOnly,
    WorkspaceWrite,
}

impl CodexSandbox {
    pub fn as_cli_value(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexDetachedPolicy {
    pub mode: ExecutionMode,
    pub enable_search: bool,
    pub ask_for_approval: Option<&'static str>,
    pub sandbox: Option<CodexSandbox>,
    pub workspace_write_network_access: bool,
    pub bypass_approvals_and_sandbox: bool,
}

pub fn codex_detached_policy(mode: ExecutionMode) -> CodexDetachedPolicy {
    match mode {
        ExecutionMode::Build => CodexDetachedPolicy {
            mode,
            enable_search: true,
            ask_for_approval: Some("never"),
            sandbox: Some(CodexSandbox::WorkspaceWrite),
            workspace_write_network_access: false,
            bypass_approvals_and_sandbox: false,
        },
        ExecutionMode::Yolo => CodexDetachedPolicy {
            mode,
            enable_search: true,
            ask_for_approval: None,
            sandbox: None,
            workspace_write_network_access: false,
            bypass_approvals_and_sandbox: true,
        },
        ExecutionMode::Plan => CodexDetachedPolicy {
            mode,
            enable_search: true,
            ask_for_approval: Some("never"),
            sandbox: Some(CodexSandbox::ReadOnly),
            workspace_write_network_access: false,
            bypass_approvals_and_sandbox: false,
        },
    }
}

pub fn push_codex_detached_mode_args(args: &mut Vec<String>, policy: &CodexDetachedPolicy) {
    if policy.enable_search {
        args.push("--search".to_string());
    }

    if policy.bypass_approvals_and_sandbox {
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        return;
    }

    if let Some(approval) = policy.ask_for_approval {
        args.push("--ask-for-approval".to_string());
        args.push(approval.to_string());
    }

    if let Some(sandbox) = policy.sandbox {
        args.push("--sandbox".to_string());
        args.push(sandbox.as_cli_value().to_string());

        if sandbox == CodexSandbox::WorkspaceWrite && policy.workspace_write_network_access {
            args.push("--config".to_string());
            args.push("sandbox_workspace_write.network_access=true".to_string());
        }
    }
}
