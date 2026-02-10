import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { useContextOperations } from './useContextOperations'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import type { SaveContextResponse } from '@/types/chat'
import type { Worktree } from '@/types/projects'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useContextOperations', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('passes agent/model/reasoning to generate_context_from_session when Codex is selected', async () => {
    const queryClient = new QueryClient()

    const prefs: AppPreferences = {
      ...defaultPreferences,
      magic_prompts: {
        ...defaultPreferences.magic_prompts,
        context_summary: 'custom summary prompt',
      },
      magic_prompt_codex_models: {
        ...defaultPreferences.magic_prompt_codex_models,
        context_summary_model: 'gpt-5.2-codex',
      },
      magic_prompt_codex_reasoning_efforts: {
        ...defaultPreferences.magic_prompt_codex_reasoning_efforts,
        context_summary_model: 'medium',
      },
    }

    const resp: SaveContextResponse = {
      id: 'ctx-1',
      filename: 'ctx.md',
      path: '/tmp/ctx.md',
      size: 123,
    }
    vi.mocked(invoke).mockResolvedValueOnce(resp as unknown as never)

    const { result } = renderHook(() =>
      useContextOperations({
        activeSessionId: 's1',
        sessionAgent: 'codex',
        activeWorktreeId: 'w1',
        activeWorktreePath: '/tmp/w1',
        worktree: {
          id: 'w1',
          project_id: 'p1',
          name: 'proj',
          path: '/tmp/w1',
          branch: 'b',
          created_at: 0,
          order: 0,
        } as Worktree,
        queryClient,
        preferences: prefs,
      })
    )

    await result.current.handleSaveContext()

    expect(invoke).toHaveBeenCalledWith('generate_context_from_session', {
      worktreePath: '/tmp/w1',
      worktreeId: 'w1',
      sourceSessionId: 's1',
      projectName: 'proj',
      customPrompt: 'custom summary prompt',
      agent: 'codex',
      model: 'gpt-5.2-codex',
      codexReasoningEffort: 'medium',
    })
  })
})
