import type { TFunction } from 'i18next'
import type { CSSProperties, ReactNode } from 'react'
import type {
  TaskRepeatDayOfMonth,
  TaskRepeatMonthMode,
  TaskRepeatOrdinal,
  TaskRepeatRule,
  TaskRepeatUnit,
  TaskRepeatYearMode,
} from '../schema/task-schema'
import type { TaskCalendarEvent, TaskCalendarSubscription } from './task-calendar'
import { Button, SelectField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import dayjs from 'dayjs'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { previewTaskRecurrenceDates } from './task-recurrence'
import { taskRepeatPickerStyles as styles } from './task-repeat-picker.stylex'
import { dateFormat, dayOfMonthOptions, isPreset, monthDays, monthFormat, ordinalKeys, presetRule, ruleSummary, weekdayKeys, withDefaults } from './task-repeat-view-model'

export type TaskRepeatPickerMode = 'presets' | 'custom'

export interface TaskRepeatPickerProps {
  baseDate: string
  calendarEvents: readonly TaskCalendarEvent[]
  calendarSubscriptions: readonly TaskCalendarSubscription[]
  chinaRegion: boolean
  draft: TaskRepeatRule | null
  locale?: string
  mode: TaskRepeatPickerMode
  floatingOwnerId?: string
  onCancel: () => void
  onChange: (rule: TaskRepeatRule) => void
  onClose: () => void
  onDisable: () => void
  onEditCustom: () => void
  onFloatingRef: (element: HTMLDivElement | null) => void
  floatingStyle: CSSProperties
  t: TFunction
}

function Select({
  children,
  field,
  onChange,
  value,
}: {
  children: ReactNode
  field?: string
  onChange: (value: string) => void
  value: string
}) {
  return <SelectField data-task-field={field} xstyle={styles.input} value={value} onChange={event => onChange(event.target.value)}>{children}</SelectField>
}

function DayChoiceGrid({
  lastLabel,
  onChange,
  value,
}: {
  lastLabel: string
  onChange: (value: TaskRepeatDayOfMonth) => void
  value: TaskRepeatDayOfMonth
}) {
  return (
    <div {...stylex.props(styles.miniGrid)} data-task-group="day-of-month" role="group" aria-label={lastLabel}>
      {dayOfMonthOptions.map(item => (
        <button
          key={String(item.value)}
          {...stylex.props(styles.miniDay, item.value === 'last' && styles.miniDayLast, value === item.value && styles.miniDaySelected)}
          aria-pressed={value === item.value}
          data-task-day-of-month={item.value}
          type="button"
          onClick={() => onChange(item.value)}
        >
          {item.value === 'last' ? lastLabel : item.label}
        </button>
      ))}
    </div>
  )
}

export function TaskRepeatPicker({
  baseDate,
  calendarEvents,
  calendarSubscriptions,
  chinaRegion,
  draft,
  floatingStyle,
  floatingOwnerId,
  locale,
  mode,
  onCancel,
  onChange,
  onClose,
  onDisable,
  onEditCustom,
  onFloatingRef,
  t,
}: TaskRepeatPickerProps) {
  const normalized = withDefaults(draft ?? {
    interval: 1,
    mode: 'due',
    unit: 'day',
    weekdays: [dayjs(baseDate).day()],
  }, baseDate)
  const [activeMonth, setActiveMonth] = useState(() => dayjs(normalized.anchorDate ?? baseDate).startOf('month'))
  const activeDays = useMemo(() => monthDays(activeMonth), [activeMonth])
  const previewDates = useMemo(() => previewTaskRecurrenceDates(baseDate, normalized, {
    calendarEvents,
    from: activeMonth.startOf('month').format('YYYY-MM-DD'),
    through: activeMonth.endOf('month').format('YYYY-MM-DD'),
  }), [activeMonth, baseDate, calendarEvents, normalized])
  const selectedCalendarId = normalized.calendarId ?? calendarSubscriptions.find(item => item.enabled)?.id ?? ''
  const patchRule = (patch: Partial<TaskRepeatRule>) => onChange(withDefaults({ ...normalized, ...patch }, baseDate))
  const chooseUnit = (nextUnit: TaskRepeatUnit) => {
    const next = withDefaults({ ...normalized, unit: nextUnit }, baseDate)
    onChange(next)
  }
  const chooseCustom = () => {
    onChange(withDefaults({ ...normalized, mode: 'custom', anchorDate: normalized.anchorDate ?? baseDate }, baseDate))
    onEditCustom()
  }

  if (mode === 'presets') {
    const presets: readonly { id: TaskRepeatUnit | 'custom' | 'workday', label: string }[] = [
      { id: 'day', label: t('repeatPresetDaily') },
      { id: 'week', label: t('repeatPresetWeekly') },
      { id: 'month', label: t('repeatPresetMonthly') },
      { id: 'year', label: t('repeatPresetYearly') },
      { id: 'workday', label: t('repeatPresetWorkdays') },
      { id: 'holiday', label: t('repeatPresetHolidays') },
      ...(chinaRegion ? [{ id: 'lunar' as const, label: t('repeatPresetLunar') }] : []),
      { id: 'custom', label: t('repeatPresetCustom') },
    ]
    return (
      <div ref={onFloatingRef} {...stylex.props(styles.popover)} data-task-action-floating-owner={floatingOwnerId} data-task-repeat-picker="" data-task-repeat-mode="presets" style={floatingStyle} role="dialog" aria-label={t('repeatSettings')}>
        <div {...stylex.props(styles.presetList)}>
          <button data-task-repeat-preset="none" {...stylex.props(styles.preset)} type="button" onClick={onDisable}>
            <span>{t('repeatNone')}</span>
            <span {...stylex.props(styles.presetSummary)}>{draft === null ? <Check aria-hidden="true" size={15} strokeWidth={2.1} /> : null}</span>
          </button>
          {presets.map((preset) => {
            const selected = draft !== null && (preset.id === 'custom'
              ? normalized.mode === 'custom'
              : preset.id === 'workday'
                ? normalized.unit === 'day' && normalized.skipWeekends === true
                : isPreset(normalized, preset.id))
            return (
              <button
                key={preset.id}
                {...stylex.props(styles.preset)}
                data-task-repeat-preset={preset.id}
                type="button"
                onClick={() => {
                  if (preset.id === 'custom') {
                    chooseCustom()
                    return
                  }
                  if (preset.id === 'workday') {
                    onChange({ ...presetRule('day', baseDate, selectedCalendarId, normalized), skipHolidays: selectedCalendarId.length > 0, skipWeekends: true })
                    onClose()
                    return
                  }
                  onChange(presetRule(preset.id, baseDate, selectedCalendarId, normalized))
                  onClose()
                }}
              >
                <span>{preset.label}</span>
                <span {...stylex.props(styles.presetSummary)}>
                  {selected ? <Check aria-hidden="true" size={15} strokeWidth={2.1} /> : preset.id === 'custom' ? t('repeatConfigure') : ruleSummary(presetRule(preset.id === 'workday' ? 'day' : preset.id, baseDate, selectedCalendarId, normalized), baseDate, t)}
                </span>
              </button>
            )
          })}
        </div>
        {normalized.mode === 'custom'
          ? (
              <Button variant="primary" xstyle={styles.footerButton} type="button" onClick={onClose}>{t('confirmSchedule')}</Button>
            )
          : null}
      </div>
    )
  }

  const ordinalOptions = ordinalKeys.map(item => <option key={item.value} value={item.value}>{t(item.key)}</option>)
  const monthOptions = Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{t('monthNumber', { count: index + 1 })}</option>)
  const setMode = (value: TaskRepeatRule['mode']) => onChange(withDefaults({ ...normalized, mode: value, ...(value === 'custom' ? { anchorDate: normalized.anchorDate ?? baseDate } : {}) }, baseDate))
  const anchorDate = normalized.anchorDate ?? baseDate
  const canSelectAnchor = (date: string) => date >= baseDate

  return (
    <div ref={onFloatingRef} {...stylex.props(styles.popover, styles.customPopover)} data-task-action-floating-owner={floatingOwnerId} data-task-repeat-picker="" data-task-repeat-mode="custom" style={floatingStyle} role="dialog" aria-label={t('repeatSettings')}>
      <div {...stylex.props(styles.heading)}>
        <span>{t('repeatSettings')}</span>
        <Button data-task-action="back-to-repeat-presets" variant="icon" aria-label={t('backToRepeatPresets')} title={t('backToRepeatPresets')} type="button" onClick={onClose}>×</Button>
      </div>
      <div {...stylex.props(styles.content)}>
        <label {...stylex.props(styles.field)}>
          <span>{t('repeatReference')}</span>
          <Select field="reference" value={normalized.mode} onChange={value => setMode(value as TaskRepeatRule['mode'])}>
            <option value="due">{t('repeatDue')}</option>
            <option value="completion">{t('repeatCompletion')}</option>
            <option value="custom">{t('repeatCustomDate')}</option>
          </Select>
        </label>
        <div {...stylex.props(styles.selectRow)}>
          <label {...stylex.props(styles.field)}>
            <span>{t('repeatEvery')}</span>
            <input data-task-field="interval" {...stylex.props(styles.input)} min={1} max={999} type="number" value={normalized.interval} onChange={event => patchRule({ interval: Number(event.target.value) })} />
          </label>
          <label {...stylex.props(styles.field)}>
            <span>{t('repeatUnit')}</span>
            <Select field="unit" value={normalized.unit} onChange={value => chooseUnit(value as TaskRepeatUnit)}>
              <option value="day">{t('repeatDay')}</option>
              <option value="week">{t('repeatWeek')}</option>
              <option value="month">{t('repeatMonth')}</option>
              <option value="year">{t('repeatYear')}</option>
              {chinaRegion ? <option value="lunar">{t('repeatLunar')}</option> : null}
              <option value="holiday">{t('repeatHoliday')}</option>
            </Select>
          </label>
        </div>

        {normalized.mode === 'custom'
          ? (
              <div {...stylex.props(styles.miniMonth)}>
                <div {...stylex.props(styles.miniMonthHeader)}>
                  <button data-task-month-navigation="previous" {...stylex.props(styles.iconButton)} aria-label={t('previousMonth')} type="button" onClick={() => setActiveMonth(current => current.subtract(1, 'month'))}><ChevronLeft aria-hidden="true" size={14} /></button>
                  <span>{monthFormat(activeMonth, locale)}</span>
                  <button data-task-month-navigation="next" {...stylex.props(styles.iconButton)} aria-label={t('nextMonth')} type="button" onClick={() => setActiveMonth(current => current.add(1, 'month'))}><ChevronRight aria-hidden="true" size={14} /></button>
                </div>
                <div {...stylex.props(styles.miniWeekdays, styles.anchorWeekdays)} aria-hidden="true">{weekdayKeys.map(key => <span key={key}>{t(key)}</span>)}</div>
                <div {...stylex.props(styles.miniGrid, styles.anchorGrid)} role="grid" aria-label={t('repeatCustomDate')}>
                  {activeDays.map((day) => {
                    const date = day.format('YYYY-MM-DD')
                    const inMonth = day.month() === activeMonth.month()
                    const selected = date === anchorDate
                    const preview = previewDates.includes(date)
                    return <button key={date} data-task-date={date} {...stylex.props(styles.miniDay, styles.anchorDay, !inMonth && styles.miniDayMuted, selected && styles.miniDaySelected, preview && !selected && styles.miniDayPreview)} aria-pressed={selected} disabled={!canSelectAnchor(date)} type="button" onClick={() => patchRule({ anchorDate: date })}>{day.date()}</button>
                  })}
                </div>
              </div>
            )
          : null}

        {normalized.unit === 'week'
          ? (
              <div {...stylex.props(styles.weekdayRow)} aria-label={t('repeatOn')} data-task-group="repeat-weekdays" role="group">
                {weekdayKeys.map((key, weekday) => (
                  <button
                    key={key}
                    {...stylex.props(styles.weekday, normalized.weekdays?.includes(weekday) && styles.weekdaySelected)}
                    aria-pressed={normalized.weekdays?.includes(weekday) ?? false}
                    data-task-weekday={weekday}
                    type="button"
                    onClick={() => {
                      const current = normalized.weekdays ?? []
                      const next = current.includes(weekday) ? current.filter(item => item !== weekday) : [...current, weekday].sort((left, right) => left - right)
                      if (next.length > 0)
                        patchRule({ weekdays: next })
                    }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )
          : null}

        {normalized.unit === 'month'
          ? (
              <>
                <div {...stylex.props(styles.segmented)} role="tablist" aria-label={t('repeatMonthMode')}>
                  {(['date', 'weekday', 'workday'] as const).map(value => <button key={value} data-task-month-mode={value} {...stylex.props(styles.segment, normalized.monthMode === value && styles.segmentSelected)} aria-selected={normalized.monthMode === value} role="tab" type="button" onClick={() => patchRule({ monthMode: value as TaskRepeatMonthMode })}>{t(`repeatMonthBy${value.slice(0, 1).toUpperCase()}${value.slice(1)}`)}</button>)}
                </div>
                {normalized.monthMode === 'date'
                  ? (
                      <div {...stylex.props(styles.field)}>
                        <span>{t('repeatDayOfMonth')}</span>
                        <DayChoiceGrid lastLabel={t('repeatLastDay')} onChange={value => patchRule({ monthDay: value })} value={normalized.monthDay ?? dayjs(baseDate).date()} />
                      </div>
                    )
                  : null}
                {normalized.monthMode === 'weekday'
                  ? (
                      <div {...stylex.props(styles.selectRow)}>
                        <label {...stylex.props(styles.field)}>
                          <span>{t('repeatOrdinal')}</span>
                          <Select field="occurrence" value={String(normalized.monthOrdinal ?? 1)} onChange={value => patchRule({ monthOrdinal: Number(value) as TaskRepeatOrdinal })}>{ordinalOptions}</Select>
                        </label>
                        <label {...stylex.props(styles.field)}>
                          <span>{t('repeatWeekday')}</span>
                          <Select field="weekday" value={String(normalized.monthWeekday ?? dayjs(baseDate).day())} onChange={value => patchRule({ monthWeekday: Number(value) })}>{weekdayKeys.map((key, index) => <option key={key} value={index}>{t(key)}</option>)}</Select>
                        </label>
                      </div>
                    )
                  : null}
                {normalized.monthMode === 'workday'
                  ? (
                      <label {...stylex.props(styles.field)}>
                        <span>{t('repeatWorkdayOrdinal')}</span>
                        <Select field="workday-occurrence" value={String(normalized.monthOrdinal ?? 1)} onChange={value => patchRule({ monthOrdinal: Number(value) as TaskRepeatOrdinal })}>{ordinalOptions}</Select>
                      </label>
                    )
                  : null}
              </>
            )
          : null}

        {normalized.unit === 'year'
          ? (
              <>
                <div {...stylex.props(styles.segmented, styles.segmentedTwo)} role="tablist" aria-label={t('repeatYearMode')}>
                  {(['date', 'weekday'] as const).map(value => <button key={value} data-task-year-mode={value} {...stylex.props(styles.segment, normalized.yearMode === value && styles.segmentSelected)} aria-selected={normalized.yearMode === value} role="tab" type="button" onClick={() => patchRule({ yearMode: value as TaskRepeatYearMode })}>{t(`repeatYearBy${value.slice(0, 1).toUpperCase()}${value.slice(1)}`)}</button>)}
                </div>
                <label {...stylex.props(styles.field)}>
                  <span>{t('repeatMonthOfYear')}</span>
                  <Select field="month" value={String(normalized.yearMonth ?? dayjs(baseDate).month() + 1)} onChange={value => patchRule({ yearMonth: Number(value) })}>{monthOptions}</Select>
                </label>
                {normalized.yearMode === 'date'
                  ? (
                      <div {...stylex.props(styles.field)}>
                        <span>{t('repeatDayOfMonth')}</span>
                        <DayChoiceGrid lastLabel={t('repeatLastDay')} onChange={value => patchRule({ yearDay: value })} value={normalized.yearDay ?? dayjs(baseDate).date()} />
                      </div>
                    )
                  : (
                      <div {...stylex.props(styles.selectRow)}>
                        <label {...stylex.props(styles.field)}>
                          <span>{t('repeatOrdinal')}</span>
                          <Select field="occurrence" value={String(normalized.yearOrdinal ?? 1)} onChange={value => patchRule({ yearOrdinal: Number(value) as TaskRepeatOrdinal })}>{ordinalOptions}</Select>
                        </label>
                        <label {...stylex.props(styles.field)}>
                          <span>{t('repeatWeekday')}</span>
                          <Select field="weekday" value={String(normalized.yearWeekday ?? dayjs(baseDate).day())} onChange={value => patchRule({ yearWeekday: Number(value) })}>{weekdayKeys.map((key, index) => <option key={key} value={index}>{t(key)}</option>)}</Select>
                        </label>
                      </div>
                    )}
              </>
            )
          : null}

        {normalized.unit === 'lunar'
          ? (
              <div {...stylex.props(styles.selectRow)}>
                <label {...stylex.props(styles.field)}>
                  <span>{t('repeatLunarMonth')}</span>
                  <Select field="lunar-month" value={String(normalized.lunarMonth ?? 1)} onChange={value => patchRule({ lunarMonth: Number(value) })}>{monthOptions}</Select>
                </label>
                <label {...stylex.props(styles.field)}>
                  <span>{t('repeatLunarDay')}</span>
                  <Select field="lunar-day" value={String(normalized.lunarDay ?? 1)} onChange={value => patchRule({ lunarDay: Number(value) })}>{Array.from({ length: 30 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</Select>
                </label>
              </div>
            )
          : null}

        {normalized.unit === 'holiday'
          ? (
              <label {...stylex.props(styles.field)}>
                <span>{t('repeatCalendar')}</span>
                <Select field="calendar" value={selectedCalendarId} onChange={value => patchRule({ calendarId: value })}>{calendarSubscriptions.map(subscription => <option key={subscription.id} value={subscription.id}>{subscription.title}</option>)}</Select>
              </label>
            )
          : null}
        {normalized.unit !== 'lunar'
          ? (
              <label {...stylex.props(styles.field)}>
                <span>{t('holidayPolicy')}</span>
                <Select
                  field="holiday-policy"
                  value={normalized.holidayPolicy ?? 'allow'}
                  onChange={value => patchRule({
                    holidayPolicy: value as TaskRepeatRule['holidayPolicy'],
                    ...(value !== 'allow' && selectedCalendarId.length > 0 ? { calendarId: selectedCalendarId } : {}),
                  })}
                >
                  <option value="allow">{t('holidayAllow')}</option>
                  <option value="skip">{t('holidaySkip')}</option>
                  <option value="next-workday">{t('holidayNextWorkday')}</option>
                </Select>
              </label>
            )
          : null}
        {normalized.unit !== 'holiday' && normalized.unit !== 'lunar'
          ? (
              <>
                <label {...stylex.props(styles.checkboxRow)}>
                  <input data-task-field="skip-holidays" {...stylex.props(styles.checkbox)} checked={normalized.skipHolidays === true} type="checkbox" onChange={event => patchRule({ skipHolidays: event.target.checked, ...(event.target.checked && selectedCalendarId.length > 0 ? { calendarId: selectedCalendarId } : {}) })} />
                  {t('repeatSkipHolidays')}
                </label>
                {(normalized.unit === 'day' || normalized.monthMode === 'workday')
                  ? (
                      <label {...stylex.props(styles.checkboxRow)}>
                        <input data-task-field="skip-weekends" {...stylex.props(styles.checkbox)} checked={normalized.skipWeekends === true} type="checkbox" onChange={event => patchRule({ skipWeekends: event.target.checked })} />
                        {t('repeatSkipWeekends')}
                      </label>
                    )
                  : null}
              </>
            )
          : null}
        {normalized.mode === 'custom' ? <p {...stylex.props(styles.note)}>{t('repeatCustomPreview', { date: dateFormat(dayjs(anchorDate), locale) })}</p> : null}
        <label {...stylex.props(styles.field)}>
          <span>{t('repeatEnd')}</span>
          <Select field="end" value={normalized.endDate === undefined ? '' : 'date'} onChange={value => patchRule({ endDate: value === '' ? undefined : normalized.endDate ?? baseDate })}>
            <option value="">{t('repeatForever')}</option>
            <option value="date">{t('repeatEndOnDate')}</option>
          </Select>
        </label>
        {normalized.endDate !== undefined ? <input data-task-field="end-date" {...stylex.props(styles.input)} min={baseDate} type="date" value={normalized.endDate} onChange={event => patchRule({ endDate: event.target.value })} /> : null}
      </div>
      <div {...stylex.props(styles.footer)}>
        <Button data-task-action="cancel-repeat" variant="plain" xstyle={styles.footerButton} type="button" onClick={onCancel}>{t('cancel')}</Button>
        <Button data-task-action="save-repeat" variant="primary" xstyle={styles.footerButton} type="button" onClick={onClose}>{t('confirmSchedule')}</Button>
      </div>
    </div>
  )
}
