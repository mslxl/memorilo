import { describe, expect, it } from 'vitest'
import { projectTaskOccurrences } from './task-occurrences'

describe('projectTaskOccurrences', () => {
  it('projects a deadline and calculable due recurrence', () => {
    const result = projectTaskOccurrences(
      { date: '2026-10-03', kind: 'deadline', time: '09:30' },
      { interval: 1, mode: 'due', unit: 'day' },
      { from: '2026-10-03', through: '2026-10-05' },
    )
    expect(result.map(item => [item.source, item.occurrenceDate, item.start])).toEqual([
      ['persisted', '2026-10-03', '2026-10-03T09:30'],
      ['preview', '2026-10-04', '2026-10-04T09:30'],
      ['preview', '2026-10-05', '2026-10-05T09:30'],
    ])
  })

  it('does not speculate completion based recurrences', () => {
    const result = projectTaskOccurrences(
      { date: '2026-10-03', kind: 'deadline', time: null },
      { interval: 1, mode: 'completion', unit: 'day' },
      { from: '2026-10-03', through: '2026-10-05' },
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('persisted')
  })

  it('places an undated item on the supplied display date', () => {
    const result = projectTaskOccurrences(
      { kind: 'none' },
      null,
      { from: '2026-10-03', through: '2026-10-03', undatedDate: '2026-10-03' },
    )
    expect(result[0]).toMatchObject({ allDay: true, occurrenceDate: '2026-10-03', start: '2026-10-03' })
  })
})
