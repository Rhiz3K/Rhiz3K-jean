import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Project } from '@/types/projects'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { CommandPalette } from './CommandPalette'

const mockUsePreferences = vi.fn()
const mockUseProjects = vi.fn()
const mockUseAppDataDir = vi.fn()
const mockUseCommandContext = vi.fn()
const mockGetAllCommands = vi.fn()
const mockExecuteCommand = vi.fn()
const mockConvertFileSrc = vi.fn((path: string) => `transport://${path}`)

vi.mock('@/services/preferences', () => ({
  usePreferences: () => mockUsePreferences(),
}))

vi.mock('@/services/projects', () => ({
  useProjects: () => mockUseProjects(),
  useAppDataDir: () => mockUseAppDataDir(),
}))

vi.mock('@/hooks/use-command-context', () => ({
  useCommandContext: () => mockUseCommandContext(),
}))

vi.mock('@/lib/commands', () => ({
  getAllCommands: (...args: unknown[]) => mockGetAllCommands(...args),
  executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
}))

vi.mock('@/lib/transport', () => ({
  convertFileSrc: (path: string) => mockConvertFileSrc(path),
}))

describe('CommandPalette', () => {
  const project: Project = {
    id: 'project-1',
    name: 'Demo',
    path: '/tmp/demo',
    default_branch: 'main',
    added_at: 1,
    order: 1,
    is_folder: false,
    avatar_path: 'avatars/demo.png',
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockUsePreferences.mockReturnValue({ data: null })
    mockUseProjects.mockReturnValue({ data: [project] })
    mockUseAppDataDir.mockReturnValue({ data: '/app/data' })
    mockUseCommandContext.mockReturnValue({ showToast: vi.fn() })
    mockGetAllCommands.mockReturnValue([])
    mockExecuteCommand.mockResolvedValue({ success: true })

    useUIStore.setState({ commandPaletteOpen: true })
    useProjectsStore.setState({
      selectedProjectId: null,
      projectAccessTimestamps: { [project.id]: 1000 },
    })
  })

  it('renders project avatars through transport convertFileSrc', () => {
    render(<CommandPalette />)

    expect(mockConvertFileSrc).toHaveBeenCalledWith(
      '/app/data/avatars/demo.png'
    )
    expect(screen.getByRole('img', { name: 'Demo' })).toHaveAttribute(
      'src',
      'transport:///app/data/avatars/demo.png'
    )
  })
})
