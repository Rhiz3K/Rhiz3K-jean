import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MagicPromptsPane } from './MagicPromptsPane'
import {
  DEFAULT_MAGIC_PROMPTS,
  DEFAULT_MAGIC_PROMPT_AGENTS,
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

  it('shows only Claude model badge when agent is Claude', () => {
    mockUsePreferences.mockReturnValue({
      data: {
        magic_prompts: DEFAULT_MAGIC_PROMPTS,
        magic_prompt_agents: {
          ...DEFAULT_MAGIC_PROMPT_AGENTS,
          investigate_model: 'claude',
        },
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

    const investigateBtn = screen.getByRole('button', { name: /Investigate Issue/i })
    expect(within(investigateBtn).getByText('opus')).toBeInTheDocument()
    expect(within(investigateBtn).queryByText('c-low')).not.toBeInTheDocument()
  })

  it('shows only Codex reasoning badge when agent is Codex (with c- prefix for gpt-5.2-codex)', () => {
    mockUsePreferences.mockReturnValue({
      data: {
        magic_prompts: DEFAULT_MAGIC_PROMPTS,
        magic_prompt_agents: {
          ...DEFAULT_MAGIC_PROMPT_AGENTS,
          commit_message_model: 'codex',
        },
        magic_prompt_models: DEFAULT_MAGIC_PROMPT_MODELS,
        magic_prompt_codex_models: {
          ...DEFAULT_MAGIC_PROMPT_CODEX_MODELS,
          commit_message_model: 'gpt-5.2-codex',
        },
        magic_prompt_codex_reasoning_efforts: {
          ...DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS,
          commit_message_model: 'low',
        },
      },
    })

    render(<MagicPromptsPane />)

    const commitBtn = screen.getByRole('button', { name: /Commit Message/i })
    expect(within(commitBtn).getByText('c-low')).toBeInTheDocument()
    expect(within(commitBtn).queryByText('haiku')).not.toBeInTheDocument()
    expect(within(commitBtn).queryByText('sonnet')).not.toBeInTheDocument()
    expect(within(commitBtn).queryByText('opus')).not.toBeInTheDocument()
  })
})

