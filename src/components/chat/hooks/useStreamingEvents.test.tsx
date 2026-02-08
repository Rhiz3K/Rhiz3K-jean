import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import useStreamingEvents from './useStreamingEvents'
import { useChatStore } from '@/store/chat-store'
import { chatQueryKeys } from '@/services/chat'
import { preferencesQueryKeys } from '@/services/preferences'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import type { ContentBlock, Session } from '@/types/chat'

interface ListenerEvent {
  payload: unknown
}
const listeners = new Map<string, (event: ListenerEvent) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, cb: (event: ListenerEvent) => void) => {
    listeners.set(eventName, cb)
    return Promise.resolve(() => undefined)
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/services/git-status', () => ({
  triggerImmediateGitPoll: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/projects', async () => {
  const actual = await vi.importActual('@/services/projects')
  return {
    ...(actual as Record<string, unknown>),
    saveWorktreePr: vi.fn().mockResolvedValue(undefined),
  }
})

describe('useStreamingEvents', () => {
  beforeEach(() => {
    listeners.clear()

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
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
  })

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__
  })

  it('preserves partial assistant output on chat:error', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const sessionId = 's1'
    const worktreeId = 'w1'

    const initialSession: Session = {
      id: sessionId,
      name: 'Session 1',
      order: 0,
      created_at: 0,
      messages: [],
    }

    queryClient.setQueryData(chatQueryKeys.session(sessionId), initialSession)
    const prefs: AppPreferences = {
      ...defaultPreferences,
      session_recap_enabled: false,
    }
    queryClient.setQueryData(preferencesQueryKeys.preferences(), prefs)

    useChatStore.getState().setActiveSession(worktreeId, sessionId)
    useChatStore.getState().setActiveWorktree(worktreeId, '/tmp')
    const blocks: ContentBlock[] = [{ type: 'text', text: 'partial output' }]
    useChatStore.setState({
      streamingContents: { [sessionId]: 'partial output' },
      activeToolCalls: { [sessionId]: [] },
      streamingContentBlocks: { [sessionId]: blocks },
    })

    renderHook(() => useStreamingEvents({ queryClient }))
    await Promise.resolve()

    const onError = listeners.get('chat:error')
    expect(onError).toBeDefined()

    onError?.({ payload: { session_id: sessionId, error: 'boom' } })

    const updated = queryClient.getQueryData<Session>(
      chatQueryKeys.session(sessionId)
    )
    expect(updated?.messages).toHaveLength(1)
    expect(updated?.messages[0]?.role).toBe('assistant')
    expect(updated?.messages[0]?.content).toBe('partial output')
  })

  it('invalidates the session query on chat:done (prevents stale placeholders after recovery)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const sessionId = 's2'
    const worktreeId = 'w2'

    const initialSession: Session = {
      id: sessionId,
      name: 'Session 2',
      order: 0,
      created_at: 0,
      messages: [],
    }
    queryClient.setQueryData(chatQueryKeys.session(sessionId), initialSession)
    const prefs: AppPreferences = {
      ...defaultPreferences,
      session_recap_enabled: false,
    }
    queryClient.setQueryData(preferencesQueryKeys.preferences(), prefs)

    useChatStore.getState().setActiveSession(worktreeId, sessionId)
    useChatStore.getState().setActiveWorktree(worktreeId, '/tmp')
    const blocks: ContentBlock[] = [{ type: 'text', text: 'done output' }]
    useChatStore.setState({
      streamingContents: { [sessionId]: 'done output' },
      activeToolCalls: { [sessionId]: [] },
      streamingContentBlocks: { [sessionId]: blocks },
    })

    renderHook(() => useStreamingEvents({ queryClient }))
    await Promise.resolve()

    const onDone = listeners.get('chat:done')
    expect(onDone).toBeDefined()

    onDone?.({ payload: { session_id: sessionId, worktree_id: worktreeId } })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.session(sessionId),
    })
  })
})
