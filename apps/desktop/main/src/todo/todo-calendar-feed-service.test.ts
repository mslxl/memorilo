import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTodoCalendarFeedService } from './todo-calendar-feed-service'

interface StoredValue {
  expiresAt: number
  token: string
}

function createStore(initial: StoredValue | null = null) {
  let value = initial
  return {
    clear: vi.fn(async () => { value = null }),
    load: vi.fn(async () => value),
    save: vi.fn(async (next: StoredValue) => { value = next }),
  }
}

function createService(store: ReturnType<typeof createStore>) {
  return createTodoCalendarFeedService({
    deviceName: () => 'Laptop',
    feedConfiguration: () => ({
      autoCompleteParentTasks: true,
      blankTaskDurationMinutes: 0,
      calendarFeedAfterDays: 14,
      calendarFeedBeforeDays: 3,
      calendarFeedCompleted: 'hide',
      calendarFeedTimeZone: 'Asia/Shanghai',
      calendarFeedUndated: 'today',
      enabled: true,
      keepDetailOpenWhenTaskLeavesView: true,
      recurringTaskCompletionAction: 'archive-completed-to-today',
      timelineWorkdayEndMinutes: 1_260,
      timelineWorkdayStartMinutes: 420,
    }),
    serverConfiguration: () => ({
      enabled: true,
      generation: 1,
      membershipEpoch: 2,
      modes: ['relay'],
      peerId: 'server-peer',
      policyEpoch: 1,
      url: 'wss://sync.example.test',
    }),
    serverCredential: () => 'device-credential',
    store,
  })
}

describe('todo calendar feed service', () => {
  afterEach(() => vi.restoreAllMocks())

  it('builds a feed URL from the stored token and desktop settings', async () => {
    const service = createService(createStore({ expiresAt: 1_800_000_000_000, token: 'memorilo-calendar-v1.secret' }))

    await expect(service.get()).resolves.toEqual({
      expiresAt: 1_800_000_000_000,
      url: 'https://sync.example.test/calendar/memorilo-calendar-v1.secret.ics?afterDays=14&beforeDays=3&completed=hide&tz=Asia%2FShanghai&undated=today',
    })
  })

  it('issues and persists a token, then revokes and clears it', async () => {
    const store = createStore()
    const service = createService(store)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/todo-calendar-token'))
        return new Response(JSON.stringify({ credential: 'memorilo-calendar-v1.issued', expiresAt: 1_900_000_000_000 }), { status: 200 })
      return new Response(null, { status: 200 })
    })

    await expect(service.issue()).resolves.toMatchObject({ url: expect.stringContaining('/calendar/memorilo-calendar-v1.issued.ics') })
    expect(store.save).toHaveBeenCalledWith({ expiresAt: 1_900_000_000_000, token: 'memorilo-calendar-v1.issued' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://sync.example.test/api/device/v1/todo-calendar-token')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })

    await service.revoke()
    expect(store.clear).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://sync.example.test/api/device/v1/todo-calendar-token/revoke')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
  })

  it('serializes concurrent issue and revoke operations', async () => {
    const store = createStore()
    const service = createService(store)
    let releaseIssue!: () => void
    const issueGate = new Promise<void>((resolve) => {
      releaseIssue = resolve
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/todo-calendar-token')) {
        await issueGate
        return new Response(JSON.stringify({ credential: 'memorilo-calendar-v1.issued', expiresAt: 1_900_000_000_000 }), { status: 200 })
      }
      return new Response(null, { status: 200 })
    })

    const issued = service.issue()
    const revoked = service.revoke()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledOnce()
    releaseIssue()
    await Promise.all([issued, revoked])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(store.load()).resolves.toBeNull()
  })
})
