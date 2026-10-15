import type { DateSelectArg, EventChangeArg, EventClickArg } from '@fullcalendar/core'
import type { CreateDesktopTodoTaskInput, DesktopTodoCalendarEvent, DesktopTodoTask, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { DesktopTodoConfiguration } from '@memorilo/desktop-config'
import interactionPlugin from '@fullcalendar/interaction'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import * as stylex from '@stylexjs/stylex'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { todoTimeGridViewStyles as styles } from './todo-time-grid-view.stylex'
import './todo-time-grid-view.global'

const storageKeys = {
  multiDay: 'memorilo.todo.timeline.multiDay',
  multiWeek: 'memorilo.todo.timeline.multiWeek',
} as const

function remembered(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined')
    return fallback
  const value = Number(window.localStorage.getItem(key))
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function taskStart(task: DesktopTodoTask): string | null {
  if (task.schedule.kind === 'span')
    return task.schedule.start
  if (task.schedule.kind === 'deadline' && task.schedule.time)
    return `${task.schedule.date}T${task.schedule.time}:00`
  return task.schedule.kind === 'deadline' ? task.schedule.date : null
}

function taskEnd(task: DesktopTodoTask): string | null {
  return task.schedule.kind === 'span' ? task.schedule.end : null
}

function dateFromEvent(
  event: { id: string, start: Date | null, end: Date | null, allDay: boolean },
  task: DesktopTodoTask,
): UpdateDesktopTodoTaskInput | null {
  if (event.start === null)
    return null
  const start = dayjs(event.start)
  const end = event.end === null ? null : dayjs(event.end)
  const startDateTime = start.format('YYYY-MM-DDTHH:mm')
  if (task.schedule.kind === 'span') {
    if (event.allDay) {
      const endDate = end ?? start.add(1, 'day')
      return {
        schedule: { allDay: true, end: `${endDate.format('YYYY-MM-DD')}T00:00`, kind: 'span', start: `${start.format('YYYY-MM-DD')}T00:00` },
        blockId: event.id,
        noteId: '',
        text: undefined,
        topicId: '',
      }
    }
    return {
      schedule: { allDay: false, end: (end ?? dayjs(task.schedule.end)).format('YYYY-MM-DDTHH:mm'), kind: 'span', start: startDateTime },
      blockId: event.id,
      noteId: '',
      text: undefined,
      topicId: '',
    }
  }
  return {
    schedule: event.allDay
      ? { date: start.format('YYYY-MM-DD'), kind: 'deadline' as const, time: null }
      : { date: start.format('YYYY-MM-DD'), kind: 'deadline' as const, time: start.format('HH:mm') },
    blockId: event.id,
    noteId: '',
    text: undefined,
    topicId: '',
  }
}

export function TodoTimeGridView({
  calendarEvents,
  locale,
  now,
  onCreateTask,
  onSelectTask,
  onUpdateTask,
  settings,
  tasks,
  weekStart,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  locale: string
  now: number
  onCreateTask: (input: CreateDesktopTodoTaskInput) => Promise<DesktopTodoTask>
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  settings: DesktopTodoConfiguration
  tasks: readonly DesktopTodoTask[]
  weekStart: 'monday' | 'sunday'
}) {
  const { t } = useTranslation('todo')
  const [mode, setMode] = useState<'day' | 'multi-day' | 'week' | 'multi-week'>('day')
  const [multiDay, setMultiDay] = useState(() => remembered(storageKeys.multiDay, 3, 1, 7))
  const [multiWeek, setMultiWeek] = useState(() => remembered(storageKeys.multiWeek, 2, 1, 4))
  const [anchor, setAnchor] = useState(() => dayjs(now).startOf('day').toDate())
  const calendarRootRef = useRef<HTMLDivElement>(null)
  const fullCalendarRef = useRef<FullCalendar>(null)
  const days = mode === 'day' ? 1 : mode === 'multi-day' ? multiDay : mode === 'week' ? 7 : multiWeek * 7
  const workdayStart = `${String(Math.floor(settings.timelineWorkdayStartMinutes / 60)).padStart(2, '0')}:${String(settings.timelineWorkdayStartMinutes % 60).padStart(2, '0')}:00`
  const calendarEventsForView = useMemo(() => tasks.map((task) => {
    const start = taskStart(task)
    if (!start)
      return null
    return {
      allDay: task.schedule.kind === 'span' ? task.schedule.allDay : task.schedule.kind === 'deadline' && task.schedule.time === null,
      backgroundColor: task.status === 'done' ? 'var(--todo-done)' : 'var(--todo-task)',
      borderColor: 'transparent',
      extendedProps: { task },
      id: task.blockId,
      end: taskEnd(task) ?? undefined,
      start,
      title: task.text,
    }
  }).filter((event): event is NonNullable<typeof event> => event !== null), [tasks])
  const externalEvents = calendarEvents.map(event => ({
    allDay: event.allDay ?? !event.startAt,
    backgroundColor: 'var(--todo-calendar)',
    borderColor: 'transparent',
    id: `calendar:${event.subscriptionId}:${event.uid}:${event.startDate}`,
    start: event.startAt ?? event.startDate,
    end: event.endAt ?? (event.endDate ? dayjs(event.endDate).add(1, 'day').format('YYYY-MM-DD') : undefined),
    title: event.title,
  }))
  const changeSpan = (next: number) => {
    if (mode === 'multi-day') {
      setMultiDay(next)
      window.localStorage.setItem(storageKeys.multiDay, String(next))
    }
    else {
      setMultiWeek(next)
      window.localStorage.setItem(storageKeys.multiWeek, String(next))
    }
  }
  const handleSelect = async (info: DateSelectArg) => {
    const start = dayjs(info.start)
    const duration = settings.blankTaskDurationMinutes
    const end = duration > 0 ? start.add(duration, 'minute') : null
    await onCreateTask({
      schedule: info.allDay
        ? { allDay: true, end: (end ?? start.add(1, 'day')).format('YYYY-MM-DDT00:00'), kind: 'span' as const, start: start.format('YYYY-MM-DDT00:00') }
        : end
          ? { allDay: false, end: end.format('YYYY-MM-DDTHH:mm'), kind: 'span' as const, start: start.format('YYYY-MM-DDTHH:mm') }
          : { date: start.format('YYYY-MM-DD'), kind: 'deadline' as const, time: start.format('HH:mm') },
      text: '',
    })
  }
  const handleEventChange = async (info: EventChangeArg) => {
    const task = info.event.extendedProps.task as DesktopTodoTask | undefined
    if (!task)
      return
    const input = dateFromEvent(info.event, task)
    if (!input)
      return
    await onUpdateTask({ ...input, blockId: task.blockId, noteId: task.noteId, topicId: task.topicId, text: task.text })
  }
  const handleEventClick = (info: EventClickArg) => {
    const task = info.event.extendedProps.task as DesktopTodoTask | undefined
    if (task)
      void onSelectTask(task)
  }
  const viewType = mode === 'day' ? 'timeGridDay' : 'timeGridWeek'
  const rangeLabel = t(mode === 'multi-day' ? 'multiDayView' : mode === 'multi-week' ? 'multiWeekView' : mode === 'week' ? 'weekView' : 'dayView')
  const dateLabel = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(anchor)
  useLayoutEffect(() => {
    const root = calendarRootRef.current
    if (!root)
      return
    let frame = 0
    const fitWorkday = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const scroller = root.querySelector<HTMLElement>('.fc-scroller-liquid-absolute')
        if (!scroller || scroller.clientHeight === 0)
          return
        const visibleSlots = (settings.timelineWorkdayEndMinutes - settings.timelineWorkdayStartMinutes) / 30
        root.style.setProperty('--todo-time-grid-slot-height', `${scroller.clientHeight / visibleSlots}px`)
        frame = window.requestAnimationFrame(() => fullCalendarRef.current?.getApi().scrollToTime(workdayStart))
      })
    }
    const observer = new ResizeObserver(fitWorkday)
    observer.observe(root)
    fitWorkday()
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [days, mode, settings.timelineWorkdayEndMinutes, settings.timelineWorkdayStartMinutes, workdayStart])
  return (
    <div {...stylex.props(styles.root)} data-todo-time-grid-view data-todo-view="schedule">
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.dateControls)}>
          <h2 {...stylex.props(styles.dateTitle)}>{dateLabel}</h2>
          <button {...stylex.props(styles.today)} type="button" onClick={() => setAnchor(dayjs(now).startOf('day').toDate())}>{t('today')}</button>
          <div {...stylex.props(styles.navigation)}>
            <button {...stylex.props(styles.navigationButton)} aria-label={t('previousPeriod')} type="button" onClick={() => setAnchor(current => dayjs(current).subtract(days, 'day').toDate())}>
              <ChevronLeft aria-hidden="true" size={16} />
            </button>
            <button {...stylex.props(styles.navigationButton)} aria-label={t('nextPeriod')} type="button" onClick={() => setAnchor(current => dayjs(current).add(days, 'day').toDate())}>
              <ChevronRight aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
        <div {...stylex.props(styles.controls)} role="group" aria-label={t('timelineRange')}>
          <div {...stylex.props(styles.range)}>
            {(['day', 'multi-day', 'week', 'multi-week'] as const).map(value => (
              <button key={value} type="button" aria-pressed={mode === value} {...stylex.props(styles.rangeButton, mode === value && styles.rangeButtonSelected)} onClick={() => setMode(value)}>
                {t(value === 'multi-day' ? 'multiDayView' : value === 'multi-week' ? 'multiWeekView' : value === 'week' ? 'weekView' : 'dayView')}
              </button>
            ))}
          </div>
          {(mode === 'multi-day' || mode === 'multi-week') && (
            <select {...stylex.props(styles.spanSelect)} aria-label={rangeLabel} value={mode === 'multi-day' ? multiDay : multiWeek} onChange={event => changeSpan(Number(event.target.value))}>
              {Array.from({ length: mode === 'multi-day' ? 7 : 4 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          )}
        </div>
      </div>
      <div ref={calendarRootRef} {...stylex.props(styles.calendar)} data-todo-time-grid-calendar>
        <FullCalendar
          ref={fullCalendarRef}
          key={`${mode}:${days}:${anchor.toISOString()}`}
          allDaySlot
          allDayText={t('allDay')}
          editable
          firstDay={weekStart === 'monday' ? 1 : 0}
          height="100%"
          headerToolbar={false}
          initialDate={anchor}
          initialView={viewType}
          locale={locale}
          nowIndicator
          plugins={[timeGridPlugin, interactionPlugin]}
          scrollTime={workdayStart}
          select={handleSelect}
          selectable
          slotMaxTime="24:00:00"
          slotMinTime="00:00:00"
          eventClick={handleEventClick}
          eventChange={handleEventChange}
          events={[...calendarEventsForView, ...externalEvents]}
          views={{ timeGridWeek: { duration: { days } } }}
        />
      </div>
    </div>
  )
}
