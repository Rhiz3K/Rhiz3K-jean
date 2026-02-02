import {
  ArrowUpToLine,
  Code,
  ExternalLink,
  Folder,
  FolderOpen,
  Home,
  LayoutGrid,
  Plus,
  Settings,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { isBaseSession, type Project } from '@/types/projects'
import {
  useCreateBaseSession,
  useCreateWorktree,
  useArchivedWorktrees,
  useCloseBaseSessionClean,
  useMoveItem,
  useOpenProjectOnGitHub,
  useOpenProjectWorktreesFolder,
  useOpenWorktreeInEditor,
  useOpenWorktreeInFinder,
  useOpenWorktreeInTerminal,
  useRemoveProject,
  useWorktrees,
} from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { getEditorLabel, getTerminalLabel } from '@/types/preferences'
import type { ChatAgent } from '@/types/chat'
import { setLastCliAgent } from '@/lib/cli-agent-storage'

interface ProjectContextMenuProps {
  project: Project
  children: React.ReactNode
}

export function ProjectContextMenu({
  project,
  children,
}: ProjectContextMenuProps) {
  const createWorktree = useCreateWorktree()
  const createBaseSession = useCreateBaseSession()
  const closeBaseSessionClean = useCloseBaseSessionClean()
  const moveItem = useMoveItem()
  const removeProject = useRemoveProject()
  const openOnGitHub = useOpenProjectOnGitHub()
  const openInFinder = useOpenWorktreeInFinder()
  const openWorktreesFolder = useOpenProjectWorktreesFolder()
  const openInTerminal = useOpenWorktreeInTerminal()
  const openInEditor = useOpenWorktreeInEditor()
  const { data: worktrees = [] } = useWorktrees(project.id)
  const { data: archivedWorktrees = [] } = useArchivedWorktrees()
  const { data: preferences } = usePreferences()
  const { openProjectSettings } = useProjectsStore()
  const openSessionBoardModal = useUIStore(state => state.openSessionBoardModal)

  // Check if base session already exists
  const existingBaseSession = worktrees.find(isBaseSession)
  const archivedBaseSession = archivedWorktrees.find(
    w => w.project_id === project.id && isBaseSession(w)
  )
  const isNested = project.parent_id !== undefined

  const handleOpenInFinder = () => {
    openInFinder.mutate(project.path)
  }

  const handleOpenWorktreesFolder = () => {
    openWorktreesFolder.mutate(project.name)
  }

  const handleOpenInTerminal = () => {
    openInTerminal.mutate({
      worktreePath: project.path,
      terminal: preferences?.terminal,
    })
  }

  const handleOpenInEditor = () => {
    openInEditor.mutate({
      worktreePath: project.path,
      editor: preferences?.editor,
    })
  }

  const handleNewWorktree = (agent: ChatAgent) => {
    setLastCliAgent(agent)
    createWorktree.mutate({ projectId: project.id, agent })
  }

  const handleNewBaseSession = (agent: ChatAgent) => {
    setLastCliAgent(agent)

    if (archivedBaseSession) {
      closeBaseSessionClean.mutate(
        { worktreeId: archivedBaseSession.id, projectId: project.id },
        {
          onSuccess: () => {
            createBaseSession.mutate({ projectId: project.id, agent })
          },
        }
      )
      return
    }

    createBaseSession.mutate({ projectId: project.id, agent })
  }

  const handleOpenBaseSession = () => {
    createBaseSession.mutate({ projectId: project.id })
  }

  const handleRemoveProject = () => {
    removeProject.mutate(project.id)
  }

  const handleOpenOnGitHub = () => {
    openOnGitHub.mutate(project.id)
  }

  const handleMoveToRoot = () => {
    moveItem.mutate({ itemId: project.id, newParentId: undefined })
  }

  const handleOpenSettings = () => {
    openProjectSettings(project.id)
  }

  const handleOpenSessionBoard = () => {
    openSessionBoardModal(project.id)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem onClick={handleOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Project Settings
        </ContextMenuItem>

        <ContextMenuItem onClick={handleOpenSessionBoard}>
          <LayoutGrid className="mr-2 h-4 w-4" />
          Session Board
        </ContextMenuItem>

        {isNested && (
          <ContextMenuItem onClick={handleMoveToRoot}>
            <ArrowUpToLine className="mr-2 h-4 w-4" />
            Move to Root
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {existingBaseSession ? (
          <ContextMenuItem onClick={handleOpenBaseSession}>
            <Home className="mr-2 h-4 w-4" />
            Open Base Session
          </ContextMenuItem>
        ) : archivedBaseSession ? (
          <ContextMenuItem onClick={handleOpenBaseSession}>
            <Home className="mr-2 h-4 w-4" />
            Restore Base Session
          </ContextMenuItem>
        ) : (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Home className="mr-2 h-4 w-4" />
              New Base Session
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => handleNewBaseSession('claude')}>
                Claude CLI
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleNewBaseSession('codex')}>
                Codex CLI
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Plus className="mr-2 h-4 w-4" />
            New Worktree
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => handleNewWorktree('claude')}>
              Claude CLI
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleNewWorktree('codex')}>
              Codex CLI
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleOpenInEditor}>
          <Code className="mr-2 h-4 w-4" />
          Open in {getEditorLabel(preferences?.editor)}
        </ContextMenuItem>

        <ContextMenuItem onClick={handleOpenInFinder}>
          <FolderOpen className="mr-2 h-4 w-4" />
          Open in Finder
        </ContextMenuItem>

        <ContextMenuItem onClick={handleOpenInTerminal}>
          <Terminal className="mr-2 h-4 w-4" />
          Open in {getTerminalLabel(preferences?.terminal)}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleOpenWorktreesFolder}>
          <Folder className="mr-2 h-4 w-4" />
          Open Worktrees Folder
        </ContextMenuItem>

        <ContextMenuItem onClick={handleOpenOnGitHub}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open on GitHub
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          variant="destructive"
          onClick={handleRemoveProject}
          disabled={worktrees.length > 0}
          className="whitespace-nowrap"
        >
          <Trash2 className="mr-2 h-4 w-4 shrink-0" />
          Remove Project
          {worktrees.length > 0 && (
            <span className="ml-auto text-xs opacity-60 shrink-0">
              ({worktrees.length} worktrees)
            </span>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
