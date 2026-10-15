import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask } from '@memorilo/desktop-api'
import type { TaskActionUpdate } from '@memorilo/editor/task'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type { TodoTaskUpdateInput } from './todo-task-occurrence-actions'
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating, useMergeRefs } from '@floating-ui/react'
import { TaskActionPanel } from '@memorilo/editor/task-ui'
import * as stylex from '@stylexjs/stylex'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { floatingTransformOrigin } from '../../shared/floating-ui'
import { taskOccurrenceDate } from './todo-model'
import { todoTaskActionStyles as styles } from './todo-task-actions.stylex'

interface TodoTaskActionsProps {
  compact?: boolean
  compactAlignment?: 'left' | 'right'
  triggerContent?: ReactNode
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  onUpdateTask: (input: TodoTaskUpdateInput) => Promise<void>
  t: TFunction
  task: DesktopTodoTask
}

const menuGap = 4
const viewportInset = 8

function eventBelongsToNestedTaskAction(event: Event, ownerId: string): boolean {
  return event.composedPath().some((target) => {
    return target instanceof HTMLElement && target.dataset.taskActionFloatingOwner === ownerId
  })
}

function taskActionRevision(task: DesktopTodoTask, calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]): string {
  return JSON.stringify([
    task.blockId,
    task.schedule,
    task.reminderMinutes,
    task.reminders,
    task.repeatRule,
    task.text,
    calendarSubscriptions.map(subscription => [subscription.id, subscription.enabled]),
  ])
}

function TodoTaskActionsForm({
  calendarEvents,
  calendarSubscriptions,
  compact = false,
  compactAlignment = 'right',
  triggerContent,
  onUpdateTask,
  t,
  task,
}: TodoTaskActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const preferredPlacement = compact
    ? compactAlignment === 'left' ? 'top-start' : 'top-end'
    : 'bottom-end'
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
    placement: preferredPlacement,
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
  const update = (input: TaskActionUpdate) => onUpdateTask({
    ...input,
    blockId: task.blockId,
    noteId: task.noteId,
    topicId: task.topicId,
  })

  useEffect(() => {
    if (!open)
      return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node
        && (triggerRef.current?.contains(target)
          || panelRef.current?.contains(target)
          || eventBelongsToNestedTaskAction(event, menuId))) {
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
  }, [menuId, open])

  return (
    <div {...stylex.props(styles.shell)}>
      <button
        ref={referenceRef}
        {...stylex.props(styles.summary, compact && styles.summaryCompact, triggerContent !== undefined ? styles.scheduleSummary : null)}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerContent ? t('scheduleSettings') : t('taskActions')}
        title={triggerContent ? t('scheduleSettings') : t('taskActions')}
        type="button"
        onClick={() => setOpen(current => !current)}
      >
        {triggerContent ?? <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />}
      </button>
      {open
        ? (
            <FloatingPortal>
              <TaskActionPanel
                calendarEvents={calendarEvents}
                calendarSubscriptions={calendarSubscriptions}
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
                onUpdate={update}
                onUpdated={() => close(true)}
              />
            </FloatingPortal>
          )
        : null}
    </div>
  )
}

export function TodoTaskActions(props: TodoTaskActionsProps) {
  return <TodoTaskActionsForm key={taskActionRevision(props.task, props.calendarSubscriptions)} {...props} />
}
