import type { TFunction } from 'i18next'
import type { CSSProperties, Ref } from 'react'
import type { TaskReminder, TaskRepeatRule, TaskSchedule, TaskStatus } from '../schema/task-schema'
import type { TaskActionUpdate } from './task-action-model'
import type { TaskCalendarEvent, TaskCalendarSubscription } from './task-calendar'
import type { TaskRepeatPickerMode } from './task-repeat-picker'
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating } from '@floating-ui/react'
import { toError } from '@memorilo/effect-lifecycle'
import { Button, Surface, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import dayjs from 'dayjs'
import {
  Bell,
  CalendarPlus2,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Moon,
  Repeat2,
  Sun,
  Sunrise,
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { editorPositionerAdapterStyles } from '../ui/floating-surface/editor-positioner-adapter.stylex'
import { taskActionPanelStyles as styles } from './task-action-panel.stylex'
import { dateTimeValue, isChinaRegion, monthDays, reminderSummary, repeatSummary, taskReminders, translationLocale } from './task-action-view-model'
import { previewTaskRecurrenceDates } from './task-recurrence'
import { TaskReminderPicker } from './task-reminder-picker'
import { TaskRepeatPicker } from './task-repeat-picker'
import { TaskTimePicker } from './task-time-picker'

export interface TaskActionTask {
  schedule: TaskSchedule
  occurrenceDate: string
  reminderMinutes: number | null
  reminders: readonly TaskReminder[] | null
  repeatRule: TaskRepeatRule | null
  status: TaskStatus
  text: string
}

export interface TaskActionPanelProps {
  calendarEvents: readonly TaskCalendarEvent[]
  calendarSubscriptions: readonly TaskCalendarSubscription[]
  id?: string
  panelRef?: Ref<HTMLDivElement>
  style?: CSSProperties
  t: TFunction
  task: TaskActionTask
  visible?: boolean
  onUpdate: (input: TaskActionUpdate) => Promise<void> | void
  onUpdated?: () => void
}

const weekdayOptions = [
  { id: 0, labelKey: 'weekdaySunday' },
  { id: 1, labelKey: 'weekdayMonday' },
  { id: 2, labelKey: 'weekdayTuesday' },
  { id: 3, labelKey: 'weekdayWednesday' },
  { id: 4, labelKey: 'weekdayThursday' },
  { id: 5, labelKey: 'weekdayFriday' },
  { id: 6, labelKey: 'weekdaySaturday' },
] as const

const quickDateOptions = [
  { icon: Sun, key: 'today' },
  { icon: Sunrise, key: 'tomorrow' },
  { icon: CalendarPlus2, key: 'nextWeek' },
  { icon: Moon, key: 'tonight' },
  { icon: CalendarX2, key: 'noDate' },
] as const

export function TaskActionPanel({
  calendarEvents,
  calendarSubscriptions,
  id,
  onUpdate,
  onUpdated,
  panelRef,
  style,
  t,
  task,
  visible = true,
}: TaskActionPanelProps) {
  const headingId = useId()
  const baseDate = task.schedule.kind === 'deadline' ? task.schedule.date : task.schedule.kind === 'span' ? task.schedule.start.slice(0, 10) : task.occurrenceDate
  const [mode, setMode] = useState<'date' | 'span'>(() => task.schedule.kind === 'span' ? 'span' : 'date')
  const [allDay, setAllDay] = useState(() => task.schedule.kind === 'span' && task.schedule.allDay)
  // Keep the fallback occurrence date for calendar/repeat calculations, but do
  // not turn it into an explicit due date until the user selects one.
  const [selectedDate, setSelectedDate] = useState<string | null>(() => task.schedule.kind === 'deadline' ? task.schedule.date : null)
  const [activeMonth, setActiveMonth] = useState(() => dayjs(baseDate).startOf('month'))
  const [deadlineTime, setDeadlineTime] = useState(() => task.schedule.kind === 'deadline' ? task.schedule.time ?? '' : '')
  const [spanStart, setSpanStart] = useState(() => task.schedule.kind === 'span' ? task.schedule.start : dateTimeValue(baseDate, '09:00'))
  const [spanEnd, setSpanEnd] = useState(() => task.schedule.kind === 'span' ? task.schedule.end : dateTimeValue(baseDate, '10:00'))
  const [allDayStartDate, setAllDayStartDate] = useState(() => task.schedule.kind === 'span' ? task.schedule.start.slice(0, 10) : baseDate)
  const [allDayEndDate, setAllDayEndDate] = useState(() => task.schedule.kind === 'span' ? task.schedule.end.slice(0, 10) : baseDate)
  const [reminders, setReminders] = useState<readonly TaskReminder[]>(() => taskReminders(task))
  const [repeatPickerOpen, setRepeatPickerOpen] = useState(false)
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false)
  const [repeatPickerMode, setRepeatPickerMode] = useState<TaskRepeatPickerMode>('presets')
  const [repeatDraft, setRepeatDraft] = useState<TaskRepeatRule | null>(() => task.repeatRule)
  const [repeatSnapshot, setRepeatSnapshot] = useState<TaskRepeatRule | null>(() => task.repeatRule)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const days = useMemo(() => monthDays(activeMonth), [activeMonth])
  const repeatTemplate = useMemo<TaskRepeatRule>(() => repeatDraft ?? ({
    interval: 1,
    mode: 'due',
    unit: 'day',
    weekdays: [dayjs(task.occurrenceDate).day()],
  }), [repeatDraft, task.occurrenceDate])
  const selectedCalendarId = (repeatTemplate.calendarId ?? '').length > 0
    ? repeatTemplate.calendarId ?? ''
    : calendarSubscriptions.find(subscription => subscription.enabled)?.id ?? ''
  const needsCalendar = repeatTemplate.unit === 'holiday'
    || repeatTemplate.skipHolidays === true
    || (repeatTemplate.holidayPolicy !== undefined && repeatTemplate.holidayPolicy !== 'allow')
  const repeatRule = useMemo<TaskRepeatRule>(() => ({
    ...repeatTemplate,
    ...(needsCalendar && selectedCalendarId.length > 0 ? { calendarId: selectedCalendarId } : {}),
  }), [needsCalendar, repeatTemplate, selectedCalendarId])
  const { refs, floatingStyles } = useFloating({
    open: repeatPickerOpen,
    onOpenChange: setRepeatPickerOpen,
    placement: 'bottom-start',
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({ apply({ availableHeight, elements }) { Object.assign(elements.floating.style, { maxHeight: `${Math.max(0, availableHeight)}px` }) } }),
    ],
    whileElementsMounted: autoUpdate,
  })
  const { refs: timeRefs, floatingStyles: timeFloatingStyles } = useFloating({
    open: timePickerOpen,
    onOpenChange: setTimePickerOpen,
    placement: 'bottom-start',
    middleware: [offset(6), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const { refs: reminderRefs, floatingStyles: reminderFloatingStyles } = useFloating({
    open: reminderPickerOpen,
    onOpenChange: setReminderPickerOpen,
    placement: 'bottom-start',
    middleware: [offset(6), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const previewDates = useMemo(() => repeatDraft !== null
    ? previewTaskRecurrenceDates(selectedDate ?? baseDate, repeatRule, {
        calendarEvents,
        from: activeMonth.startOf('month').format('YYYY-MM-DD'),
        through: activeMonth.endOf('month').format('YYYY-MM-DD'),
      })
    : [], [activeMonth, baseDate, calendarEvents, repeatDraft, repeatRule, selectedDate])

  const update = async (input: TaskActionUpdate) => {
    setError(null)
    setUpdating(true)
    try {
      await onUpdate(input)
      onUpdated?.()
    }
    catch (cause) {
      setError(toError(cause).message)
    }
    finally {
      setUpdating(false)
    }
  }

  const scheduleUpdate = (): TaskActionUpdate => {
    if (mode === 'span') {
      const effectiveStart = allDay ? dateTimeValue(allDayStartDate, spanStart.slice(11) || '09:00') : spanStart
      const effectiveEnd = allDay ? dateTimeValue(allDayEndDate, spanEnd.slice(11) || '10:00') : spanEnd
      if (effectiveStart.length === 0 || effectiveEnd.length === 0 || effectiveEnd <= effectiveStart)
        throw new RangeError(t('timeSpanError'))
      return { reminders, schedule: { allDay, end: effectiveEnd, kind: 'span', start: effectiveStart } }
    }
    return { reminders, schedule: selectedDate === null ? { kind: 'none' } : { date: selectedDate, kind: 'deadline', time: deadlineTime.length === 0 ? null : deadlineTime } }
  }

  const save = () => {
    try {
      const schedule = scheduleUpdate()
      const repeat = repeatDraft === null ? null : repeatRule
      if (repeatDraft !== null) {
        if (!Number.isSafeInteger(repeatRule.interval) || repeatRule.interval < 1 || repeatRule.interval > 999) {
          setError(t('repeatIntervalError'))
          return
        }
        if (needsCalendar && selectedCalendarId.length === 0) {
          setError(t('repeatCalendarError'))
          return
        }
        if (repeatRule.unit === 'week' && (repeatRule.weekdays?.length ?? 0) === 0) {
          setError(t('repeatWeekdayError'))
          return
        }
        if (repeatRule.mode === 'custom' && (repeatRule.anchorDate === undefined || repeatRule.anchorDate < baseDate)) {
          setError(t('repeatCustomDateError'))
          return
        }
        if (repeatRule.endDate !== undefined && selectedDate !== null && repeatRule.endDate < selectedDate) {
          setError(t('repeatEndDateError'))
          return
        }
      }
      void update({ ...schedule, repeatRule: repeat })
    }
    catch (cause) {
      setError(toError(cause).message)
    }
  }

  const clear = () => {
    void update({
      schedule: { kind: 'none' },
      reminderMinutes: null,
      reminders: null,
      repeatRule: null,
    })
  }

  const selectDate = (date: string | null) => {
    setSelectedDate(date)
    if (date !== null)
      setActiveMonth(dayjs(date).startOf('month'))
    if (mode === 'span' && date !== null) {
      setSpanStart(current => `${date}T${current.slice(11)}`)
      setSpanEnd(current => `${date}T${current.slice(11)}`)
      setAllDayStartDate(date)
      setAllDayEndDate(date)
    }
  }

  const quickDate = (key: (typeof quickDateOptions)[number]['key']) => {
    const today = dayjs().startOf('day')
    if (key === 'noDate') {
      selectDate(null)
      setDeadlineTime('')
      return
    }
    const date = key === 'today'
      ? today
      : key === 'tomorrow'
        ? today.add(1, 'day')
        : key === 'nextWeek'
          ? today.add(1, 'week').startOf('week').add(1, 'day')
          : today
    selectDate(date.format('YYYY-MM-DD'))
    if (key === 'tonight')
      setDeadlineTime('20:00')
  }

  return (
    <Surface
      asChild
      variant="popover"
      xstyle={[editorPositionerAdapterStyles.motion, styles.panel]}
    >
      <div
        ref={panelRef}
        aria-labelledby={headingId}
        id={id}
        role="dialog"
        style={{ ...style, visibility: visible ? 'visible' : 'hidden' }}
      >
        <strong id={headingId} {...stylex.props(styles.heading)}>{t('scheduleSettings')}</strong>
        <div {...stylex.props(styles.segmented)} role="tablist" aria-label={t('scheduleMode')}>
          <button
            {...stylex.props(styles.segment, mode === 'date' && styles.segmentSelected)}
            aria-selected={mode === 'date'}
            role="tab"
            type="button"
            onClick={() => {
              setMode('date')
              setTimePickerOpen(false)
              setReminderPickerOpen(false)
              setRepeatPickerOpen(false)
            }}
          >
            {t('scheduleDate')}
          </button>
          <button
            {...stylex.props(styles.segment, mode === 'span' && styles.segmentSelected)}
            aria-selected={mode === 'span'}
            role="tab"
            type="button"
            onClick={() => {
              setMode('span')
              setTimePickerOpen(false)
              setReminderPickerOpen(false)
              setRepeatPickerOpen(false)
            }}
          >
            {t('scheduleSpan')}
          </button>
        </div>

        {mode === 'date'
          ? (
              <>
                <div {...stylex.props(styles.quickDates)}>
                  {quickDateOptions.map(({ icon: Icon, key }) => (
                    <button key={key} {...stylex.props(styles.quickDate)} aria-label={t(`quickDate${key.slice(0, 1).toUpperCase()}${key.slice(1)}`)} title={t(`quickDate${key.slice(0, 1).toUpperCase()}${key.slice(1)}`)} type="button" onClick={() => quickDate(key)}>
                      <Icon aria-hidden="true" size={16} strokeWidth={1.7} />
                    </button>
                  ))}
                </div>
                <div {...stylex.props(styles.monthHeader)}>
                  <button {...stylex.props(styles.iconButton)} aria-label={t('previousMonth')} title={t('previousMonth')} type="button" onClick={() => setActiveMonth(current => current.subtract(1, 'month'))}><ChevronLeft aria-hidden="true" size={15} /></button>
                  <span>{new Intl.DateTimeFormat(translationLocale(), { month: 'long', year: 'numeric' }).format(activeMonth.toDate())}</span>
                  <button {...stylex.props(styles.iconButton)} aria-label={t('nextMonth')} title={t('nextMonth')} type="button" onClick={() => setActiveMonth(current => current.add(1, 'month'))}><ChevronRight aria-hidden="true" size={15} /></button>
                </div>
                <div {...stylex.props(styles.weekdays)} aria-hidden="true">
                  {weekdayOptions.map(day => <span key={day.id}>{t(day.labelKey)}</span>)}
                </div>
                <div {...stylex.props(styles.calendarGrid)} role="grid" aria-label={t('scheduleDate')}>
                  {days.map((day) => {
                    const date = day.format('YYYY-MM-DD')
                    const inMonth = day.month() === activeMonth.month()
                    const selected = date === selectedDate
                    const preview = previewDates.includes(date)
                    return (
                      <button key={date} {...stylex.props(styles.dayButton, !inMonth && styles.dayButtonMuted, preview && styles.dayButtonPreview, selected && styles.dayButtonSelected)} aria-label={date} aria-pressed={selected} type="button" onClick={() => selectDate(date)}>{day.date()}</button>
                    )
                  })}
                </div>
              </>
            )
          : (
              <div {...stylex.props(styles.spanFields)}>
                <div {...stylex.props(styles.allDayRow)}>
                  <span>{t('allDay')}</span>
                  <button
                    aria-checked={allDay}
                    aria-label={t('allDay')}
                    {...stylex.props(styles.allDaySwitch, allDay && styles.allDaySwitchOn)}
                    disabled={updating}
                    role="switch"
                    type="button"
                    onClick={() => setAllDay(current => !current)}
                  >
                    <span {...stylex.props(styles.allDayThumb, allDay && styles.allDayThumbOn)} />
                  </button>
                </div>
                {allDay
                  ? (
                      <>
                        <label {...stylex.props(styles.field)}>
                          {t('spanStart')}
                          <TextField xstyle={styles.dateTimeInput} disabled={updating} type="date" value={allDayStartDate} onChange={event => setAllDayStartDate(event.target.value)} />
                        </label>
                        <label {...stylex.props(styles.field)}>
                          {t('spanEnd')}
                          <TextField xstyle={styles.dateTimeInput} disabled={updating} type="date" value={allDayEndDate} onChange={event => setAllDayEndDate(event.target.value)} />
                        </label>
                      </>
                    )
                  : (
                      <>
                        <label {...stylex.props(styles.field)}>
                          {t('spanStart')}
                          <TextField xstyle={styles.dateTimeInput} disabled={updating} type="datetime-local" value={spanStart} onChange={event => setSpanStart(event.target.value)} />
                        </label>
                        <label {...stylex.props(styles.field)}>
                          {t('spanEnd')}
                          <TextField xstyle={styles.dateTimeInput} disabled={updating} type="datetime-local" value={spanEnd} onChange={event => setSpanEnd(event.target.value)} />
                        </label>
                      </>
                    )}
              </div>
            )}

        <button
          ref={timeRefs.setReference}
          {...stylex.props(styles.settingRow)}
          disabled={updating || (mode === 'date' && selectedDate === null)}
          type="button"
          onClick={() => {
            if (mode === 'span') {
              setMode('date')
              setTimePickerOpen(false)
              setReminderPickerOpen(false)
              setRepeatPickerOpen(false)
              return
            }
            setRepeatPickerOpen(false)
            setTimePickerOpen(current => !current)
          }}
        >
          <Clock3 aria-hidden="true" size={15} strokeWidth={1.7} />
          <span>{t('time')}</span>
          <span {...stylex.props(styles.settingValue)}>{mode === 'span' ? (allDay ? t('allDay') : `${spanStart.slice(11)} – ${spanEnd.slice(11)}`) : deadlineTime || t('notSet')}</span>
          <ChevronRight aria-hidden="true" size={14} />
        </button>
        {timePickerOpen && mode === 'date'
          ? (
              <FloatingPortal>
                <TaskTimePicker
                  floatingStyle={timeFloatingStyles}
                  floatingOwnerId={id}
                  onChange={setDeadlineTime}
                  onClear={() => setDeadlineTime('')}
                  onClose={() => setTimePickerOpen(false)}
                  onFloatingRef={timeRefs.setFloating}
                  t={t}
                  value={deadlineTime}
                />
              </FloatingPortal>
            )
          : null}
        <button
          ref={reminderRefs.setReference}
          {...stylex.props(styles.settingRow, reminders.length > 0 && styles.settingRowSelected)}
          disabled={updating}
          type="button"
          onClick={() => {
            setTimePickerOpen(false)
            setRepeatPickerOpen(false)
            setReminderPickerOpen(current => !current)
          }}
        >
          <Bell aria-hidden="true" size={15} strokeWidth={1.7} />
          <span>{t('reminder')}</span>
          <span {...stylex.props(styles.settingValue)}>{reminderSummary(reminders, t)}</span>
          <ChevronRight aria-hidden="true" size={14} />
        </button>
        {reminderPickerOpen
          ? (
              <FloatingPortal>
                <TaskReminderPicker
                  floatingOwnerId={id}
                  floatingStyle={reminderFloatingStyles}
                  onChange={setReminders}
                  onClear={() => setReminders([])}
                  onClose={() => setReminderPickerOpen(false)}
                  onFloatingRef={reminderRefs.setFloating}
                  reminders={reminders}
                  t={t}
                />
              </FloatingPortal>
            )
          : null}
        <button
          ref={refs.setReference}
          {...stylex.props(styles.settingRow, repeatDraft !== null && styles.settingRowSelected)}
          disabled={updating}
          type="button"
          onClick={() => {
            setTimePickerOpen(false)
            setReminderPickerOpen(false)
            setRepeatSnapshot(repeatDraft === null ? null : repeatRule)
            setRepeatPickerMode('presets')
            setRepeatPickerOpen(true)
          }}
        >
          <Repeat2 aria-hidden="true" size={15} strokeWidth={1.7} />
          <span>{t('repeat')}</span>
          <span {...stylex.props(styles.settingValue)}>{repeatDraft === null ? t('repeatNone') : repeatSummary(repeatRule, t)}</span>
          <ChevronRight aria-hidden="true" size={14} />
        </button>
        {repeatPickerOpen
          ? (
              <FloatingPortal>
                <TaskRepeatPicker
                  baseDate={selectedDate ?? baseDate}
                  calendarEvents={calendarEvents}
                  calendarSubscriptions={calendarSubscriptions}
                  chinaRegion={isChinaRegion()}
                  draft={repeatDraft === null ? null : repeatRule}
                  floatingStyle={floatingStyles}
                  floatingOwnerId={id}
                  locale={translationLocale()}
                  mode={repeatPickerMode}
                  onCancel={() => {
                    setRepeatDraft(repeatSnapshot)
                    setRepeatPickerOpen(false)
                  }}
                  onChange={(next) => {
                    setRepeatDraft(next)
                  }}
                  onClose={() => setRepeatPickerOpen(false)}
                  onDisable={() => {
                    setRepeatDraft(null)
                    setRepeatPickerOpen(false)
                  }}
                  onEditCustom={() => setRepeatPickerMode('custom')}
                  onFloatingRef={refs.setFloating}
                  t={t}
                />
              </FloatingPortal>
            )
          : null}
        {error !== null ? <span {...stylex.props(styles.error)} role="alert">{error}</span> : null}
        <div {...stylex.props(styles.footer)}>
          <Button variant="plain" xstyle={styles.footerButton} disabled={updating} type="button" onClick={clear}>{t('clearSchedule')}</Button>
          <Button variant="primary" xstyle={[styles.footerButton, styles.primaryAction]} disabled={updating} type="button" onClick={save}>{t('confirmSchedule')}</Button>
        </div>
      </div>
    </Surface>
  )
}
