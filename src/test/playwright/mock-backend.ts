import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type { InvokeArgs } from '@tauri-apps/api/core'
import type {
  ArchivedSessionEntry,
  ChatAgent,
  ChatMessage,
  Session,
  WorktreeSessions,
} from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import { defaultUIState, type UIState } from '@/types/ui-state'

type EmitFn = (event: string, payload?: unknown) => Promise<void>

interface Counters {
  dialog: number
  project: number
  worktree: number
  session: number
  message: number
  tool: number
  timestamp: number
  codexWorktrees: number
  claudeWorktrees: number
}

interface MockState {
  preferences: AppPreferences
  uiState: UIState
  projects: Project[]
  worktrees: Worktree[]
  archivedWorktrees: Worktree[]
  sessionsByWorktree: Record<string, WorktreeSessions>
  archivedSessions: ArchivedSessionEntry[]
  counters: Counters
}

let emitEventFn: EmitFn | null = null
let state = createInitialState()

function createInitialState(): MockState {
  return {
    preferences: {
      ...defaultPreferences,
      archive_retention_days: 0,
      session_recap_enabled: false,
      http_server_enabled: false,
      http_server_auto_start: false,
    },
    uiState: clone(defaultUIState),
    projects: [],
    worktrees: [],
    archivedWorktrees: [],
    sessionsByWorktree: {},
    archivedSessions: [],
    counters: {
      dialog: 0,
      project: 0,
      worktree: 0,
      session: 0,
      message: 0,
      tool: 0,
      timestamp: 1_760_000_000,
      codexWorktrees: 0,
      claudeWorktrees: 0,
    },
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function toRecord(value: InvokeArgs | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function nextTimestamp(): number {
  state.counters.timestamp += 1
  return state.counters.timestamp
}

function nextId(prefix: string): string {
  switch (prefix) {
    case 'project':
      state.counters.project += 1
      return `project-${state.counters.project}`
    case 'worktree':
      state.counters.worktree += 1
      return `worktree-${state.counters.worktree}`
    case 'session':
      state.counters.session += 1
      return `session-${state.counters.session}`
    case 'message':
      state.counters.message += 1
      return `message-${state.counters.message}`
    case 'tool':
      state.counters.tool += 1
      return `tool-${state.counters.tool}`
    default:
      return `${prefix}-${nextTimestamp()}`
  }
}

function basename(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const last = clean.split('/').filter(Boolean).at(-1)
  return last || `mock-project-${state.counters.project + 1}`
}

function sortedProjects(): Project[] {
  return [...state.projects].sort((a, b) => a.order - b.order)
}

function sortedWorktrees(projectId: string): Worktree[] {
  return state.worktrees
    .filter(w => w.project_id === projectId)
    .sort((a, b) => {
      const aIsBase = a.session_type === 'base'
      const bIsBase = b.session_type === 'base'
      if (aIsBase && !bIsBase) return -1
      if (!aIsBase && bIsBase) return 1
      if (a.order !== b.order) return a.order - b.order
      return b.created_at - a.created_at
    })
}

function getProject(projectId: string): Project | undefined {
  return state.projects.find(project => project.id === projectId)
}

function getWorktree(worktreeId: string): Worktree | undefined {
  return (
    state.worktrees.find(worktree => worktree.id === worktreeId) ||
    state.archivedWorktrees.find(worktree => worktree.id === worktreeId)
  )
}

function getWorktreeSessions(worktreeId: string): WorktreeSessions {
  if (!state.sessionsByWorktree[worktreeId]) {
    state.sessionsByWorktree[worktreeId] = {
      worktree_id: worktreeId,
      sessions: [],
      active_session_id: null,
      version: 2,
    }
  }
  return state.sessionsByWorktree[worktreeId]
}

function removeWorktreeSessions(worktreeId: string): void {
  const { [worktreeId]: _removed, ...remaining } = state.sessionsByWorktree
  state.sessionsByWorktree = remaining
}

function createSession(
  worktreeId: string,
  agent: ChatAgent,
  name?: string
): Session {
  const sessions = getWorktreeSessions(worktreeId)
  const order = sessions.sessions.length

  const session: Session = {
    id: nextId('session'),
    name: name ?? `Session ${order + 1}`,
    order,
    created_at: nextTimestamp(),
    messages: [],
    agent,
  }

  sessions.sessions.push(session)
  if (!sessions.active_session_id) {
    sessions.active_session_id = session.id
  }
  return session
}

function ensureBaseSession(projectId: string, agent: ChatAgent): Worktree {
  const existing = state.worktrees.find(
    worktree =>
      worktree.project_id === projectId && worktree.session_type === 'base'
  )
  if (existing) {
    const sessions = getWorktreeSessions(existing.id)
    if (sessions.sessions.length === 0) {
      createSession(existing.id, agent, 'Session 1')
    }
    return existing
  }

  const archived = state.archivedWorktrees.find(
    worktree =>
      worktree.project_id === projectId && worktree.session_type === 'base'
  )
  if (archived) {
    const restored = restoreArchivedWorktree(archived.id)
    return restored
  }

  const project = getProject(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }

  const worktree: Worktree = {
    id: nextId('worktree'),
    project_id: projectId,
    name: 'Base Session',
    path: project.path,
    branch: project.default_branch || 'main',
    created_at: nextTimestamp(),
    session_type: 'base',
    order: 0,
  }

  state.worktrees.push(worktree)
  createSession(worktree.id, agent, 'Session 1')
  return worktree
}

function createWorktree(
  projectId: string,
  agent: ChatAgent,
  customName?: string
): Worktree {
  const project = getProject(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }

  let name = customName
  if (!name) {
    if (agent === 'codex') {
      state.counters.codexWorktrees += 1
      name = `codex-worktree-${state.counters.codexWorktrees}`
    } else {
      state.counters.claudeWorktrees += 1
      name = `claude-worktree-${state.counters.claudeWorktrees}`
    }
  }

  const nonBaseWorktrees = state.worktrees.filter(
    worktree =>
      worktree.project_id === projectId && worktree.session_type !== 'base'
  )

  const worktree: Worktree = {
    id: nextId('worktree'),
    project_id: projectId,
    name,
    path: `${project.path}/${name}`,
    branch: name,
    created_at: nextTimestamp(),
    session_type: 'worktree',
    order: nonBaseWorktrees.length + 1,
  }

  state.worktrees.push(worktree)
  createSession(worktree.id, agent, 'Session 1')
  return worktree
}

function archiveWorktree(worktreeId: string): Worktree {
  const index = state.worktrees.findIndex(
    worktree => worktree.id === worktreeId
  )
  if (index < 0) {
    throw new Error(`Worktree not found: ${worktreeId}`)
  }

  const worktree = state.worktrees[index]
  if (!worktree) {
    throw new Error(`Worktree not found: ${worktreeId}`)
  }

  state.worktrees.splice(index, 1)

  const archivedAt = nextTimestamp()
  const archivedWorktree: Worktree = {
    ...worktree,
    archived_at: archivedAt,
  }
  state.archivedWorktrees.push(archivedWorktree)

  const sessions = state.sessionsByWorktree[worktreeId]
  const projectName = getProject(worktree.project_id)?.name ?? 'Unknown'
  if (sessions) {
    for (const session of sessions.sessions) {
      state.archivedSessions.push({
        session: { ...session, archived_at: archivedAt },
        worktree_id: worktree.id,
        worktree_name: worktree.name,
        worktree_path: worktree.path,
        project_id: worktree.project_id,
        project_name: projectName,
      })
    }
    removeWorktreeSessions(worktreeId)
  }

  return archivedWorktree
}

function restoreArchivedWorktree(worktreeId: string): Worktree {
  const index = state.archivedWorktrees.findIndex(
    worktree => worktree.id === worktreeId
  )
  if (index < 0) {
    throw new Error(`Archived worktree not found: ${worktreeId}`)
  }

  const archived = state.archivedWorktrees[index]
  if (!archived) {
    throw new Error(`Archived worktree not found: ${worktreeId}`)
  }

  state.archivedWorktrees.splice(index, 1)
  const restored: Worktree = { ...archived, archived_at: undefined }
  state.worktrees.push(restored)

  const archivedEntries = state.archivedSessions.filter(
    entry => entry.worktree_id === worktreeId
  )
  if (archivedEntries.length > 0) {
    const sessions = archivedEntries
      .map(entry => ({ ...entry.session, archived_at: undefined }))
      .sort((a, b) => a.order - b.order)

    state.sessionsByWorktree[worktreeId] = {
      worktree_id: worktreeId,
      sessions,
      active_session_id: sessions[0]?.id ?? null,
      version: 2,
    }

    state.archivedSessions = state.archivedSessions.filter(
      entry => entry.worktree_id !== worktreeId
    )
  } else if (!state.sessionsByWorktree[worktreeId]) {
    createSession(worktreeId, 'claude', 'Session 1')
  }

  return restored
}

function findSession(
  worktreeId: string,
  sessionId: string
): { sessions: WorktreeSessions; session: Session } | null {
  const sessions = state.sessionsByWorktree[worktreeId]
  if (!sessions) return null
  const session = sessions.sessions.find(item => item.id === sessionId)
  if (!session) return null
  return { sessions, session }
}

function toSessionList(
  sessions: WorktreeSessions,
  includeMessageCounts: boolean
): WorktreeSessions {
  if (!includeMessageCounts) {
    return clone(sessions)
  }

  return {
    ...clone(sessions),
    sessions: sessions.sessions.map(session => ({
      ...clone(session),
      message_count: session.messages.length,
    })),
  }
}

async function emitEvent(event: string, payload: unknown): Promise<void> {
  if (!emitEventFn) return
  await emitEventFn(event, payload)
}

function scheduleChatStream(
  worktreeId: string,
  sessionId: string,
  message: ChatMessage
): void {
  window.setTimeout(() => {
    void (async () => {
      if (message.content) {
        await emitEvent('chat:chunk', {
          session_id: sessionId,
          worktree_id: worktreeId,
          content: message.content,
        })
      }

      for (const toolCall of message.tool_calls) {
        await emitEvent('chat:tool_use', {
          session_id: sessionId,
          worktree_id: worktreeId,
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        })
        await emitEvent('chat:tool_block', {
          session_id: sessionId,
          worktree_id: worktreeId,
          tool_call_id: toolCall.id,
        })
      }

      await emitEvent('chat:done', {
        session_id: sessionId,
        worktree_id: worktreeId,
      })
    })()
  }, 10)
}

function createAssistantMessage(
  sessionId: string,
  agent: ChatAgent,
  prompt: string
): ChatMessage {
  const lowerPrompt = prompt.toLowerCase()
  const asksQuestion =
    lowerPrompt.includes('ask me') ||
    lowerPrompt.includes('question') ||
    lowerPrompt.includes('dotaz') ||
    lowerPrompt.includes('otaz')

  if (asksQuestion) {
    const toolId = nextId('tool')
    const toolCall = {
      id: toolId,
      name: 'AskUserQuestion',
      input: {
        questions: [
          {
            header: 'Scope',
            question: 'Which flow should I validate next?',
            multiSelect: false,
            options: [
              {
                label: 'Archive and restore',
                description: 'Validate archive + restore flow first',
              },
              {
                label: 'Create more worktrees',
                description: 'Validate worktree and base-session flows first',
              },
            ],
          },
        ],
      },
    }

    return {
      id: nextId('message'),
      session_id: sessionId,
      role: 'assistant',
      content: `[mock:${agent}] I need one input before I continue.`,
      timestamp: nextTimestamp(),
      tool_calls: [toolCall],
      content_blocks: [
        {
          type: 'text',
          text: `[mock:${agent}] I need one input before I continue.`,
        },
        {
          type: 'tool_use',
          tool_call_id: toolId,
        },
      ],
    }
  }

  const isQuestionAnswer = prompt.startsWith('For "')
  const content = isQuestionAnswer
    ? `[mock:${agent}] Answer received and processing continued.`
    : `[mock:${agent}] processed: ${prompt}`

  return {
    id: nextId('message'),
    session_id: sessionId,
    role: 'assistant',
    content,
    timestamp: nextTimestamp(),
    tool_calls: [],
  }
}

async function handleInvoke(
  command: string,
  payload?: InvokeArgs
): Promise<unknown> {
  const args = toRecord(payload)

  switch (command) {
    case 'plugin:dialog|save': {
      state.counters.dialog += 1
      return `/tmp/mock-project-${state.counters.dialog}`
    }

    case 'plugin:dialog|open':
      return '/tmp/mock-existing-project'
    case 'plugin:dialog|ask':
      return false
    case 'plugin:dialog|message':
      return null

    case 'plugin:updater|check':
      return null

    case 'plugin:window|is_maximized':
      return false
    case 'plugin:window|is_fullscreen':
      return false
    case 'plugin:window|is_minimized':
      return false
    case 'plugin:window|is_focused':
      return true
    case 'plugin:window|get_all_windows':
      return [{ label: 'main' }]
  }

  if (command.startsWith('plugin:window|')) {
    return null
  }

  if (command.startsWith('plugin:opener|')) {
    return null
  }

  switch (command) {
    case 'kill_all_terminals':
      return 0
    case 'check_resumable_sessions':
      return []
    case 'resume_session':
      return null
    case 'cleanup_old_recovery_files':
      return 0
    case 'cleanup_old_archives':
      return { deleted_worktrees: 0, deleted_sessions: 0, deleted_contexts: 0 }

    case 'load_preferences':
      return clone(state.preferences)
    case 'save_preferences': {
      const preferences = args.preferences as AppPreferences | undefined
      if (preferences) {
        state.preferences = clone(preferences)
      }
      return null
    }
    case 'load_ui_state':
      return clone(state.uiState)
    case 'save_ui_state': {
      const uiState = args.uiState as UIState | undefined
      if (uiState) {
        state.uiState = clone(uiState)
      }
      return null
    }

    case 'check_claude_cli_installed':
      return { installed: true, version: 'mock', path: '/mock/claude' }
    case 'check_claude_cli_auth':
      return { authenticated: true, error: null }
    case 'check_codex_cli_installed':
      return { installed: true, version: 'mock', path: '/mock/codex' }
    case 'check_codex_cli_auth':
      return { authenticated: true, error: null }
    case 'check_gh_cli_installed':
      return { installed: true, version: 'mock', path: '/mock/gh' }
    case 'check_gh_cli_auth':
      return { authenticated: true, error: null }
    case 'get_available_cli_versions':
    case 'get_available_codex_versions':
    case 'get_available_gh_versions':
      return []

    case 'list_projects':
      return clone(sortedProjects())
    case 'add_project':
    case 'init_project': {
      const path =
        toStringValue(args.path) ?? `/tmp/mock-project-${nextTimestamp()}`
      const project: Project = {
        id: nextId('project'),
        name: basename(path),
        path,
        default_branch: 'main',
        added_at: nextTimestamp(),
        order: state.projects.length,
      }
      state.projects.push(project)
      return clone(project)
    }

    case 'create_base_session': {
      const projectId = toStringValue(args.projectId)
      const agent = (toStringValue(args.agent) as ChatAgent | null) ?? 'claude'
      if (!projectId) {
        throw new Error('Missing projectId')
      }
      const session = ensureBaseSession(projectId, agent)
      return clone(session)
    }

    case 'create_worktree': {
      const projectId = toStringValue(args.projectId)
      const customName = toStringValue(args.customName) ?? undefined
      const agent = (toStringValue(args.agent) as ChatAgent | null) ?? 'claude'
      if (!projectId) {
        throw new Error('Missing projectId')
      }
      const worktree = createWorktree(projectId, agent, customName)
      window.setTimeout(() => {
        void emitEvent('worktree:created', { worktree: clone(worktree) })
      }, 10)
      return clone(worktree)
    }

    case 'create_worktree_from_existing_branch': {
      const projectId = toStringValue(args.projectId)
      const agent = (toStringValue(args.agent) as ChatAgent | null) ?? 'claude'
      if (!projectId) {
        throw new Error('Missing projectId')
      }
      const worktree = createWorktree(projectId, agent)
      window.setTimeout(() => {
        void emitEvent('worktree:created', { worktree: clone(worktree) })
      }, 10)
      return clone(worktree)
    }

    case 'list_worktrees': {
      const projectId = toStringValue(args.projectId)
      if (!projectId) return []
      return clone(sortedWorktrees(projectId))
    }

    case 'get_worktree': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) {
        throw new Error('Missing worktreeId')
      }
      const worktree = getWorktree(worktreeId)
      if (!worktree) {
        throw new Error(`Worktree not found: ${worktreeId}`)
      }
      return clone(worktree)
    }

    case 'archive_worktree':
    case 'close_base_session': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) {
        throw new Error('Missing worktreeId')
      }
      const archived = archiveWorktree(worktreeId)
      window.setTimeout(() => {
        void emitEvent('worktree:archived', {
          id: archived.id,
          project_id: archived.project_id,
        })
      }, 10)
      return null
    }

    case 'close_base_session_clean':
    case 'delete_worktree': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) return null
      state.worktrees = state.worktrees.filter(
        worktree => worktree.id !== worktreeId
      )
      removeWorktreeSessions(worktreeId)
      state.archivedWorktrees = state.archivedWorktrees.filter(
        worktree => worktree.id !== worktreeId
      )
      state.archivedSessions = state.archivedSessions.filter(
        entry => entry.worktree_id !== worktreeId
      )
      return null
    }

    case 'unarchive_worktree': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) {
        throw new Error('Missing worktreeId')
      }
      const restored = restoreArchivedWorktree(worktreeId)
      window.setTimeout(() => {
        void emitEvent('worktree:unarchived', { worktree: clone(restored) })
      }, 10)
      return clone(restored)
    }

    case 'list_archived_worktrees':
      return clone(
        [...state.archivedWorktrees].sort(
          (a, b) => (b.archived_at ?? 0) - (a.archived_at ?? 0)
        )
      )

    case 'delete_all_archives': {
      const deleted_worktrees = state.archivedWorktrees.length
      const deleted_sessions = state.archivedSessions.length
      state.archivedWorktrees = []
      state.archivedSessions = []
      return { deleted_worktrees, deleted_sessions }
    }

    case 'permanently_delete_worktree': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) return null
      state.archivedWorktrees = state.archivedWorktrees.filter(
        worktree => worktree.id !== worktreeId
      )
      state.archivedSessions = state.archivedSessions.filter(
        entry => entry.worktree_id !== worktreeId
      )
      return null
    }

    case 'get_sessions': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) {
        return {
          worktree_id: '',
          sessions: [],
          active_session_id: null,
          version: 2,
        }
      }
      const includeMessageCounts = Boolean(args.includeMessageCounts)
      const sessions = getWorktreeSessions(worktreeId)
      return toSessionList(sessions, includeMessageCounts)
    }

    case 'get_session': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      if (!worktreeId || !sessionId) {
        throw new Error('Missing session identifiers')
      }
      const located = findSession(worktreeId, sessionId)
      if (!located) {
        throw new Error(`Session not found: ${sessionId}`)
      }
      return clone(located.session)
    }

    case 'create_session': {
      const worktreeId = toStringValue(args.worktreeId)
      const name = toStringValue(args.name) ?? undefined
      if (!worktreeId) {
        throw new Error('Missing worktreeId')
      }
      const worktree = getWorktree(worktreeId)
      const agent = (
        worktree?.name.toLowerCase().includes('codex') ? 'codex' : 'claude'
      ) as ChatAgent
      const session = createSession(worktreeId, agent, name)
      const sessions = getWorktreeSessions(worktreeId)
      sessions.active_session_id = session.id
      return clone(session)
    }

    case 'set_active_session': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      if (worktreeId && sessionId) {
        const sessions = getWorktreeSessions(worktreeId)
        sessions.active_session_id = sessionId
      }
      return null
    }

    case 'rename_session': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      const newName = toStringValue(args.newName)
      if (!worktreeId || !sessionId || !newName) return null
      const located = findSession(worktreeId, sessionId)
      if (located) {
        located.session.name = newName
      }
      return null
    }

    case 'archive_session': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      if (!worktreeId || !sessionId) return null

      const sessions = getWorktreeSessions(worktreeId)
      const worktree = getWorktree(worktreeId)
      const project = worktree ? getProject(worktree.project_id) : undefined
      const index = sessions.sessions.findIndex(
        session => session.id === sessionId
      )
      if (index >= 0 && worktree) {
        const [session] = sessions.sessions.splice(index, 1)
        if (session) {
          state.archivedSessions.push({
            session: { ...session, archived_at: nextTimestamp() },
            worktree_id: worktree.id,
            worktree_name: worktree.name,
            worktree_path: worktree.path,
            project_id: worktree.project_id,
            project_name: project?.name ?? 'Unknown',
          })
        }
        sessions.active_session_id = sessions.sessions[0]?.id ?? null
      }
      return sessions.active_session_id
    }

    case 'unarchive_session': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      if (!worktreeId || !sessionId) {
        throw new Error('Missing identifiers')
      }

      const entryIndex = state.archivedSessions.findIndex(
        entry =>
          entry.worktree_id === worktreeId && entry.session.id === sessionId
      )
      if (entryIndex < 0) {
        throw new Error('Archived session not found')
      }

      const entry = state.archivedSessions[entryIndex]
      if (!entry) {
        throw new Error('Archived session not found')
      }

      state.archivedSessions.splice(entryIndex, 1)
      const sessions = getWorktreeSessions(worktreeId)
      const restored: Session = {
        ...entry.session,
        archived_at: undefined,
        order: sessions.sessions.length,
      }
      sessions.sessions.push(restored)
      sessions.active_session_id = restored.id
      return clone(restored)
    }

    case 'restore_session_with_base': {
      const sessionId = toStringValue(args.sessionId)
      const projectId = toStringValue(args.projectId)
      if (!sessionId || !projectId) {
        throw new Error('Missing identifiers')
      }

      const entryIndex = state.archivedSessions.findIndex(
        entry => entry.session.id === sessionId
      )
      if (entryIndex < 0) {
        throw new Error('Archived session not found')
      }
      const entry = state.archivedSessions[entryIndex]
      if (!entry) {
        throw new Error('Archived session not found')
      }

      state.archivedSessions.splice(entryIndex, 1)
      const worktree =
        state.worktrees.find(item => item.id === entry.worktree_id) ??
        ensureBaseSession(
          projectId,
          (entry.session.agent ?? 'claude') as ChatAgent
        )

      const sessions = getWorktreeSessions(worktree.id)
      const restored: Session = {
        ...entry.session,
        archived_at: undefined,
        order: sessions.sessions.length,
      }
      sessions.sessions.push(restored)
      sessions.active_session_id = restored.id

      return {
        session: clone(restored),
        worktree: clone(worktree),
      }
    }

    case 'delete_archived_session': {
      const sessionId = toStringValue(args.sessionId)
      if (!sessionId) return null
      state.archivedSessions = state.archivedSessions.filter(
        entry => entry.session.id !== sessionId
      )
      return null
    }

    case 'list_archived_sessions': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) return []
      return clone(
        state.archivedSessions
          .filter(entry => entry.worktree_id === worktreeId)
          .map(entry => entry.session)
      )
    }

    case 'list_all_archived_sessions':
      return clone(
        [...state.archivedSessions].sort(
          (a, b) => (b.session.archived_at ?? 0) - (a.session.archived_at ?? 0)
        )
      )

    case 'list_all_sessions': {
      const entries = state.worktrees.map(worktree => {
        const project = getProject(worktree.project_id)
        const sessions = getWorktreeSessions(worktree.id)
        return {
          project_id: worktree.project_id,
          project_name: project?.name ?? 'Unknown',
          worktree_id: worktree.id,
          worktree_name: worktree.name,
          worktree_path: worktree.path,
          sessions: clone(sessions.sessions),
        }
      })
      return { entries }
    }

    case 'send_chat_message': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      const prompt = toStringValue(args.message) ?? ''
      const agent = (toStringValue(args.agent) as ChatAgent | null) ?? 'claude'

      if (!worktreeId || !sessionId) {
        throw new Error('Missing session/worktree IDs')
      }

      const located = findSession(worktreeId, sessionId)
      if (!located) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const lastMessage = located.session.messages.at(-1)
      if (
        !lastMessage ||
        lastMessage.role !== 'user' ||
        lastMessage.content !== prompt
      ) {
        located.session.messages.push({
          id: nextId('message'),
          session_id: sessionId,
          role: 'user',
          content: prompt,
          timestamp: nextTimestamp(),
          tool_calls: [],
          model: toStringValue(args.model) ?? undefined,
          execution_mode:
            (toStringValue(args.executionMode) as
              | 'plan'
              | 'build'
              | 'yolo'
              | undefined) ?? undefined,
          thinking_level:
            (toStringValue(args.thinkingLevel) as
              | 'off'
              | 'think'
              | 'megathink'
              | 'ultrathink'
              | 'minimal'
              | 'low'
              | 'medium'
              | 'high'
              | 'xhigh'
              | undefined) ?? undefined,
        })
      }

      const assistant = createAssistantMessage(sessionId, agent, prompt)
      located.session.messages.push(assistant)
      scheduleChatStream(worktreeId, sessionId, assistant)
      return clone(assistant)
    }

    case 'cancel_chat_message':
      return true

    case 'clear_session_history': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      if (!worktreeId || !sessionId) return null
      const located = findSession(worktreeId, sessionId)
      if (located) {
        located.session.messages = []
      }
      return null
    }

    case 'clear_chat_history': {
      const worktreeId = toStringValue(args.worktreeId)
      if (!worktreeId) return null
      const sessions = getWorktreeSessions(worktreeId)
      for (const session of sessions.sessions) {
        session.messages = []
      }
      return null
    }

    case 'set_session_model': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      const model = toStringValue(args.model)
      if (!worktreeId || !sessionId || !model) return null
      const located = findSession(worktreeId, sessionId)
      if (located) {
        located.session.selected_model = model
      }
      return null
    }

    case 'set_session_thinking_level': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      const level = toStringValue(args.thinkingLevel)
      if (!worktreeId || !sessionId || !level) return null
      const located = findSession(worktreeId, sessionId)
      if (located) {
        located.session.selected_thinking_level =
          level as Session['selected_thinking_level']
      }
      return null
    }

    case 'set_worktree_model':
    case 'set_worktree_thinking_level':
      return null

    case 'mark_plan_approved': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      const messageId = toStringValue(args.messageId)
      if (!worktreeId || !sessionId || !messageId) return null
      const located = findSession(worktreeId, sessionId)
      if (located) {
        const message = located.session.messages.find(
          item => item.id === messageId
        )
        if (message) {
          message.plan_approved = true
        }
      }
      return null
    }

    case 'update_session_state': {
      const worktreeId = toStringValue(args.worktreeId)
      const sessionId = toStringValue(args.sessionId)
      if (!worktreeId || !sessionId) return null
      const located = findSession(worktreeId, sessionId)
      if (!located) return null

      if (Array.isArray(args.answeredQuestions)) {
        located.session.answered_questions = toStringArray(
          args.answeredQuestions
        )
      }
      if (args.submittedAnswers && typeof args.submittedAnswers === 'object') {
        located.session.submitted_answers = clone(
          args.submittedAnswers as Session['submitted_answers']
        )
      }
      if (Array.isArray(args.fixedFindings)) {
        located.session.fixed_findings = toStringArray(args.fixedFindings)
      }
      if (Array.isArray(args.pendingPermissionDenials)) {
        located.session.pending_permission_denials = clone(
          args.pendingPermissionDenials as Session['pending_permission_denials']
        )
      }
      if (args.deniedMessageContext === null) {
        located.session.denied_message_context = undefined
      } else if (
        args.deniedMessageContext &&
        typeof args.deniedMessageContext === 'object'
      ) {
        located.session.denied_message_context = clone(
          args.deniedMessageContext as Session['denied_message_context']
        )
      }
      if (typeof args.isReviewing === 'boolean') {
        located.session.is_reviewing = args.isReviewing
      }
      if (typeof args.waitingForInput === 'boolean') {
        located.session.waiting_for_input = args.waitingForInput
      }
      return null
    }

    case 'broadcast_session_setting': {
      const sessionId = toStringValue(args.sessionId)
      const key = toStringValue(args.key)
      const value = toStringValue(args.value)
      if (sessionId && key && value) {
        window.setTimeout(() => {
          void emitEvent('session:setting-changed', {
            session_id: sessionId,
            key,
            value,
          })
        }, 5)
      }
      return null
    }

    case 'list_github_issues':
    case 'list_github_prs':
    case 'search_github_issues':
    case 'search_github_prs':
      return []

    case 'get_github_issue': {
      const issueNumber = Number(args.issueNumber ?? 1)
      return {
        number: issueNumber,
        title: `Mock issue #${issueNumber}`,
        body: 'Mock issue body',
        comments: [],
      }
    }

    case 'get_github_pr': {
      const prNumber = Number(args.prNumber ?? 1)
      return {
        number: prNumber,
        title: `Mock PR #${prNumber}`,
        body: 'Mock PR body',
        state: 'open',
        author: { login: 'mock-user' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        merged_at: null,
        url: `https://github.com/mock/repo/pull/${prNumber}`,
        headRefName: `feature/mock-${prNumber}`,
        baseRefName: 'main',
        comments: [],
        reviews: [],
      }
    }

    case 'list_loaded_issue_contexts':
    case 'list_loaded_pr_contexts':
    case 'list_saved_contexts':
    case 'list_claude_skills':
    case 'list_claude_commands':
    case 'list_worktree_files':
      return command === 'list_saved_contexts' ? { contexts: [] } : []

    case 'get_run_script':
      return null
    case 'get_app_data_dir':
      return '/tmp/mock-app-data'
    case 'fetch_worktrees_status':
    case 'set_active_worktree_for_polling':
    case 'set_app_focus_state':
    case 'set_git_poll_interval':
    case 'set_remote_poll_interval':
    case 'trigger_immediate_git_poll':
    case 'trigger_immediate_remote_poll':
      return null
    case 'get_git_poll_interval':
    case 'get_remote_poll_interval':
      return 60

    case 'check_git_identity':
      return { name: 'Mock User', email: 'mock@example.com' }
    case 'set_git_identity':
      return null

    case 'has_running_sessions':
      return false

    default:
      return null
  }
}

export async function setupPlaywrightMocks(): Promise<void> {
  state = createInitialState()
  mockWindows('main')
  const { emit } = await import('@tauri-apps/api/event')
  emitEventFn = emit
  mockIPC((command, payload) => handleInvoke(command, payload), {
    shouldMockEvents: true,
  })
}
