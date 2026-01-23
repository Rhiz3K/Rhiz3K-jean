import React, { useState, useCallback, useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  DEFAULT_INVESTIGATE_ISSUE_PROMPT,
  DEFAULT_INVESTIGATE_PR_PROMPT,
  DEFAULT_PR_CONTENT_PROMPT,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  DEFAULT_CODE_REVIEW_PROMPT,
  DEFAULT_CONTEXT_SUMMARY_PROMPT,
  DEFAULT_MAGIC_PROMPTS,
  type MagicPrompts,
} from '@/types/preferences'
import { cn } from '@/lib/utils'

interface VariableInfo {
  name: string
  description: string
}

interface PromptConfig {
  key: keyof MagicPrompts
  label: string
  description: string
  variables: VariableInfo[]
  defaultValue: string
}

const PROMPT_CONFIGS: PromptConfig[] = [
  {
    key: 'investigate_issue',
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
  },
  {
    key: 'investigate_pr',
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
  },
  {
    key: 'pr_content',
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
  },
  {
    key: 'commit_message',
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
  },
  {
    key: 'code_review',
    label: 'Code Review',
    description: 'Prompt for AI-powered code review of your changes.',
    variables: [
      { name: '{branch_info}', description: 'Source and target branch names' },
      { name: '{commits}', description: 'Commit history' },
      { name: '{diff}', description: 'Code changes diff' },
      { name: '{uncommitted_section}', description: 'Unstaged changes if any' },
    ],
    defaultValue: DEFAULT_CODE_REVIEW_PROMPT,
  },
  {
    key: 'context_summary',
    label: 'Context Summary',
    description: 'Prompt for summarizing conversations when saving context.',
    variables: [
      { name: '{project_name}', description: 'Name of the current project' },
      { name: '{date}', description: 'Current timestamp' },
      { name: '{conversation}', description: 'Full conversation history' },
    ],
    defaultValue: DEFAULT_CONTEXT_SUMMARY_PROMPT,
  },
]

export const MagicPromptsPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [selectedKey, setSelectedKey] =
    useState<keyof MagicPrompts>('investigate_issue')
  const [localValue, setLocalValue] = useState('')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const currentPrompts = preferences?.magic_prompts ?? DEFAULT_MAGIC_PROMPTS
  const selectedConfig = PROMPT_CONFIGS.find(c => c.key === selectedKey) ??
    PROMPT_CONFIGS[0] ?? {
      key: 'investigate_issue',
      label: 'Investigate Issue',
      description: 'Default prompt.',
      variables: [],
      defaultValue: DEFAULT_INVESTIGATE_ISSUE_PROMPT,
    }
  const currentValue =
    currentPrompts[selectedKey] ?? selectedConfig.defaultValue
  const isModified = currentValue !== selectedConfig.defaultValue

  // Sync local value when selection changes or external value updates
  useEffect(() => {
    queueMicrotask(() => {
      setLocalValue(currentValue)
    })
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

  return (
    <div className="flex flex-col" style={{ height: 'calc(85vh - 8rem)' }}>
      {/* Prompt selector grid */}
      <div className="grid grid-cols-3 gap-2 mb-4 shrink-0">
        {PROMPT_CONFIGS.map(config => {
          const promptIsModified =
            currentPrompts[config.key] !== config.defaultValue
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
              <div className="text-sm font-medium truncate">
                {config.label}
                {promptIsModified && (
                  <span className="text-muted-foreground ml-1">*</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected prompt details */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header with description and reset */}
        <div className="flex items-start justify-between gap-4 mb-3 shrink-0">
          <div>
            <h3 className="text-sm font-medium">{selectedConfig.label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedConfig.description}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!isModified}
            className="gap-1.5 shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>

        {/* Variables */}
        <div className="flex flex-col gap-1 mb-3 shrink-0">
          {selectedConfig.variables.map(v => (
            <div key={v.name} className="flex items-baseline gap-1.5 text-xs">
              <code className="bg-muted px-1 py-0.5 rounded font-mono">
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
