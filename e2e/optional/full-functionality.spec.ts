import { expect, test, type Page } from '@playwright/test'

type JsonRecord = Record<string, unknown>

const TEST_PROJECT_PATH = '/tmp/mock-full-project'

test.describe.configure({ mode: 'serial' })

async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Add Your First Project' })
  ).toBeVisible()
}

async function invoke<T = unknown>(
  page: Page,
  command: string,
  args: JsonRecord = {}
): Promise<T> {
  return page.evaluate(
    async ({ command, args }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__
      const invokeFn = (
        internals as { invoke?: (cmd: string, payload?: unknown) => Promise<unknown> }
      )?.invoke
      if (!invokeFn) {
        throw new Error('window.__TAURI_INTERNALS__.invoke is not available')
      }
      return invokeFn(command, args)
    },
    { command, args }
  ) as Promise<T>
}

function toRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }
  throw new Error(`Expected object, got ${typeof value}`)
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  throw new Error('Expected array')
}

async function seedProject(page: Page): Promise<{
  projectId: string
  baseWorktreeId: string
  codexWorktreeId: string
}> {
  const project = toRecord(
    await invoke(page, 'init_project', { path: TEST_PROJECT_PATH })
  )
  const projectId = String(project.id)

  const base = toRecord(
    await invoke(page, 'create_base_session', {
      projectId,
      agent: 'claude',
    })
  )
  const baseWorktreeId = String(base.id)

  const codex = toRecord(
    await invoke(page, 'create_worktree', {
      projectId,
      customName: 'codex-worktree-full',
      agent: 'codex',
    })
  )
  const codexWorktreeId = String(codex.id)

  return { projectId, baseWorktreeId, codexWorktreeId }
}

async function getActiveSessionId(
  page: Page,
  worktreeId: string
): Promise<string> {
  const sessions = toRecord(
    await invoke(page, 'get_sessions', {
      worktreeId,
      includeMessageCounts: true,
    })
  )
  return String(sessions.active_session_id)
}

test('command surface: startup, plugin and environment checks', async ({
  page,
}) => {
  await openApp(page)

  const savePath = await invoke<string>(page, 'plugin:dialog|save')
  const openPath = await invoke<string>(page, 'plugin:dialog|open')
  const askResult = await invoke<boolean>(page, 'plugin:dialog|ask')
  const updater = await invoke<unknown>(page, 'plugin:updater|check')
  const windows = toArray(await invoke(page, 'plugin:window|get_all_windows'))
  expect(savePath).toContain('/tmp/mock-project-')
  expect(openPath).toBe('/tmp/mock-existing-project')
  expect(askResult).toBe(false)
  expect(updater).toBeNull()
  expect(windows.length).toBeGreaterThan(0)

  expect(await invoke(page, 'plugin:window|is_maximized')).toBe(false)
  expect(await invoke(page, 'plugin:window|is_fullscreen')).toBe(false)
  expect(await invoke(page, 'plugin:window|is_minimized')).toBe(false)
  expect(await invoke(page, 'plugin:window|is_focused')).toBe(true)

  const prefs = toRecord(await invoke(page, 'load_preferences'))
  expect(String(prefs.theme)).toBeTruthy()
  const nextPrefs = { ...prefs, theme: 'dark' }
  await invoke(page, 'save_preferences', { preferences: nextPrefs })
  const savedPrefs = toRecord(await invoke(page, 'load_preferences'))
  expect(savedPrefs.theme).toBe('dark')

  const uiState = toRecord(await invoke(page, 'load_ui_state'))
  expect(uiState).toBeTruthy()
  const nextUiState = { ...uiState, panelSizes: [35, 65] }
  await invoke(page, 'save_ui_state', { uiState: nextUiState })
  const savedUiState = toRecord(await invoke(page, 'load_ui_state'))
  expect(savedUiState.panelSizes).toEqual([35, 65])

  const claudeInstalled = toRecord(await invoke(page, 'check_claude_cli_installed'))
  const codexInstalled = toRecord(await invoke(page, 'check_codex_cli_installed'))
  const ghInstalled = toRecord(await invoke(page, 'check_gh_cli_installed'))
  const claudeAuth = toRecord(await invoke(page, 'check_claude_cli_auth'))
  const codexAuth = toRecord(await invoke(page, 'check_codex_cli_auth'))
  const ghAuth = toRecord(await invoke(page, 'check_gh_cli_auth'))
  expect(claudeInstalled.installed).toBe(true)
  expect(codexInstalled.installed).toBe(true)
  expect(ghInstalled.installed).toBe(true)
  expect(claudeAuth.authenticated).toBe(true)
  expect(codexAuth.authenticated).toBe(true)
  expect(ghAuth.authenticated).toBe(true)

  expect(toArray(await invoke(page, 'get_available_cli_versions'))).toEqual([])
  expect(toArray(await invoke(page, 'get_available_codex_versions'))).toEqual(
    []
  )
  expect(toArray(await invoke(page, 'get_available_gh_versions'))).toEqual([])

  expect(await invoke(page, 'kill_all_terminals')).toBe(0)
  expect(toArray(await invoke(page, 'check_resumable_sessions'))).toEqual([])
  expect(await invoke(page, 'resume_session')).toBeNull()
  expect(await invoke(page, 'cleanup_old_recovery_files')).toBe(0)
  expect(toRecord(await invoke(page, 'cleanup_old_archives'))).toEqual({
    deleted_worktrees: 0,
    deleted_sessions: 0,
    deleted_contexts: 0,
  })
})

