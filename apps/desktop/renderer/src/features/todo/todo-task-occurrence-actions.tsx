import type { DesktopTodoCalendarEvent, DesktopTodoTask } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating, useMergeRefs } from '@floating-ui/react'
import { TaskOccurrencePanel } from '@memorilo/editor/task-ui'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'react-toastify/unstyled'
import { errorMessage } from '../../shared/error-message'
import { floatingTransformOrigin } from '../../shared/floating-ui'
import { nextTodoStatus, taskOccurrenceDate, todoStatusLabelKeys } from './todo-model'
import { todoTaskOccurrenceActionStyles as styles } from './todo-task-occurrence-actions.stylex'

export interface TodoTaskUpdateInput {
  blockId: string
  schedule?: DesktopTodoTask['schedule']
  nextDueDate?: string | null
  noteId: string
  onlyThis?: boolean
  reminderMinutes?: number | null
  reminders?: DesktopTodoTask['reminders']
  repeatRule?: DesktopTodoTask['repeatRule']
  status?: DesktopTodoTask['status']
  text?: string
  topicId: string
}

interface TodoTaskOccurrenceActionsProps {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  onUpdateTask: (input: TodoTaskUpdateInput) => Promise<void>
  t: TFunction
  task: DesktopTodoTask
  triggerContent: ReactNode
}

const menuGap = 5
const viewportInset = 8

export function TodoTaskOccurrenceActions({
  calendarEvents,
  onUpdateTask,
  t,
  task,
  triggerContent,
}: TodoTaskOccurrenceActionsProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const {
    floatingStyles,
    isPositioned,
    placement,
    refs,
  } = useFloating({
    middleware: [
      offset(menuGap),
      flip({ padding: viewportInset }),
      shift({ padding: viewportInset }),
      size({
        padding: viewportInset,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`
        },
      }),
    ],
    open,
    placement: 'bottom-start',
    strategy: 'fixed',
    transform: false,
    whileElementsMounted: autoUpdate,
  })
  const referenceRef = useMergeRefs([triggerRef, refs.setReference])
  const floatingRef = useMergeRefs([panelRef, refs.setFloating])
  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus)
      triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open)
      return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node
        && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))) {
        return
      }
      close(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape')
        return
      event.preventDefault()
      close(true)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const openFromContext = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!task.repeatRule)
      return
    event.preventDefault()
    event.stopPropagation()
    setOpen(current => !current)
  }

  const openFromKeyboard = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!task.repeatRule || (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)))
      return
    event.preventDefault()
    event.stopPropagation()
    setOpen(true)
  }

  const changeStatus = async () => {
    if (statusUpdating)
      return
    setStatusUpdating(true)
    try {
      await onUpdateTask({
        blockId: task.blockId,
        noteId: task.noteId,
        status: nextTodoStatus(task.status),
        topicId: task.topicId,
      })
    }
    catch (error) {
      toast.error(t('couldNotUpdateTask', {
        message: errorMessage(error),
      }))
    }
    finally {
      setStatusUpdating(false)
    }
  }

  const handleStatusClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    void changeStatus()
  }

  const handleStatusKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return
    event.preventDefault()
    event.stopPropagation()
    void changeStatus()
  }

  return (
    <>
      <span
        ref={referenceRef}
        {...stylex.props(styles.shell)}
        aria-expanded={task.repeatRule ? open : undefined}
        aria-haspopup={task.repeatRule ? 'dialog' : undefined}
        aria-label={t('changeTaskStatus', {
          current: t(todoStatusLabelKeys[task.status]),
          next: t(todoStatusLabelKeys[nextTodoStatus(task.status)]),
        })}
        aria-disabled={statusUpdating ? 'true' : undefined}
        role="button"
        tabIndex={0}
        onClick={handleStatusClick}
        onContextMenu={openFromContext}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ')
            handleStatusKeyDown(event)
          else
            openFromKeyboard(event)
        }}
      >
        {triggerContent}
      </span>
      {open && task.repeatRule
        ? (
            <FloatingPortal>
              <TaskOccurrencePanel
                key={`${task.blockId}:${JSON.stringify(task.schedule)}:${JSON.stringify(task.repeatRule)}:${task.text}`}
                calendarEvents={calendarEvents}
                id={menuId}
                panelRef={floatingRef}
                style={{
                  ...floatingStyles,
                  transformOrigin: floatingTransformOrigin(placement),
                }}
                t={t}
                task={{
                  occurrenceDate: taskOccurrenceDate(task),
                  reminderMinutes: task.reminderMinutes,
                  reminders: task.reminders,
                  repeatRule: task.repeatRule,
                  schedule: task.schedule,
                  status: task.status,
                  text: task.text,
                }}
                visible={isPositioned}
                onUpdate={input => onUpdateTask({
                  ...input,
                  blockId: task.blockId,
                  noteId: task.noteId,
                  topicId: task.topicId,
                })}
                onUpdated={() => close(true)}
              />
            </FloatingPortal>
          )
        : null}
    </>
  )
}
