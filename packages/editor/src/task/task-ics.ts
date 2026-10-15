import dayjs from 'dayjs'

export interface TaskIcsEvent {
  allDay: boolean
  description?: string
  descriptionHtml?: string
  end?: string | null
  parentContext?: string
  start: string
  status?: 'CANCELLED' | 'CONFIRMED' | 'TENTATIVE'
  summary: string
  uid: string
}

export interface TaskIcsCalendarOptions {
  calendarName: string
  generatedAt?: string
  productId?: string
  timeZone?: string
}

export function todoOccurrenceUid(todoId: string, occurrenceKey: string): string {
  if (todoId.length === 0 || occurrenceKey.length === 0)
    throw new TypeError('Todo ICS identity must not be empty')
  return `${todoId}:${occurrenceKey}@memorilo`
}

function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n')
}

function dateValue(value: string): string {
  const parsed = dayjs(value)
  if (!parsed.isValid())
    throw new TypeError(`Invalid ICS date value: ${value}`)
  return parsed.format('YYYYMMDD')
}

function dateTimeValue(value: string): string {
  const parsed = dayjs(value)
  if (!parsed.isValid())
    throw new TypeError(`Invalid ICS date-time value: ${value}`)
  return parsed.format('YYYYMMDD[T]HHmmss')
}

function stampValue(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw new TypeError(`Invalid ICS timestamp: ${value}`)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getUTCFullYear()}${pad(parsed.getUTCMonth() + 1)}${pad(parsed.getUTCDate())}T${pad(parsed.getUTCHours())}${pad(parsed.getUTCMinutes())}${pad(parsed.getUTCSeconds())}Z`
}

function nextDate(value: string): string {
  return dayjs(value).add(1, 'day').format('YYYY-MM-DD')
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

function foldLine(line: string): readonly string[] {
  const result: string[] = []
  let current = ''
  for (const character of line) {
    const candidate = current + character
    if (current.length > 0 && utf8Length(candidate) > 75) {
      result.push(current)
      current = ` ${character}`
    }
    else {
      current = candidate
    }
  }
  if (current.length > 0)
    result.push(current)
  return result
}

function property(name: string, value: string, parameters = ''): readonly string[] {
  return foldLine(`${name}${parameters}:${value}`)
}

function eventLines(event: TaskIcsEvent, timeZone: string | undefined, generatedAt: string): readonly string[] {
  const lines: string[] = ['BEGIN:VEVENT', ...property('UID', escapeText(event.uid)), ...property('DTSTAMP', stampValue(generatedAt))]
  if (event.allDay) {
    const start = event.start.slice(0, 10)
    lines.push(...property('DTSTART;VALUE=DATE', dateValue(start)))
    const end = event.end?.slice(0, 10)
    lines.push(...property('DTEND;VALUE=DATE', dateValue(end ? nextDate(end) : nextDate(start))))
  }
  else {
    const parameter = timeZone ? `;TZID=${escapeText(timeZone)}` : ''
    lines.push(...property('DTSTART', dateTimeValue(event.start), parameter))
    if (event.end)
      lines.push(...property('DTEND', dateTimeValue(event.end), parameter))
  }
  lines.push(...property('SUMMARY', escapeText(event.summary)))
  if (event.description || event.parentContext) {
    const description = [event.description, event.parentContext ? `Parent: ${event.parentContext}` : null].filter((value): value is string => value !== undefined && value !== null && value.length > 0).join('\n')
    lines.push(...property('DESCRIPTION', escapeText(description)))
  }
  if (event.descriptionHtml)
    lines.push(...property('X-ALT-DESC', escapeText(event.descriptionHtml), ';FMTTYPE=text/html'))
  lines.push(...property('STATUS', event.status ?? 'CONFIRMED'), 'END:VEVENT')
  return lines
}

/** Serializes materialized Todo occurrences into a deterministic RFC 5545 feed. */
export function serializeTodoIcsFeed(events: readonly TaskIcsEvent[], options: TaskIcsCalendarOptions): string {
  const productId = options.productId ?? '-//Memorilo//Todo Calendar//EN'
  const generatedAt = options.generatedAt ?? new Date().toISOString().slice(0, 19)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    ...property('PRODID', escapeText(productId)),
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...property('X-WR-CALNAME', escapeText(options.calendarName)),
    ...(options.timeZone ? property('X-WR-TIMEZONE', escapeText(options.timeZone)) : []),
    ...property('X-PUBLISHED-TTL', 'PT15M'),
  ]
  const sorted = [...events].sort((left, right) => left.start.localeCompare(right.start) || left.uid.localeCompare(right.uid))
  for (const event of sorted)
    lines.push(...eventLines(event, options.timeZone, generatedAt))
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}
