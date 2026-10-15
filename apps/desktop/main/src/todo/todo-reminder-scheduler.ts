import type { EditorStorage, TodoTask } from '@memorilo/editor-storage'
import { app, Notification, powerMonitor } from 'electron'

const refreshIntervalMs = 30_000

function scheduledTime(task: TodoTask): number | null {
  const value = task.schedule.kind === 'span'
    ? task.schedule.start
    : task.schedule.kind === 'deadline' && task.schedule.time !== null
      ? `${task.schedule.date}T${task.schedule.time}`
      : null
  if (value === null)
    return null
  const parsed = new Date(`${value}:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

function reminderTimes(task: TodoTask): readonly number[] {
  const scheduled = scheduledTime(task)
  const date = task.schedule.kind === 'span'
    ? task.schedule.start.slice(0, 10)
    : task.schedule.kind === 'deadline' ? task.schedule.date : null
  const reminders = task.reminders
    ?? (task.reminderMinutes === null ? [] : [{ kind: 'offset' as const, minutes: task.reminderMinutes }])
  const times = reminders.flatMap((reminder) => {
    if (reminder.kind === 'offset')
      return scheduled === null ? [] : [scheduled - reminder.minutes * 60_000]
    if (date === null)
      return []
    const parsed = new Date(`${date}T${reminder.time}:00`).getTime()
    return Number.isNaN(parsed) ? [] : [parsed]
  })
  return [...new Set(times)].sort((left, right) => left - right)
}

export interface TodoReminderScheduler {
  close: () => void
}

export function createTodoReminderScheduler(storage: EditorStorage): TodoReminderScheduler {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  let refreshing = false
  const notified = new Set<string>()
  let refresh: () => Promise<void>

  const listTasks = async (): Promise<readonly TodoTask[]> => {
    const tasks: TodoTask[] = []
    let cursor: number | undefined
    while (true) {
      const page = await storage.tasks.list({
        ...(cursor === undefined ? {} : { cursor }),
        limit: 500,
      })
      tasks.push(...page.items)
      if (page.nextCursor === null)
        return tasks
      cursor = page.nextCursor
    }
  }

  const schedule = (delay: number): void => {
    if (stopped)
      return
    if (timer !== null)
      clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void refresh()
    }, Math.max(1_000, Math.min(delay, refreshIntervalMs)))
    timer.unref()
  }

  refresh = async (): Promise<void> => {
    if (stopped || refreshing)
      return
    refreshing = true
    try {
      const now = Date.now()
      const tasks = await listTasks()
      const activeKeys = new Set<string>()
      let nextDelay = refreshIntervalMs
      for (const task of tasks) {
        if (task.status === 'done')
          continue
        for (const at of reminderTimes(task)) {
          const key = `${task.noteId}:${task.topicId}:${task.blockId}:${at}`
          activeKeys.add(key)
          const remaining = at - now
          if (remaining <= 0) {
            if (notified.has(key))
              continue
            notified.add(key)
            if (Notification.isSupported()) {
              new Notification({
                body: task.text,
                title: 'Memorilo',
              }).show()
            }
          }
          else {
            nextDelay = Math.min(nextDelay, remaining)
          }
        }
      }
      for (const key of notified) {
        if (!activeKeys.has(key))
          notified.delete(key)
      }
      schedule(nextDelay)
    }
    catch (error) {
      if (!stopped)
        console.error('Failed to refresh Todo reminders', error)
      schedule(refreshIntervalMs)
    }
    finally {
      refreshing = false
    }
  }

  const handleTemporalChange = (): void => {
    void refresh()
  }

  app.on('browser-window-focus', handleTemporalChange)
  powerMonitor.on('resume', handleTemporalChange)
  void refresh()

  return {
    close: () => {
      stopped = true
      if (timer !== null)
        clearTimeout(timer)
      timer = null
      app.removeListener('browser-window-focus', handleTemporalChange)
      powerMonitor.removeListener('resume', handleTemporalChange)
    },
  }
}
