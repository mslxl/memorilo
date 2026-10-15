import { describe, expect, it } from 'vitest'
import { serializeTodoIcsFeed } from './task-ics'

describe('serializeTodoIcsFeed', () => {
  it('serializes all-day and timed events with escaping and folding', () => {
    const ics = serializeTodoIcsFeed([
      {
        allDay: true,
        description: 'line one, line two; keep\\slashes',
        start: '2026-10-03',
        summary: '全天事项',
        uid: 'todo-1@example.com',
      },
      {
        allDay: false,
        end: '2026-10-03T10:30',
        start: '2026-10-03T09:30',
        summary: 'Timed',
        uid: 'todo-2@example.com',
      },
    ], {
      calendarName: 'Todos',
      generatedAt: '2026-10-03T00:00:00Z',
      timeZone: 'Asia/Shanghai',
    })
    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261003')
    expect(ics).toContain('DTEND;VALUE=DATE:20261004')
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20261003T093000')
    expect(ics).toContain('DESCRIPTION:line one\\, line two\\; keep\\\\slashes')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('returns an empty but valid calendar', () => {
    expect(serializeTodoIcsFeed([], { calendarName: 'Todos', generatedAt: '2026-10-03T00:00:00Z' }))
      .toContain('BEGIN:VCALENDAR\r\n')
  })
})
