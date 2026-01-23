import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUIStore } from '@/store/ui-store'
import { SessionBoardView } from './SessionBoardView'

export function SessionBoardModal() {
  const sessionBoardProjectId = useUIStore(state => state.sessionBoardProjectId)
  const closeSessionBoardModal = useUIStore(
    state => state.closeSessionBoardModal
  )

  const isOpen = sessionBoardProjectId !== null

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && closeSessionBoardModal()}
    >
      <DialogContent className="!max-w-[calc(100vw-2rem)] w-full h-[calc(100vh-2rem)] flex flex-col">
        <DialogHeader>
          <DialogTitle>Session Board</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden">
          {sessionBoardProjectId && (
            <SessionBoardView
              projectId={sessionBoardProjectId}
              onSessionClick={() => {
                closeSessionBoardModal()
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