test('project/worktree/session lifecycle commands', async ({ page }) => {
  await openApp(page)

  const project = toRecord(
    await invoke(page, 'init_project', { path: TEST_PROJECT_PATH })
  )
  const projectId = String(project.id)

  const listedProjects = toArray(await invoke(page, 'list_projects'))
  expect(listedProjects.length).toBe(1)

  const base = toRecord(
    await invoke(page, 'create_base_session', { projectId, agent: 'claude' })
  )
  const codex = toRecord(
    await invoke(page, 'create_worktree', {
      projectId,
      customName: 'codex-worktree-full',
      agent: 'codex',
    })
  )
  const extra = toRecord(
    await invoke(page, 'create_worktree_from_existing_branch', {
      projectId,
      agent: 'claude',
    })
  )

  const baseId = String(base.id)
  const codexId = String(codex.id)
  const extraId = String(extra.id)

  const worktrees = toArray(await invoke(page, 'list_worktrees', { projectId }))
  expect(worktrees.length).toBe(3)

  const fetchedCodex = toRecord(
    await invoke(page, 'get_worktree', { worktreeId: codexId })
  )
  expect(fetchedCodex.id).toBe(codexId)

  await invoke(page, 'archive_worktree', { worktreeId: codexId })
  const archived1 = toArray(await invoke(page, 'list_archived_worktrees'))
  expect(archived1.length).toBe(1)

  const restored = toRecord(
    await invoke(page, 'unarchive_worktree', { worktreeId: codexId })
  )
  expect(restored.id).toBe(codexId)

  await invoke(page, 'archive_worktree', { worktreeId: extraId })
  await invoke(page, 'permanently_delete_worktree', { worktreeId: extraId })
  expect(toArray(await invoke(page, 'list_archived_worktrees')).length).toBe(0)

  const session = toRecord(
    await invoke(page, 'create_session', {
      worktreeId: codexId,
      name: 'Session Alpha',
    })
  )
  const sessionId = String(session.id)

  await invoke(page, 'rename_session', {
    worktreeId: codexId,
    sessionId,
    newName: 'Session Beta',
  })
  await invoke(page, 'set_active_session', {
    worktreeId: codexId,
    sessionId,
  })
  const renamed = toRecord(
    await invoke(page, 'get_session', {
      worktreeId: codexId,
      sessionId,
    })
  )
  expect(renamed.name).toBe('Session Beta')

  await invoke(page, 'archive_session', {
    worktreeId: codexId,
    sessionId,
  })
  const archivedSessions = toArray(
    await invoke(page, 'list_archived_sessions', { worktreeId: codexId })
  )
  expect(archivedSessions.length).toBe(1)

  const unarchived = toRecord(
    await invoke(page, 'unarchive_session', {
      worktreeId: codexId,
      sessionId,
    })
  )
  expect(unarchived.id).toBe(sessionId)

  await invoke(page, 'archive_session', {
    worktreeId: codexId,
    sessionId,
  })
  const restoredWithBase = toRecord(
    await invoke(page, 'restore_session_with_base', {
      sessionId,
      projectId,
    })
  )
  expect(toRecord(restoredWithBase.session).id).toBe(sessionId)

  await invoke(page, 'archive_session', {
    worktreeId: codexId,
    sessionId,
  })
  await invoke(page, 'delete_archived_session', { sessionId })
  expect(
    toArray(await invoke(page, 'list_all_archived_sessions')).length
  ).toBe(0)

  const allSessions = toRecord(await invoke(page, 'list_all_sessions'))
  expect(toArray(allSessions.entries).length).toBeGreaterThan(0)

  await invoke(page, 'close_base_session', { worktreeId: baseId })
  await invoke(page, 'close_base_session_clean', { worktreeId: baseId })
  await invoke(page, 'delete_worktree', { worktreeId: codexId })
  expect(toArray(await invoke(page, 'list_archived_worktrees')).length).toBe(0)

  const archiveCleanup = toRecord(await invoke(page, 'delete_all_archives'))
  expect(Number(archiveCleanup.deleted_worktrees)).toBeGreaterThanOrEqual(0)
  expect(Number(archiveCleanup.deleted_sessions)).toBeGreaterThanOrEqual(0)
})

