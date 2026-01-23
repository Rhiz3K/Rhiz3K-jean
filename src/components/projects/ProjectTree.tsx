import { useCallback, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isFolder, type Project } from '@/types/projects'
import { ProjectTreeItem } from './ProjectTreeItem'
import { FolderTreeItem } from './FolderTreeItem'
import { useReorderItems, useMoveItem } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface ProjectTreeProps {
  projects: Project[]
}

// Helper to flatten all items for a single SortableContext
function flattenItems(projects: Project[]): string[] {
  const result: string[] = []

  function addItems(parentId: string | undefined) {
    const items = projects
      .filter(p => p.parent_id === parentId)
      .sort((a, b) => {
        if (isFolder(a) && !isFolder(b)) return -1
        if (!isFolder(a) && isFolder(b)) return 1
        return a.order - b.order
      })

    for (const item of items) {
      result.push(item.id)
      if (isFolder(item)) {
        addItems(item.id)
      }
    }
  }

  addItems(undefined)
  return result
}

interface SortableItemProps {
  item: Project
  allProjects: Project[]
  depth: number
  isOverFolder: boolean
  expandedFolderIds: Set<string>
}

function SortableItem({
  item,
  allProjects,
  depth,
  isOverFolder,
  expandedFolderIds,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: depth > 0 ? `${depth * 12}px` : undefined,
  }

  if (isFolder(item)) {
    const isExpanded = expandedFolderIds.has(item.id)

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          isDragging ? 'cursor-grabbing' : 'cursor-grab',
          isOverFolder && 'ring-2 ring-primary/50 ring-inset rounded'
        )}
      >
        <FolderTreeItem folder={item} depth={depth}>
          {isExpanded && (
            <NestedItems
              projects={allProjects}
              parentId={item.id}
              depth={depth + 1}
              expandedFolderIds={expandedFolderIds}
            />
          )}
        </FolderTreeItem>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
    >
      <ProjectTreeItem project={item} />
    </div>
  )
}

// Renders nested items (children of a folder) - they are draggable via the parent SortableContext
interface NestedItemsProps {
  projects: Project[]
  parentId: string
  depth: number
  expandedFolderIds: Set<string>
}

function NestedItems({
  projects,
  parentId,
  depth,
  expandedFolderIds,
}: NestedItemsProps) {
  const items = projects
    .filter(p => p.parent_id === parentId)
    .sort((a, b) => {
      if (isFolder(a) && !isFolder(b)) return -1
      if (!isFolder(a) && isFolder(b)) return 1
      return a.order - b.order
    })

  return (
    <>
      {items.map(item => (
        <SortableItem
          key={item.id}
          item={item}
          allProjects={projects}
          depth={depth}
          isOverFolder={false}
          expandedFolderIds={expandedFolderIds}
        />
      ))}
    </>
  )
}

// Drop zone at the bottom to move items to root level
function RootDropZone({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'root-drop-zone' })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'h-8 mx-2 mt-1 rounded border-2 border-dashed transition-colors',
        isOver ? 'border-primary/50 bg-primary/5' : 'border-transparent'
      )}
    />
  )
}

