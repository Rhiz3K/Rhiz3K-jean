import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { invoke } from '@/lib/transport'
import { ThemeProviderContext } from '@/lib/theme-context'
import { useChatStore } from '@/store/chat-store'
import { useCommandContext } from './use-command-context'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import type { ReviewResponse } from '@/types/projects'
import type { Session } from '@/types/chat'
import { chatQueryKeys } from '@/services/chat'

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
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/notifications', () => ({
  notify: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/services/git-status', () => ({
  gitPull: vi.fn().mockResolvedValue('ok'),
  triggerImmediateGitPoll: vi.fn().mockResolvedValue(undefined),
}))

describe('useCommandContext', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    useChatStore.setState({
      activeWorktreeId: 'w1',
      activeWorktreePath: '/tmp/w1',
      activeSessionIds: { w1: 's1' },
    })
  })

  it('runAIReview uses per-magic Codex model + reasoning effort', async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const prefs: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        code_review: 'custom review prompt',
      },
      magic_prompt_codex_models: {
        ...defaultPreferences.magic_prompt_codex_models,
        code_review_model: 'gpt-5.2',
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

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          ThemeProviderContext.Provider,
          { value: { theme: 'system', setTheme: vi.fn() } },
          children
        )
      )

    const { result } = renderHook(() => useCommandContext(prefs), { wrapper })

    qc.setQueryData(chatQueryKeys.session('s1'), {
      id: 's1',
      agent: 'codex',
    } as unknown as Session)

    await result.current.runAIReview()

    expect(invoke).toHaveBeenCalledWith('run_review_with_ai', {
      worktreePath: '/tmp/w1',
      customPrompt: 'custom review prompt',
      agent: 'codex',
      model: 'gpt-5.2',
      codexReasoningEffort: 'high',
    })
  })
})
