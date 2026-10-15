import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask, DesktopTodoTaskStatus, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import * as stylex from '@stylexjs/stylex'
import { Link } from '@tanstack/react-router'
import { CalendarDays, FileText, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'
import { errorMessage } from '../../shared/error-message'
import { todoDetailSidebarStyles as styles } from './todo-detail-sidebar.stylex'
import { formatTaskScheduleDate, nextTodoStatus, todoStatusLabelKeys } from './todo-model'
import { TodoTaskActions } from './todo-task-actions'
import { todoTaskStatusIcons } from './todo-task-status'

const TodoDetailEditor = lazy(async () => {
  const module = await import('./todo-detail-editor')
  return { default: module.TodoDetailEditor }
})

const sidebarSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.3,
} as const

function StatusIcon({ status }: { status: DesktopTodoTaskStatus }) {
  const Icon = todoTaskStatusIcons[status]
  return <Icon {...stylex.props(styles.statusIcon)} aria-hidden="true" strokeWidth={1.8} />
}

function scheduleLabel(task: DesktopTodoTask, locale: string, t: TFunction): string {
  const date = task.schedule.kind === 'deadline'
    ? task.schedule.date
    : task.schedule.kind === 'span' ? task.schedule.start.slice(0, 10) : null
  if (date === null)
    return t('notSet')
  const formattedDate = formatTaskScheduleDate(date, locale, Date.now())
  if (task.schedule.kind === 'span' && task.schedule.allDay)
    return formattedDate
  if (task.schedule.kind === 'span')
    return `${formattedDate} ${task.schedule.start.slice(11)}-${task.schedule.end.slice(11)}`
  return task.schedule.kind === 'deadline' && task.schedule.time !== null ? `${formattedDate} ${task.schedule.time}` : formattedDate
}

export function TodoDetailSidebar({
  calendarEvents,
  calendarSubscriptions,
  onClose,
  onUpdateTask,
  task,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  onClose: () => void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  task: DesktopTodoTask | null
}) {
  const { i18n, t } = useTranslation('todo')
  const reduceMotion = useReducedMotion()
  const [statusUpdating, setStatusUpdating] = useState(false)

  useEffect(() => {
    if (task === null)
      return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented)
        return
      if (event.target instanceof Element && event.target.closest('[role="dialog"]'))
        return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, task])

  const changeStatus = async (current: DesktopTodoTask) => {
    setStatusUpdating(true)
    try {
      await onUpdateTask({
        blockId: current.blockId,
        noteId: current.noteId,
        status: nextTodoStatus(current.status),
        topicId: current.topicId,
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
  const motionInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, width: 0, x: 24 }
  const motionAnimate = reduceMotion ? { opacity: 1 } : { opacity: 1, width: 460, x: 0 }
  const motionTransition = reduceMotion ? { duration: 0.12 } : sidebarSpring

  return (
    <AnimatePresence initial={false}>
      {task === null
        ? null
        : (
            <motion.aside
              key="todo-detail-sidebar"
              {...stylex.props(styles.sidebar)}
              animate={motionAnimate}
              aria-label={t('taskDetail')}
              exit={motionInitial}
              initial={motionInitial}
              transition={motionTransition}
            >
              <header {...stylex.props(styles.header)}>
                <div {...stylex.props(styles.headerControls)}>
                  <button
                    {...stylex.props(
                      styles.statusButton,
                      task.status === 'doing' && styles.statusDoing,
                      task.status === 'done' && styles.statusDone,
                    )}
                    aria-label={t('changeTaskStatus', {
                      current: t(todoStatusLabelKeys[task.status]),
                      next: t(todoStatusLabelKeys[nextTodoStatus(task.status)]),
                    })}
                    disabled={statusUpdating}
                    title={t(todoStatusLabelKeys[task.status])}
                    type="button"
                    onClick={() => void changeStatus(task)}
                  >
                    <StatusIcon status={task.status} />
                  </button>
                  <TodoTaskActions
                    calendarEvents={calendarEvents}
                    calendarSubscriptions={calendarSubscriptions}
                    onUpdateTask={onUpdateTask}
                    t={t}
                    task={task}
                    triggerContent={(
                      <span {...stylex.props(styles.scheduleLabel)}>
                        <CalendarDays {...stylex.props(styles.scheduleIcon)} aria-hidden="true" strokeWidth={1.8} />
                        <span {...stylex.props(styles.scheduleText)}>{scheduleLabel(task, i18n.language, t)}</span>
                      </span>
                    )}
                  />
                </div>
                <button
                  {...stylex.props(styles.closeButton)}
                  aria-label={t('closeTaskDetail')}
                  title={t('closeTaskDetail')}
                  type="button"
                  onClick={onClose}
                >
                  <X aria-hidden="true" size={16} strokeWidth={1.9} />
                </button>
              </header>
              <div {...stylex.props(styles.editorRegion)}>
                <Suspense fallback={<div {...stylex.props(styles.status)} role="status">{t('openingTaskDetail')}</div>}>
                  <TodoDetailEditor key={`${task.noteId}\0${task.topicId}`} task={task} />
                </Suspense>
              </div>
              <footer {...stylex.props(styles.footer)}>
                {task.journalDate === null
                  ? (
                      <Link
                        {...stylex.props(styles.noteLink)}
                        params={{ noteId: task.noteId, topicId: task.topicId }}
                        search={{ focus: task.blockId }}
                        title={t('openSourceNote', { note: task.noteTitle })}
                        to="/note/$noteId/$topicId"
                      >
                        <FileText {...stylex.props(styles.noteIcon)} aria-hidden="true" strokeWidth={1.8} />
                        <span {...stylex.props(styles.noteText)}>{task.noteTitle}</span>
                      </Link>
                    )
                  : (
                      <Link
                        {...stylex.props(styles.noteLink)}
                        search={{ date: task.journalDate, focus: task.blockId }}
                        title={t('openSourceNote', { note: task.noteTitle })}
                        to="/journals"
                      >
                        <FileText {...stylex.props(styles.noteIcon)} aria-hidden="true" strokeWidth={1.8} />
                        <span {...stylex.props(styles.noteText)}>{task.noteTitle}</span>
                      </Link>
                    )}
              </footer>
            </motion.aside>
          )}
    </AnimatePresence>
  )
}