export function ProjectTree({ projects }: ProjectTreeProps) {
  const reorderItems = useReorderItems()
  const moveItem = useMoveItem()
  const { expandFolder, expandedFolderIds } = useProjectsStore()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overFolderId, setOverFolderId] = useState<string | null>(null)
  const [isOverRoot, setIsOverRoot] = useState(false)

  // Root level items split into folders and standalone projects
  const rootItems = projects.filter(p => p.parent_id === undefined)
  const rootFolders = rootItems
    .filter(isFolder)
    .sort((a, b) => a.order - b.order)
  const rootProjects = rootItems
    .filter(p => !isFolder(p))
    .sort((a, b) => a.order - b.order)
  const hasBothTypes = rootFolders.length > 0 && rootProjects.length > 0

  // All items flattened for the SortableContext
  const allItemIds = flattenItems(projects)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event
      if (!over) {
        setOverFolderId(null)
        setIsOverRoot(false)
        return
      }

      // Check if over the root drop zone
      if (over.id === 'root-drop-zone') {
        setOverFolderId(null)
        setIsOverRoot(true)
        return
      }

      setIsOverRoot(false)

      // Check if dragging over a folder
      const overItem = projects.find(p => p.id === over.id)
      if (overItem && isFolder(overItem) && activeId !== over.id) {
        setOverFolderId(over.id as string)
      } else {
        setOverFolderId(null)
      }
    },
    [projects, activeId]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      setOverFolderId(null)
      setIsOverRoot(false)

      if (!over) return

      const activeItem = projects.find(p => p.id === active.id)
      if (!activeItem) return

      // Dropping on root drop zone = move to root
      if (over.id === 'root-drop-zone') {
        if (activeItem.parent_id !== undefined) {
          moveItem.mutate({
            itemId: active.id as string,
            newParentId: undefined,
          })
        }
        return
      }

      const overItem = projects.find(p => p.id === over.id)

      // Helper to get sorted siblings at a level (excluding item being moved)
      const getSiblings = (parentId: string | undefined, excludeId: string) =>
        projects
          .filter(p => p.parent_id === parentId && p.id !== excludeId)
          .sort((a, b) => {
            if (isFolder(a) && !isFolder(b)) return -1
            if (!isFolder(a) && isFolder(b)) return 1
            return a.order - b.order
          })

      // Dropping onto a folder = move into it (at the end)
      if (
        overItem &&
        isFolder(overItem) &&
        active.id !== over.id &&
        activeItem.parent_id !== over.id
      ) {
        // Prevent moving folder into itself or descendants
        if (isFolder(activeItem)) {
          let currentParent = overItem.parent_id
          while (currentParent) {
            if (currentParent === active.id) {
              return
            }
            const parent = projects.find(p => p.id === currentParent)
            currentParent = parent?.parent_id
          }
        }

        moveItem.mutate({
          itemId: active.id as string,
          newParentId: over.id as string,
          // No targetIndex = append at end
        })
        expandFolder(over.id as string)
        return
      }

      // Same item - no action
      if (active.id === over.id) return

      // If dropping on an item at a different level, move to that level at the drop position
      if (overItem && activeItem.parent_id !== overItem.parent_id) {
        const targetParentId = overItem.parent_id
        const siblings = getSiblings(targetParentId, active.id as string)
        const overIndex = siblings.findIndex(p => p.id === over.id)
        const targetIndex = overIndex === -1 ? siblings.length : overIndex

        moveItem.mutate({
          itemId: active.id as string,
          newParentId: targetParentId,
          targetIndex,
        })
        return
      }

      // Same-level reorder
      if (overItem && activeItem.parent_id === overItem.parent_id) {
        const parentId = activeItem.parent_id
        const siblings = projects
          .filter(p => p.parent_id === parentId)
          .sort((a, b) => {
            if (isFolder(a) && !isFolder(b)) return -1
            if (!isFolder(a) && isFolder(b)) return 1
            return a.order - b.order
          })

        const oldIndex = siblings.findIndex(p => p.id === active.id)
        const newIndex = siblings.findIndex(p => p.id === over.id)

        if (oldIndex === -1 || newIndex === -1) return

        const reorderedItems = arrayMove(siblings, oldIndex, newIndex)
        const itemIds = reorderedItems.map(p => p.id)

        reorderItems.mutate({ itemIds, parentId })
      }
    },
    [projects, reorderItems, moveItem, expandFolder]
  )

  return (
    <div className="py-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {rootFolders.length > 0 && (
          <div className="px-3 pb-1 pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Folders
            </span>
          </div>
        )}
        <SortableContext
          items={allItemIds}
          strategy={verticalListSortingStrategy}
        >
          {rootFolders.map(item => (
            <SortableItem
              key={item.id}
              item={item}
              allProjects={projects}
              depth={0}
              isOverFolder={overFolderId === item.id}
              expandedFolderIds={expandedFolderIds}
            />
          ))}
          {hasBothTypes && (
            <div className="px-3 py-2">
              <Separator />
            </div>
          )}
          {rootProjects.length > 0 && (
            <div className="px-3 pb-1 pt-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                Projects
              </span>
            </div>
          )}
          {rootProjects.map(item => (
            <SortableItem
              key={item.id}
              item={item}
              allProjects={projects}
              depth={0}
              isOverFolder={false}
              expandedFolderIds={expandedFolderIds}
            />
          ))}
        </SortableContext>

        {/* Root drop zone - visible when dragging an item that's inside a folder */}
        {activeId &&
          projects.find(p => p.id === activeId)?.parent_id !== undefined && (
            <RootDropZone isOver={isOverRoot} />
          )}
      </DndContext>
    </div>
  )
}
