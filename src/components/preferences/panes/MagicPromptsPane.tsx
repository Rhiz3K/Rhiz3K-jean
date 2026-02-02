import React, { useState, useCallback, useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  DEFAULT_INVESTIGATE_ISSUE_PROMPT,
  DEFAULT_INVESTIGATE_PR_PROMPT,
  DEFAULT_PR_CONTENT_PROMPT,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  DEFAULT_CODE_REVIEW_PROMPT,
  DEFAULT_CONTEXT_SUMMARY_PROMPT,
  DEFAULT_RESOLVE_CONFLICTS_PROMPT,
  DEFAULT_MAGIC_PROMPTS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_MAGIC_PROMPT_CODEX_MODELS,
  DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS,
  codexModelOptions,
  codexReasoningEffortOptions,
  type MagicPrompts,
  type MagicPromptModels,
  type MagicPromptCodexModels,
  type MagicPromptCodexReasoningEfforts,
  type ClaudeModel,
} from '@/types/preferences'
import { cn } from '@/lib/utils'
import type { ThinkingLevel } from '@/types/chat'

interface VariableInfo {
  name: string
  description: string
}

interface PromptConfig {
  key: keyof MagicPrompts
  modelKey: keyof MagicPromptModels &
    keyof MagicPromptCodexModels &
    keyof MagicPromptCodexReasoningEfforts
  label: string
  description: string
  variables: VariableInfo[]
  defaultValue: string
  defaultClaudeModel: ClaudeModel
}

const PROMPT_CONFIGS: PromptConfig[] = [
  {
    key: 'investigate_issue',
    modelKey: 'investigate_model',
    label: 'Investigate Issue',
    description: 'Prompt for analyzing GitHub issues loaded into the context.',
    variables: [
      { name: '{issueRefs}', description: 'Issue numbers (e.g., #123, #456)' },
      {
        name: '{issueWord}',
        description: '"issue" or "issues" based on count',
      },
    ],
    defaultValue: DEFAULT_INVESTIGATE_ISSUE_PROMPT,
    defaultClaudeModel: 'opus',
  },
  {
    key: 'investigate_pr',
    modelKey: 'investigate_model',
    label: 'Investigate PR',
    description:
      'Prompt for analyzing GitHub pull requests loaded into the context.',
    variables: [
      { name: '{prRefs}', description: 'PR numbers (e.g., #123, #456)' },
      {
        name: '{prWord}',
        description: '"pull request" or "pull requests" based on count',
      },
    ],
    defaultValue: DEFAULT_INVESTIGATE_PR_PROMPT,
    defaultClaudeModel: 'opus',
  },
  {
    key: 'pr_content',
    modelKey: 'pr_content_model',
    label: 'PR Content',
    description: 'Prompt for generating pull request titles and descriptions.',
    variables: [
      { name: '{current_branch}', description: 'Name of the feature branch' },
      {
        name: '{target_branch}',
        description: 'Branch to merge into (e.g., main)',
      },
      { name: '{commit_count}', description: 'Number of commits in the PR' },
      { name: '{commits}', description: 'List of commit messages' },
      { name: '{diff}', description: 'Git diff of all changes' },
    ],
    defaultValue: DEFAULT_PR_CONTENT_PROMPT,
    defaultClaudeModel: 'haiku',
  },
  {
    key: 'commit_message',
    modelKey: 'commit_message_model',
    label: 'Commit Message',
    description: 'Prompt for generating commit messages from staged changes.',
    variables: [
      { name: '{status}', description: 'Git status output' },
      { name: '{diff}', description: 'Staged changes diff' },
      {
        name: '{recent_commits}',
        description: 'Recent commit messages for style',
      },
      { name: '{remote_info}', description: 'Remote repository info' },
    ],
    defaultValue: DEFAULT_COMMIT_MESSAGE_PROMPT,
    defaultClaudeModel: 'haiku',
  },
  {
    key: 'code_review',
    modelKey: 'code_review_model',
    label: 'Code Review',
    description: 'Prompt for AI-powered code review of your changes.',
    variables: [
      { name: '{branch_info}', description: 'Source and target branch names' },
      { name: '{commits}', description: 'Commit history' },
      { name: '{diff}', description: 'Code changes diff' },
      { name: '{uncommitted_section}', description: 'Unstaged changes if any' },
    ],
    defaultValue: DEFAULT_CODE_REVIEW_PROMPT,
    defaultClaudeModel: 'haiku',
  },
  {
    key: 'context_summary',
    modelKey: 'context_summary_model',
    label: 'Context Summary',
    description: 'Prompt for summarizing conversations when saving context.',
    variables: [
      { name: '{project_name}', description: 'Name of the current project' },
      { name: '{date}', description: 'Current timestamp' },
      { name: '{conversation}', description: 'Full conversation history' },
    ],
    defaultValue: DEFAULT_CONTEXT_SUMMARY_PROMPT,
    defaultClaudeModel: 'opus',
  },
  {
    key: 'resolve_conflicts',
    modelKey: 'resolve_conflicts_model',
    label: 'Resolve Conflicts',
    description: 'Instructions appended to conflict resolution prompts.',
    variables: [],
    defaultValue: DEFAULT_RESOLVE_CONFLICTS_PROMPT,
    defaultClaudeModel: 'opus',
  },
]

const MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

export const MagicPromptsPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [selectedKey, setSelectedKey] =
    useState<keyof MagicPrompts>('investigate_issue')
  const [localValue, setLocalValue] = useState('')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const currentPrompts = preferences?.magic_prompts ?? DEFAULT_MAGIC_PROMPTS
  const currentClaudeModels =
    preferences?.magic_prompt_models ?? DEFAULT_MAGIC_PROMPT_MODELS
  const currentCodexModels =
    preferences?.magic_prompt_codex_models ?? DEFAULT_MAGIC_PROMPT_CODEX_MODELS
  const currentCodexEfforts =
    preferences?.magic_prompt_codex_reasoning_efforts ??
    DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS
  const selectedConfig = (PROMPT_CONFIGS.find(c => c.key === selectedKey) ??
    PROMPT_CONFIGS[0]) as (typeof PROMPT_CONFIGS)[number]
  const currentValue =
    currentPrompts[selectedKey] ?? selectedConfig.defaultValue
  const currentClaudeModel =
    currentClaudeModels[selectedConfig.modelKey] ??
    selectedConfig.defaultClaudeModel
  const currentCodexModel =
    currentCodexModels[selectedConfig.modelKey] ??
    DEFAULT_MAGIC_PROMPT_CODEX_MODELS[selectedConfig.modelKey]
  const currentCodexEffort = (currentCodexEfforts[selectedConfig.modelKey] ??
    DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS[
      selectedConfig.modelKey
    ]) as ThinkingLevel
  const isModified = currentValue !== selectedConfig.defaultValue

  // Sync local value when selection changes or external value updates
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalValue(currentValue)
  }, [currentValue, selectedKey])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue)

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Set new timeout for debounced save
      saveTimeoutRef.current = setTimeout(() => {
        if (!preferences) return
        savePreferences.mutate({
          ...preferences,
          magic_prompts: {
            ...currentPrompts,
            [selectedKey]: newValue,
          },
        })
      }, 500)
    },
    [preferences, savePreferences, currentPrompts, selectedKey]
  )

  const handleBlur = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (localValue !== currentValue && preferences) {
      savePreferences.mutate({
        ...preferences,
        magic_prompts: {
          ...currentPrompts,
          [selectedKey]: localValue,
        },
      })
    }
  }, [
    localValue,
    currentValue,
    preferences,
    savePreferences,
    currentPrompts,
    selectedKey,
  ])

  const handleReset = useCallback(() => {
    if (!preferences) return
    savePreferences.mutate({
      ...preferences,
      magic_prompts: {
        ...currentPrompts,
        [selectedKey]: selectedConfig.defaultValue,
      },
    })
  }, [
    preferences,
    savePreferences,
    currentPrompts,
    selectedKey,
    selectedConfig.defaultValue,
  ])

  const handleClaudeModelChange = useCallback(
    (model: ClaudeModel) => {
      if (!preferences) return
      savePreferences.mutate({
        ...preferences,
        magic_prompt_models: {
          ...currentClaudeModels,
          [selectedConfig.modelKey]: model,
        },
      })
    },
    [preferences, savePreferences, currentClaudeModels, selectedConfig.modelKey]
  )

  const handleCodexModelChange = useCallback(
    (model: string) => {
      if (!preferences) return
      savePreferences.mutate({
        ...preferences,
        magic_prompt_codex_models: {
          ...currentCodexModels,
          [selectedConfig.modelKey]: model,
        },
      })
    },
    [preferences, savePreferences, currentCodexModels, selectedConfig.modelKey]
  )

  const handleCodexEffortChange = useCallback(
    (effort: ThinkingLevel) => {
      if (!preferences) return
      savePreferences.mutate({
        ...preferences,
        magic_prompt_codex_reasoning_efforts: {
          ...currentCodexEfforts,
          [selectedConfig.modelKey]: effort,
        },
      })
    },
    [preferences, savePreferences, currentCodexEfforts, selectedConfig.modelKey]
  )

  return (
    <div className="flex flex-col" style={{ height: 'calc(85vh - 8rem)' }}>
      {/* Prompt selector grid */}
      <div className="grid grid-cols-3 gap-1.5 mb-4 shrink-0">
        {PROMPT_CONFIGS.map(config => {
          const promptIsModified =
            currentPrompts[config.key] !== config.defaultValue
          const promptClaudeModel =
            currentClaudeModels[config.modelKey] ?? config.defaultClaudeModel
          const promptEffort = (currentCodexEfforts[config.modelKey] ??
            DEFAULT_MAGIC_PROMPT_CODEX_REASONING_EFFORTS[
              config.modelKey
            ]) as ThinkingLevel
          const badgeText = `${promptClaudeModel}/${promptEffort}`
          return (
            <button
              key={config.key}
              onClick={() => setSelectedKey(config.key)}
              className={cn(
                'px-3 py-2 rounded-lg border text-left transition-colors',
                'hover:bg-muted/50',
                selectedKey === config.key
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-medium truncate">
                  {config.label}
                  {promptIsModified && (
                    <span className="text-muted-foreground ml-1">*</span>
                  )}
                </span>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                    'bg-muted text-muted-foreground'
                  )}
                >
                  {badgeText}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected prompt details */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="mb-3 shrink-0">
          <h3 className="text-sm font-medium">{selectedConfig.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selectedConfig.description}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">Model</span>
            <Select
              value={currentClaudeModel}
              onValueChange={(v: string) =>
                handleClaudeModelChange(v as ClaudeModel)
              }
            >
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-xs text-muted-foreground">Codex model</span>
            <Select
              value={currentCodexModel}
              onValueChange={handleCodexModelChange}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codexModelOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Reasoning</span>
            <Select
              value={currentCodexEffort}
              onValueChange={(v: string) =>
                handleCodexEffortChange(v as ThinkingLevel)
              }
            >
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codexReasoningEffortOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isModified}
              className="gap-1.5 h-8"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
        </div>

        {/* Variables */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 shrink-0">
          {selectedConfig.variables.map(v => (
            <div key={v.name} className="flex items-baseline gap-1 text-xs">
              <code className="bg-muted px-1 py-0.5 rounded font-mono text-[11px]">
                {v.name}
              </code>
              <span className="text-muted-foreground">{v.description}</span>
            </div>
          ))}
        </div>

        {/* Textarea - fills remaining space */}
        <Textarea
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          className="flex-1 min-h-0 h-full font-mono text-xs resize-none"
          placeholder={selectedConfig.defaultValue}
        />
      </div>
    </div>
  )
}
