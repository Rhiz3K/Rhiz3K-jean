import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { invoke } from '@/lib/transport'
import { useCreateWorktree, projectsQueryKeys } from './projects'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { Worktree } from '@/types/projects'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => undefined),
  convertFileSrc: (path: string) => path,
  preloadInitialData: vi.fn().mockResolvedValue(null),
  hasPreloadedData: vi.fn(() => false),
  getPreloadedData: vi.fn(() => null),
  useWsConnectionStatus: () => true,
  useWsAuthError: () => null,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('projects: worktree creation fallback polling', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      addProjectDialogOpen: false,
      projectSettingsDialogOpen: false,
      projectSettingsProjectId: null,
      gitInitModalOpen: false,
      gitInitModalPath: null,
      editingFolderId: null,
    })

    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: {},
      reviewResults: {},
      viewingReviewTab: {},
      fixedReviewFindings: {},
      worktreePaths: {},
      sendingSessionIds: {},
      waitingForInputSessionIds: {},
      sessionWorktreeMap: {},
      streamingContents: {},
      activeToolCalls: {},
      streamingContentBlocks: {},
      streamingThinkingContent: {},
      inputDrafts: {},
      executionModes: {},
      thinkingLevels: {},
      manualThinkingOverrides: {},
      selectedModels: {},
      answeredQuestions: {},
      submittedAnswers: {},
      errors: {},
      lastSentMessages: {},
      setupScriptResults: {},
      pendingImages: {},
      pendingFiles: {},
      pendingTextFiles: {},
      activeTodos: {},
      fixedFindings: {},
      streamingPlanApprovals: {},
      messageQueues: {},
      executingModes: {},
      approvedTools: {},
      pendingPermissionDenials: {},
      deniedMessageContext: {},
      lastCompaction: {},
      reviewingSessions: {},
      savingContext: {},
      skippedQuestionSessions: {},
    })

    // Ensure auto-investigate sets exist (applyWorktreeCreated reads them)
    useUIStore.setState({
      autoInvestigateWorktreeIds: new Set<string>(),
      autoInvestigatePRWorktreeIds: new Set<string>(),
    })

    vi.mocked(invoke).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__
  })

  it('polls get_worktree when worktree:created event is missed and marks it ready', async () => {
    const projectId = 'p1'
    const worktreeId = 'w1'

    const createdWorktree: Worktree = {
      id: worktreeId,
      project_id: projectId,
      name: 'WT',
      path: '/tmp/wt',
      branch: 'wt-branch',
      created_at: 0,
      order: 0,
      status: 'ready',
      archived: false,
    } as Worktree

    let getWorktreeCalls = 0
    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === 'create_worktree') {
          return createdWorktree
        }
        if (cmd === 'get_worktree') {
          getWorktreeCalls += 1
          if (getWorktreeCalls === 1) {
            throw new Error('not yet')
          }
          expect(args).toEqual({ worktreeId })
          return createdWorktree
        }
        throw new Error(`unexpected invoke: ${cmd}`)
      }
    )

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useCreateWorktree(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ projectId })
    })

    const listKey = projectsQueryKeys.worktrees(projectId)
    const list = queryClient.getQueryData<Worktree[]>(listKey)
    expect(list?.[0]?.id).toBe(worktreeId)
    expect(list?.[0]?.status).toBe('pending')

    // First poll scheduled at 1500ms, fails once, then retries after 1000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })

    const updated = queryClient.getQueryData<Worktree[]>(listKey)
    expect(updated?.[0]?.status).toBe('ready')

    // Stores updated by applyWorktreeCreated
    expect(useProjectsStore.getState().selectedWorktreeId).toBe(worktreeId)
    expect(useChatStore.getState().activeWorktreeId).toBe(worktreeId)
    expect(useChatStore.getState().activeWorktreePath).toBe('/tmp/wt')
  })
})
