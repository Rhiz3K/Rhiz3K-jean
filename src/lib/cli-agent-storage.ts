import type { ChatAgent } from '@/types/chat'

const STORAGE_KEY = 'jean:last_cli_agent'

export function getLastCliAgent(): ChatAgent {
  if (typeof window === 'undefined') return 'claude'

  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'codex' ? 'codex' : 'claude'
  } catch {
    return 'claude'
  }
}

export function setLastCliAgent(agent: ChatAgent): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, agent)
  } catch {
    // ignore
  }
}