test('chat, model, thinking and question/answer flows', async ({ page }) => {
  await openApp(page)

  const { baseWorktreeId, codexWorktreeId } = await seedProject(page)
  const baseSessionId = await getActiveSessionId(page, baseWorktreeId)
  const codexSessionId = await getActiveSessionId(page, codexWorktreeId)

  const baseResponse = toRecord(
    await invoke(page, 'send_chat_message', {
      worktreeId: baseWorktreeId,
      sessionId: baseSessionId,
      message: 'base-simple-check',
      agent: 'claude',
      executionMode: 'plan',
      thinkingLevel: 'ultrathink',
    })
  )
  expect(String(baseResponse.content)).toContain('[mock:claude] processed:')

  await invoke(page, 'set_session_model', {
    worktreeId: baseWorktreeId,
    sessionId: baseSessionId,
    model: 'opus',
  })
  await invoke(page, 'set_session_thinking_level', {
    worktreeId: baseWorktreeId,
    sessionId: baseSessionId,
    thinkingLevel: 'ultrathink',
  })
  await invoke(page, 'set_worktree_model', {
    worktreeId: baseWorktreeId,
    model: 'opus',
  })
  await invoke(page, 'set_worktree_thinking_level', {
    worktreeId: baseWorktreeId,
    thinkingLevel: 'ultrathink',
  })

  const assistantMessageId = String(baseResponse.id)
  await invoke(page, 'mark_plan_approved', {
    worktreeId: baseWorktreeId,
    sessionId: baseSessionId,
    messageId: assistantMessageId,
  })

  await invoke(page, 'update_session_state', {
    worktreeId: baseWorktreeId,
    sessionId: baseSessionId,
    answeredQuestions: ['tool-1'],
    submittedAnswers: { 'tool-1': ['Archive and restore'] },
    fixedFindings: ['finding-1'],
    pendingPermissionDenials: [],
    deniedMessageContext: null,
    isReviewing: true,
    waitingForInput: true,
  })
  await invoke(page, 'broadcast_session_setting', {
    sessionId: baseSessionId,
    key: 'execution_mode',
    value: 'plan',
  })

  const updatedSession = toRecord(
    await invoke(page, 'get_session', {
      worktreeId: baseWorktreeId,
      sessionId: baseSessionId,
    })
  )
  expect(updatedSession.selected_model).toBe('opus')
  expect(updatedSession.selected_thinking_level).toBe('ultrathink')
  expect(updatedSession.is_reviewing).toBe(true)
  expect(updatedSession.waiting_for_input).toBe(true)
  expect(toArray(updatedSession.answered_questions).length).toBe(1)

  const codexResponse = toRecord(
    await invoke(page, 'send_chat_message', {
      worktreeId: codexWorktreeId,
      sessionId: codexSessionId,
      message: 'codex-simple-check',
      agent: 'codex',
      model: 'gpt-5.3-codex',
      executionMode: 'build',
      thinkingLevel: 'medium',
    })
  )
  expect(String(codexResponse.content)).toContain('[mock:codex] processed:')

  const questionResponse = toRecord(
    await invoke(page, 'send_chat_message', {
      worktreeId: codexWorktreeId,
      sessionId: codexSessionId,
      message: 'ask me one question with options',
      agent: 'codex',
    })
  )
  const toolCalls = toArray(questionResponse.tool_calls)
  expect(toolCalls.length).toBe(1)
  const toolCall = toRecord(toolCalls[0])
  expect(toolCall.name).toBe('AskUserQuestion')

  const answerResponse = toRecord(
    await invoke(page, 'send_chat_message', {
      worktreeId: codexWorktreeId,
      sessionId: codexSessionId,
      message: 'For "Which flow should I validate next?" answer with: Archive and restore',
      agent: 'codex',
    })
  )
  expect(String(answerResponse.content)).toContain(
    'Answer received and processing continued'
  )

  expect(await invoke(page, 'cancel_chat_message')).toBe(true)
  await invoke(page, 'clear_session_history', {
    worktreeId: baseWorktreeId,
    sessionId: baseSessionId,
  })
  await invoke(page, 'clear_chat_history', { worktreeId: codexWorktreeId })

  const clearedBaseSession = toRecord(
    await invoke(page, 'get_session', {
      worktreeId: baseWorktreeId,
      sessionId: baseSessionId,
    })
  )
  expect(toArray(clearedBaseSession.messages)).toEqual([])
  expect(await invoke(page, 'has_running_sessions')).toBe(false)
})

