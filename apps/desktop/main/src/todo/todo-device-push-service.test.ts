import type { TodoTask } from '@memorilo/editor-storage'
import { describe, expect, it, vi } from 'vitest'
import { buildSnapshot, createTodoDevicePushService } from './todo-device-push-service'

function task(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    schedule: { date: '2026-09-05', kind: 'deadline', time: null },
    blockId: 'task-1',
    elapsedMs: 0,
    journalDate: '2026-09-05',
    noteFavorite: false,
    noteId: 'note-1',
    noteTitle: 'Note',
    parentId: null,
    repeatRule: null,
    reminderMinutes: null,
    reminders: null,
    startedAt: null,
    status: 'todo',
    text: 'Buy milk',
    topicId: 'topic-1',
    topicTitle: 'Today',
    ...overrides,
  }
}

describe('tODO device push service', () => {
  it('maps tasks to a stable bounded snapshot and device status values', async () => {
    const first = await buildSnapshot([task({ status: 'doing' })], new Date('2026-09-05T00:00:00.000Z'))
    const second = await buildSnapshot([task({ status: 'doing' })], new Date('2026-09-05T01:00:00.000Z'))
    expect(first.revision).toBe(second.revision)
    expect(first.items[0]?.status).toBe('in-progress')
    expect(first.timeZoneOffsetMinutes).toBe(-new Date('2026-09-05T00:00:00.000Z').getTimezoneOffset())
  })

  it('filters completed tasks before applying the device limit', async () => {
    const snapshot = await buildSnapshot([
      ...Array.from({ length: 64 }, (_, index) => task({ blockId: `done-${index}`, status: 'done' })),
      task({ blockId: 'open-task', status: 'todo' }),
    ])

    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]?.id).toBe('open-task')
  })

  it('does not leave a child pointing at a filtered parent', async () => {
    const snapshot = await buildSnapshot([
      task({ blockId: 'done-parent', status: 'done' }),
      task({ blockId: 'open-child', parentId: 'done-parent' }),
    ])

    expect(snapshot.items[0]?.parentId).toBeNull()
  })

  it('debounces local mutations and keeps LAN failures out of the caller', async () => {
    vi.useFakeTimers()
    const push = vi.fn(async () => {
      throw new Error('offline')
    })
    const service = createTodoDevicePushService({
      debounceMs: 100,
      listTasks: async () => [task()],
      push,
      targets: [{ address: '192.168.4.23', deviceId: 'device-1' }],
    })
    service.notifyLocalMutation()
    service.notifyLocalMutation()
    await vi.advanceTimersByTimeAsync(100)
    expect(push).toHaveBeenCalledTimes(1)
    expect(service.statuses()[0]?.phase).toBe('error')
    service.close()
    vi.useRealTimers()
  })

  it('builds an explicit empty snapshot for a desktop with no TODOs', async () => {
    const service = createTodoDevicePushService({
      listTasks: async () => [],
      push: async () => undefined,
      targets: [],
    })
    await expect(service.snapshot()).resolves.toMatchObject({ items: [] })
    service.close()
  })
})
