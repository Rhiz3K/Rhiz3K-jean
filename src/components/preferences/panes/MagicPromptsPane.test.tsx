import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MagicPromptsPane } from './MagicPromptsPane'
import {
  DEFAULT_MAGIC_PROMPTS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_MAGIC_PROMPT_CODEX_MODELS,
  DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS,
} from '@/types/preferences'

const mockUsePreferences = vi.fn()
const mockUseSavePreferences = vi.fn()

vi.mock('@/services/preferences', () => ({
  usePreferences: () => mockUsePreferences(),
  useSavePreferences: () => mockUseSavePreferences(),
}))

describe('MagicPromptsPane', () => {
  beforeEach(() => {
    mockUseSavePreferences.mockReturnValue({ mutate: vi.fn() })
  })

  it('shows combined badge (claude model / codex effort)', () => {
    mockUsePreferences.mockReturnValue({
      data: {
        magic_prompts: DEFAULT_MAGIC_PROMPTS,
        magic_prompt_models: {
          ...DEFAULT_MAGIC_PROMPT_MODELS,
          investigate_model: 'opus',
        },
        magic_prompt_codex_models: DEFAULT_MAGIC_PROMPT_CODEX_MODELS,
        magic_prompt_codex_reasoning_efforts:
          DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS,
      },
    })

    render(<MagicPromptsPane />)

    const investigateBtn = screen.getByRole('button', {
      name: /Investigate Issue/i,
    })
    expect(within(investigateBtn).getByText('opus/high')).toBeInTheDocument()
  })

  it('updates badge based on per-prompt selections', () => {
    mockUsePreferences.mockReturnValue({
      data: {
        magic_prompts: DEFAULT_MAGIC_PROMPTS,
        magic_prompt_models: {
          ...DEFAULT_MAGIC_PROMPT_MODELS,
          commit_message_model: 'sonnet',
        },
        magic_prompt_codex_models: DEFAULT_MAGIC_PROMPT_CODEX_MODELS,
        magic_prompt_codex_reasoning_efforts: {
          ...DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS,
          commit_message_model: 'medium',
        },
      },
    })

    render(<MagicPromptsPane />)

    const commitBtn = screen.getByRole('button', { name: /Commit Message/i })
    expect(within(commitBtn).getByText('sonnet/medium')).toBeInTheDocument()
  })
})