test('github, context and polling commands', async ({ page }) => {
  await openApp(page)

  expect(toArray(await invoke(page, 'list_github_issues'))).toEqual([])
  expect(toArray(await invoke(page, 'list_github_prs'))).toEqual([])
  expect(toArray(await invoke(page, 'search_github_issues'))).toEqual([])
  expect(toArray(await invoke(page, 'search_github_prs'))).toEqual([])

  const issue = toRecord(await invoke(page, 'get_github_issue', { issueNumber: 12 }))
  const pr = toRecord(await invoke(page, 'get_github_pr', { prNumber: 34 }))
  expect(issue.number).toBe(12)
  expect(pr.number).toBe(34)
  expect(String(pr.url)).toContain('/pull/34')

  expect(toArray(await invoke(page, 'list_loaded_issue_contexts'))).toEqual([])
  expect(toArray(await invoke(page, 'list_loaded_pr_contexts'))).toEqual([])
  expect(toRecord(await invoke(page, 'list_saved_contexts'))).toEqual({
    contexts: [],
  })
  expect(toArray(await invoke(page, 'list_claude_skills'))).toEqual([])
  expect(toArray(await invoke(page, 'list_claude_commands'))).toEqual([])
  expect(toArray(await invoke(page, 'list_worktree_files'))).toEqual([])

  expect(await invoke(page, 'get_run_script')).toBeNull()
  expect(await invoke(page, 'get_app_data_dir')).toBe('/tmp/mock-app-data')
  expect(await invoke(page, 'fetch_worktrees_status')).toBeNull()
  expect(await invoke(page, 'set_active_worktree_for_polling')).toBeNull()
  expect(await invoke(page, 'set_app_focus_state')).toBeNull()
  expect(await invoke(page, 'set_git_poll_interval')).toBeNull()
  expect(await invoke(page, 'set_remote_poll_interval')).toBeNull()
  expect(await invoke(page, 'trigger_immediate_git_poll')).toBeNull()
  expect(await invoke(page, 'trigger_immediate_remote_poll')).toBeNull()
  expect(await invoke(page, 'get_git_poll_interval')).toBe(60)
  expect(await invoke(page, 'get_remote_poll_interval')).toBe(60)

  expect(toRecord(await invoke(page, 'check_git_identity'))).toEqual({
    name: 'Mock User',
    email: 'mock@example.com',
  })
  expect(await invoke(page, 'set_git_identity')).toBeNull()
})
