import type { DesktopTodoCalendarFeed } from '@memorilo/desktop-api'
import type { DesktopSyncServerConfiguration, DesktopTodoConfiguration } from '@memorilo/desktop-config'
import { ElectronEncryptedStringStore } from '../storage/electron-encrypted-string-store'

interface StoredFeedToken {
  readonly expiresAt: number
  readonly token: string
}

interface FeedTokenStore {
  readonly clear: () => Promise<void>
  readonly load: () => Promise<StoredFeedToken | null>
  readonly save: (value: StoredFeedToken) => Promise<void>
}

class ElectronTodoCalendarFeedTokenStore implements FeedTokenStore {
  readonly #store: ElectronEncryptedStringStore

  constructor(path: string) {
    this.#store = new ElectronEncryptedStringStore(path, 'Todo calendar feed credential')
  }

  async load(): Promise<StoredFeedToken | null> {
    const value = await this.#store.load()
    if (value === null)
      return null
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    }
    catch (error) {
      throw new TypeError('Stored Todo calendar feed credential is invalid', { cause: error })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new TypeError('Stored Todo calendar feed credential is invalid')
    const record = parsed as Record<string, unknown>
    if (typeof record.token !== 'string' || !record.token.startsWith('memorilo-calendar-v1.')
      || typeof record.expiresAt !== 'number' || !Number.isSafeInteger(record.expiresAt)) {
      throw new TypeError('Stored Todo calendar feed credential is invalid')
    }
    return { expiresAt: record.expiresAt, token: record.token }
  }

  save(value: StoredFeedToken): Promise<void> {
    return this.#store.save(JSON.stringify(value))
  }

  clear(): Promise<void> {
    return this.#store.clear()
  }
}

interface TodoCalendarFeedServiceOptions {
  readonly deviceName: () => string
  readonly feedConfiguration: () => DesktopTodoConfiguration
  readonly serverConfiguration: () => DesktopSyncServerConfiguration
  readonly serverCredential: () => string
  readonly store: FeedTokenStore
}

function httpServerUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol === 'ws:')
    url.protocol = 'http:'
  else if (url.protocol === 'wss:')
    url.protocol = 'https:'
  else
    throw new TypeError('Sync Server URL must use ws:// or wss://')
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

function feedUrl(
  server: DesktopSyncServerConfiguration,
  feed: DesktopTodoConfiguration,
  token: string,
): string {
  const url = httpServerUrl(server.url)
  url.pathname = `/calendar/${encodeURIComponent(token)}.ics`
  url.search = new URLSearchParams({
    afterDays: String(feed.calendarFeedAfterDays),
    beforeDays: String(feed.calendarFeedBeforeDays),
    completed: feed.calendarFeedCompleted,
    tz: feed.calendarFeedTimeZone,
    undated: feed.calendarFeedUndated,
  }).toString()
  return url.toString()
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { code?: unknown }
    if (typeof body.code === 'string')
      return new Error(`Sync Server request failed: ${body.code}`)
  }
  catch {
    // Preserve the HTTP status when the server did not return JSON.
  }
  return new Error(`Sync Server request failed with HTTP ${response.status}`)
}

export function createTodoCalendarFeedService(options: TodoCalendarFeedServiceOptions) {
  let operationTail = Promise.resolve()
  const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const next = operationTail.then(operation, operation)
    operationTail = next.then(() => undefined, () => undefined)
    return next
  }
  const status = async (): Promise<DesktopTodoCalendarFeed> => {
    const stored = await options.store.load()
    if (stored === null)
      return { expiresAt: null, url: null }
    const server = options.serverConfiguration()
    if (!server.enabled || server.url.trim().length === 0)
      return { expiresAt: stored.expiresAt, url: null }
    return { expiresAt: stored.expiresAt, url: feedUrl(server, options.feedConfiguration(), stored.token) }
  }

  return {
    get: () => serialize(status),
    issue: () => serialize(async (): Promise<DesktopTodoCalendarFeed> => {
      const server = options.serverConfiguration()
      const credential = options.serverCredential().trim()
      if (!server.enabled || server.url.trim().length === 0 || credential.length === 0)
        throw new Error('Connect and pair this device with a Sync Server first')
      const response = await fetch(new URL('/api/device/v1/todo-calendar-token', httpServerUrl(server.url)), {
        body: JSON.stringify({ deviceName: options.deviceName().trim() }),
        headers: { 'authorization': `Bearer ${credential}`, 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok)
        throw await responseError(response)
      const body = await response.json() as { credential?: unknown, expiresAt?: unknown }
      if (typeof body.credential !== 'string' || !body.credential.startsWith('memorilo-calendar-v1.')
        || typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt)) {
        throw new Error('Sync Server returned an invalid Todo calendar credential')
      }
      await options.store.save({ expiresAt: body.expiresAt, token: body.credential })
      return { expiresAt: body.expiresAt, url: feedUrl(server, options.feedConfiguration(), body.credential) }
    }),
    revoke: () => serialize(async (): Promise<void> => {
      const server = options.serverConfiguration()
      const credential = options.serverCredential().trim()
      if (server.enabled && server.url.trim().length > 0 && credential.length > 0) {
        const response = await fetch(new URL('/api/device/v1/todo-calendar-token/revoke', httpServerUrl(server.url)), {
          headers: { authorization: `Bearer ${credential}` },
          method: 'POST',
        })
        if (!response.ok && response.status !== 404)
          throw await responseError(response)
      }
      await options.store.clear()
    }),
  }
}

export { ElectronTodoCalendarFeedTokenStore }
