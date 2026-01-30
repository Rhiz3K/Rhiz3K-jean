import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useGitOperations } from './useGitOperations'
import { useChatStore } from '@/store/chat-store'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import type {
  CreateCommitResponse,
  CreatePrResponse,
  MergeConflictsResponse,
  Project,
  ReviewResponse,
  Worktree,
} from '@/types/projects'
import type { Session } from '@/types/chat'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
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

describe('useGitOperations', () => {
  beforeEach(() => {
    useChatStore.setState({
      worktreeLoadingOperations: {},
    })
    vi.mocked(invoke).mockReset()
  })

  it('passes agent/model/reasoning to create_commit_with_ai when Codex is selected', async () => {
    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        commit_message: 'custom commit prompt',
      },
      magic_prompt_agents: {
        ...defaultPreferences.magic_prompt_agents,
        commit_message_model: 'codex',
      },
      magic_prompt_codex_models: {
        ...defaultPreferences.magic_prompt_codex_models,
        commit_message_model: 'gpt-5.2',
      },
      magic_prompt_codex_reasoning_efforts: {
        ...defaultPreferences.magic_prompt_codex_reasoning_efforts,
        commit_message_model: 'low',
      },
    }

    const resp: CreateCommitResponse = {
      message: 'feat: test\n\nbody',
      commit_hash: 'abc',
      pushed: false,
    }
    vi.mocked(invoke).mockResolvedValueOnce(resp as unknown as never)

    const queryClient = new QueryClient()

    const { result } = renderHook(() =>
      useGitOperations({
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree: null,
        project: null,
        queryClient,
        inputRef: { current: null },
        preferences,
      })
    )

    await result.current.handleCommit()

    expect(invoke).toHaveBeenCalledWith('create_commit_with_ai', {
      worktreePath: '/tmp/w1',
      customPrompt: 'custom commit prompt',
      push: false,
      agent: 'codex',
      model: 'gpt-5.2',
      codexReasoningEffort: 'low',
    })
  })

  it('passes agent/model without codexReasoningEffort when Claude is selected', async () => {
    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        commit_message: 'custom commit prompt',
      },
      magic_prompt_agents: {
        ...defaultPreferences.magic_prompt_agents,
        commit_message_model: 'claude',
      },
      magic_prompt_models: {
        ...defaultPreferences.magic_prompt_models,
        commit_message_model: 'haiku',
      },
    }

    const resp: CreateCommitResponse = {
      message: 'feat: test\n\nbody',
      commit_hash: 'abc',
      pushed: false,
    }
    vi.mocked(invoke).mockResolvedValueOnce(resp as unknown as never)

    const queryClient = new QueryClient()

    const { result } = renderHook(() =>
      useGitOperations({
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree: null,
        project: null,
        queryClient,
        inputRef: { current: null },
        preferences,
      })
    )

    await result.current.handleCommit()

    expect(invoke).toHaveBeenCalledWith('create_commit_with_ai', {
      worktreePath: '/tmp/w1',
      customPrompt: 'custom commit prompt',
      push: false,
      agent: 'claude',
      model: 'haiku',
      codexReasoningEffort: undefined,
    })
  })

  it('passes agent/model/reasoning to create_pr_with_ai_content when Codex is selected', async () => {
    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        pr_content: 'custom pr prompt',
      },
      magic_prompt_agents: {
        ...defaultPreferences.magic_prompt_agents,
        pr_content_model: 'codex',
      },
      magic_prompt_codex_models: {
        ...defaultPreferences.magic_prompt_codex_models,
        pr_content_model: 'gpt-5.2',
      },
      magic_prompt_codex_reasoning_efforts: {
        ...defaultPreferences.magic_prompt_codex_reasoning_efforts,
        pr_content_model: 'medium',
      },
    }

    const resp: CreatePrResponse = {
      pr_number: 1,
      pr_url: 'https://example.com/pr/1',
      title: 'PR title',
    }
    vi.mocked(invoke).mockResolvedValueOnce(resp as unknown as never)

    const queryClient = new QueryClient()
    const worktree: Worktree = {
      id: 'w1',
      project_id: 'p1',
      name: 'wt',
      path: '/tmp/w1',
      branch: 'b',
      created_at: 0,
      order: 0,
    }

    const { result } = renderHook(() =>
      useGitOperations({
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree,
        project: null,
        queryClient,
        inputRef: { current: null },
        preferences,
      })
    )

    await result.current.handleOpenPr()

    expect(invoke).toHaveBeenCalledWith('create_pr_with_ai_content', {
      worktreePath: '/tmp/w1',
      customPrompt: 'custom pr prompt',
      agent: 'codex',
      model: 'gpt-5.2',
      codexReasoningEffort: 'medium',
    })
  })

  it('passes agent/model/reasoning to run_review_with_ai when Codex is selected', async () => {
    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        code_review: 'custom review prompt',
      },
      magic_prompt_agents: {
        ...defaultPreferences.magic_prompt_agents,
        code_review_model: 'codex',
      },
      magic_prompt_codex_models: {
        ...defaultPreferences.magic_prompt_codex_models,
        code_review_model: 'gpt-5.2-codex',
      },
      magic_prompt_codex_reasoning_efforts: {
        ...defaultPreferences.magic_prompt_codex_reasoning_efforts,
        code_review_model: 'high',
      },
    }

    const resp: ReviewResponse = {
      approval_status: 'approved',
      summary: 'ok',
      findings: [],
    }
    vi.mocked(invoke).mockResolvedValueOnce(resp as unknown as never)

    const queryClient = new QueryClient()

    const { result } = renderHook(() =>
      useGitOperations({
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree: null,
        project: null,
        queryClient,
        inputRef: { current: null },
        preferences,
      })
    )

    await result.current.handleReview()

    expect(invoke).toHaveBeenCalledWith('run_review_with_ai', {
      worktreePath: '/tmp/w1',
      customPrompt: 'custom review prompt',
      agent: 'codex',
      model: 'gpt-5.2-codex',
      codexReasoningEffort: 'high',
    })
  })

  it('resolve conflicts creates a new session and applies per-magic agent/model defaults (Codex)', async () => {
    vi.useFakeTimers()

    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        resolve_conflicts: 'custom resolve instructions',
      },
      magic_prompt_agents: {
        ...defaultPreferences.magic_prompt_agents,
        resolve_conflicts_model: 'codex',
      },
      magic_prompt_codex_models: {
        ...defaultPreferences.magic_prompt_codex_models,
        resolve_conflicts_model: 'gpt-5.2',
      },
      magic_prompt_codex_reasoning_efforts: {
        ...defaultPreferences.magic_prompt_codex_reasoning_efforts,
        resolve_conflicts_model: 'low',
      },
    }

    const conflictsResp: MergeConflictsResponse = {
      has_conflicts: true,
      conflicts: ['a.txt'],
      conflict_diff: '<<<',
    }

    const newSession: Session = {
      id: 's-new',
      name: 'Resolve conflicts',
      order: 0,
      created_at: 0,
      messages: [],
    }

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_merge_conflicts') return conflictsResp as never
      if (cmd === 'create_session') return newSession as never
      throw new Error(`unexpected invoke: ${cmd}`)
    })

    const queryClient = new QueryClient()
    const worktree: Worktree = {
      id: 'w1',
      project_id: 'p1',
      name: 'wt',
      path: '/tmp/w1',
      branch: 'b',
      created_at: 0,
      order: 0,
    }

    const focus = vi.fn()
    const inputRef = { current: { focus } as unknown as HTMLTextAreaElement }

    const { result } = renderHook(() =>
      useGitOperations({
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree,
        project: null,
        queryClient,
        inputRef,
        preferences,
      })
    )

    await result.current.handleResolveConflicts()
    await vi.runOnlyPendingTimersAsync()

    const state = useChatStore.getState()
    expect(state.activeSessionIds['w1']).toBe('s-new')
    expect(state.agents['s-new']).toBe('codex')
    expect(state.selectedModels['s-new']).toBe('gpt-5.2')
    expect(state.thinkingLevels['s-new']).toBe('low')
    expect(state.inputDrafts['s-new']).toContain('custom resolve instructions')

    vi.useRealTimers()
  })

  it('resolve PR conflicts uses project default_branch in the generated prompt', async () => {
    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        resolve_conflicts: 'custom resolve instructions',
      },
      magic_prompt_agents: {
        ...defaultPreferences.magic_prompt_agents,
        resolve_conflicts_model: 'claude',
      },
      magic_prompt_models: {
        ...defaultPreferences.magic_prompt_models,
        resolve_conflicts_model: 'sonnet',
      },
    }

    const conflictsResp: MergeConflictsResponse = {
      has_conflicts: true,
      conflicts: ['a.txt'],
      conflict_diff: '<<<',
    }

    const newSession: Session = {
      id: 's-pr',
      name: 'PR: resolve conflicts',
      order: 0,
      created_at: 0,
      messages: [],
    }

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'fetch_and_merge_base') return conflictsResp as never
      if (cmd === 'create_session') return newSession as never
      throw new Error(`unexpected invoke: ${cmd}`)
    })

    const queryClient = new QueryClient()
    const worktree: Worktree = {
      id: 'w1',
      project_id: 'p1',
      name: 'wt',
      path: '/tmp/w1',
      branch: 'b',
      created_at: 0,
      order: 0,
    }

    const project = {
      id: 'p1',
      name: 'proj',
      path: '/tmp',
      default_branch: 'develop',
      is_folder: false,
      added_at: 0,
      order: 0,
    } as Project

    const { result } = renderHook(() =>
      useGitOperations({
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree,
        project,
        queryClient,
        inputRef: { current: null },
        preferences,
      })
    )

    await result.current.handleResolvePrConflicts()

    const state = useChatStore.getState()
    expect(state.activeSessionIds['w1']).toBe('s-pr')
    expect(state.selectedModels['s-pr']).toBe('sonnet')
    expect(state.inputDrafts['s-pr']).toContain('origin/develop')
    expect(state.inputDrafts['s-pr']).toContain('custom resolve instructions')
  })
})
