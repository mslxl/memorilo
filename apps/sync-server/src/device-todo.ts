import type { EditorExportNode } from '@memorilo/editor/export'
import type { TaskIcsEvent, TaskSchedule, TaskStatus } from '@memorilo/editor/task'
import type {
  SyncDeviceTodoScope,
  SyncDeviceTodoStore,
  SyncDeviceTodoToken,
  SyncNoteSnapshotRecord,
  SyncObjectStore,
  SyncRepository,
  VersionVector,
} from '@memorilo/sync'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { renderHtmlContent } from '@memorilo/editor/export'
import { createEditorNote } from '@memorilo/editor/note'
import { parseTaskRepeatRule, parseTaskSchedule, projectTaskOccurrences, readTaskStatus, serializeTodoIcsFeed, todoOccurrenceUid } from '@memorilo/editor/task'
import { Effect } from 'effect'
import { noteSnapshotRevision } from '../infrastructure/database/shared'

const deviceTokenPrefix = 'memorilo-todo-v1.'
const calendarTokenPrefix = 'memorilo-calendar-v1.'
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const managedAssetPattern = /^memorilo:\/\/asset\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+)$/u
const maxInlineImageBytes = 1024 * 1024
const assetManifestPageSize = 1_000
const inlineImageMimeTypes = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

export type DeviceTodoErrorCode
  = | 'account_not_authoritative'
    | 'forbidden'
    | 'internal_error'
    | 'invalid_request'
    | 'unauthorized'

export class DeviceTodoError extends Error {
  readonly code: DeviceTodoErrorCode
  readonly currentRevision?: string | null

  constructor(code: DeviceTodoErrorCode, message: string, options?: { readonly cause?: unknown, readonly currentRevision?: string | null }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DeviceTodoError'
    this.code = code
    this.currentRevision = options?.currentRevision
  }
}

export interface DeviceTodoItem {
  readonly schedule: TaskSchedule
  readonly id: string
  readonly noteTitle: string
  readonly parentId: string | null
  readonly revision: string
  readonly status: TaskStatus
  readonly text: string
  readonly topicTitle: string
}

export interface DeviceTodoSnapshot {
  readonly generatedAt: string
  readonly items: readonly DeviceTodoItem[]
  readonly revision: string
}

export interface TodoCalendarFeedOptions {
  readonly afterDays: number
  readonly beforeDays: number
  readonly calendarEvents?: readonly { readonly startDate: string, readonly subscriptionId: string }[]
  readonly completed: 'hide' | 'show'
  readonly from: string
  readonly timeZone?: string
  readonly through: string
  readonly undated: 'hide' | 'today'
  readonly undatedDate: string
}

export interface TodoCalendarFeedResult {
  readonly body: string
  readonly revision: string
}

export interface DeviceTodoModule {
  readonly issueToken: (input: {
    readonly accountId: string
    readonly deviceName: string
    readonly expiresAt: number
    readonly scopes: readonly SyncDeviceTodoScope[]
  }) => Effect.Effect<{ readonly credential: SyncDeviceTodoToken, readonly token: string }, DeviceTodoError>
  readonly issueCalendarToken: (input: {
    readonly accountId: string
    readonly deviceId: string
    readonly deviceName: string
  }) => Effect.Effect<{ readonly credential: SyncDeviceTodoToken, readonly token: string }, DeviceTodoError>
  readonly revokeCalendarToken: (input: { readonly accountId: string, readonly deviceId: string }) => Effect.Effect<boolean, DeviceTodoError>
  readonly list: (input: {
    readonly date: string
    readonly limit: number
    readonly token: string
    readonly view: 'all' | 'today'
  }) => Effect.Effect<DeviceTodoSnapshot, DeviceTodoError>
  readonly calendar: (input: { readonly options: TodoCalendarFeedOptions, readonly token: string }) => Effect.Effect<TodoCalendarFeedResult, DeviceTodoError>
  readonly listTokens: (accountId: string) => Effect.Effect<readonly SyncDeviceTodoToken[], DeviceTodoError>
  readonly revokeToken: (accountId: string, deviceId: string) => Effect.Effect<boolean, DeviceTodoError>
  readonly invalidateAccount: (accountId: string, generation?: number) => void
  readonly revision: (accountId: string, generation: number) => Effect.Effect<string, DeviceTodoError>
}

interface TodoIdentity {
  readonly blockId: string
  readonly noteId: string
  readonly topicId: string
}

interface ProjectedTodo extends DeviceTodoItem, TodoIdentity {
  readonly attributes: Readonly<Record<string, unknown>>
  readonly content: EditorExportNode
  readonly journalDate: string | null
}

export interface DeviceTodoModuleOptions {
  readonly now?: () => number
  readonly objectStore?: SyncObjectStore
  readonly repository: SyncRepository
  readonly store: SyncDeviceTodoStore
}

const maxTokenLifetimeMs = 365 * 24 * 60 * 60 * 1000

interface TodoProjection {
  readonly todos: readonly ProjectedTodo[]
  readonly revision: string
}

interface ManagedAsset {
  readonly contentHash: string
  readonly contentType: string | null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function collectBlockNodes(node: EditorExportNode, result: Map<string, EditorExportNode>): void {
  if (node.type === 'list' && typeof node.attrs?.blockId === 'string')
    result.set(node.attrs.blockId, node)
  node.content?.forEach(child => collectBlockNodes(child, result))
}

function imageSources(node: EditorExportNode, result: Set<string>): void {
  if (node.type === 'image' && typeof node.attrs?.src === 'string' && managedAssetPattern.test(node.attrs.src))
    result.add(node.attrs.src)
  node.content?.forEach(child => imageSources(child, result))
}

async function readObject(objectStore: SyncObjectStore, accountId: string, key: string): Promise<Uint8Array | null> {
  const object = await objectStore.get(accountId, key)
  if (object === null)
    return null
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of object.body) {
    length += chunk.byteLength
    if (length > maxInlineImageBytes)
      return null
    chunks.push(chunk)
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function loadManagedAssets(
  repository: SyncRepository,
  accountId: string,
  generation: number,
): Promise<ReadonlyMap<string, ManagedAsset>> {
  const result = new Map<string, ManagedAsset>()
  let frontier: VersionVector = {}
  while (true) {
    const page = await repository.listAssetManifests(accountId, generation, frontier, assetManifestPageSize)
    if (page.length === 0)
      break
    for (const manifest of page) {
      if (manifest.operation === 'delete' || manifest.contentHash === null) {
        result.delete(manifest.fileName)
        continue
      }
      result.set(manifest.fileName, {
        contentHash: manifest.contentHash,
        contentType: manifest.contentType,
      })
    }
    const next: Record<string, number> = { ...frontier }
    for (const manifest of page)
      next[manifest.deviceId] = Math.max(next[manifest.deviceId] ?? 0, manifest.sequence)
    frontier = next
    if (page.length < assetManifestPageSize)
      break
  }
  return result
}

async function inlineManagedImage(
  repository: SyncRepository,
  objectStore: SyncObjectStore | undefined,
  assets: ReadonlyMap<string, ManagedAsset>,
  accountId: string,
  generation: number,
  source: string,
): Promise<string | undefined> {
  if (objectStore === undefined)
    return undefined
  // Feed generation never fetches arbitrary remote image URLs.
  const match = managedAssetPattern.exec(source)
  if (!match)
    return undefined
  const fileName = match[1]!
  const asset = assets.get(fileName)
  if (!asset || !inlineImageMimeTypes.has(asset.contentType ?? ''))
    return undefined
  const metadata = await repository.getObjectMetadata(accountId, generation, asset.contentHash)
  if (metadata === null)
    return undefined
  const bytes = await readObject(objectStore, accountId, metadata.key)
  if (bytes === null)
    return undefined
  return `data:${asset.contentType};base64,${Buffer.from(bytes).toString('base64')}`
}

function todoSummary(value: string): string {
  const summary = value.replace(/\s+/gu, ' ').trim()
  return summary.length === 0 ? 'Todo' : summary
}

function todoDescriptionHtml(todo: ProjectedTodo, imageData: ReadonlyMap<string, string>, parent: ProjectedTodo | undefined): string {
  const content = renderHtmlContent(todo.content, {
    inlineAsset: source => imageData.get(source),
  })
  const source = `${escapeHtml(todo.noteTitle)} / ${escapeHtml(todo.topicTitle)}`
  const parentText = parent === undefined ? '' : `<br><strong>Parent:</strong> ${escapeHtml(parent.text)}`
  return `${content}<p style="margin:1em 0 0;color:#68707d;font-size:.9em"><strong>Source:</strong> ${source}${parentText}</p>`
}

function fail(error: unknown): DeviceTodoError {
  if (error instanceof DeviceTodoError)
    return error
  return new DeviceTodoError('internal_error', 'Device Todo operation failed', { cause: error })
}

function attempt<Result>(operation: () => Promise<Result>): Effect.Effect<Result, DeviceTodoError> {
  return Effect.tryPromise({ catch: fail, try: operation })
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function todoId(identity: TodoIdentity): string {
  return Buffer.from(JSON.stringify([identity.noteId, identity.topicId, identity.blockId]), 'utf8').toString('base64url')
}

function validDate(value: string): boolean {
  if (!isoDatePattern.test(value))
    return false
  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year!, month! - 1, day!)
  const date = new Date(timestamp)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function noteRevision(snapshot: SyncNoteSnapshotRecord): string {
  const revision = noteSnapshotRevision(snapshot)
  if (revision === null)
    throw new DeviceTodoError('internal_error', `Note ${snapshot.noteId} does not have a revision`)
  return revision
}

function buildProjection(snapshots: readonly SyncNoteSnapshotRecord[]): TodoProjection {
  const hash = createHash('sha256')
  const todos: ProjectedTodo[] = []
  for (const snapshot of snapshots) {
    try {
      const projected = projectSnapshot(snapshot)
      if (projected.length > 0) {
        todos.push(...projected)
        hash.update(snapshot.noteId).update('\0').update(noteRevision(snapshot)).update('\0')
      }
    }
    catch (error) {
      console.warn(`Skipping invalid Todo note ${snapshot.noteId} while computing revision`, error)
    }
  }
  todos.sort((left, right) => {
    const leftDate = projectedDate(left) ?? '9999-12-31'
    const rightDate = projectedDate(right) ?? '9999-12-31'
    return leftDate.localeCompare(rightDate)
      || left.noteTitle.localeCompare(right.noteTitle)
      || left.topicTitle.localeCompare(right.topicTitle)
      || left.text.localeCompare(right.text)
      || left.id.localeCompare(right.id)
  })
  return { revision: hash.digest('hex'), todos }
}

export function deviceTodoRevision(snapshots: readonly SyncNoteSnapshotRecord[]): string {
  return buildProjection(snapshots).revision
}

function projectedDate(todo: Pick<ProjectedTodo, 'schedule'>): string | null {
  return todo.schedule.kind === 'deadline'
    ? todo.schedule.date
    : todo.schedule.kind === 'span' ? todo.schedule.start.slice(0, 10) : null
}

function projectSnapshot(snapshot: SyncNoteSnapshotRecord): readonly ProjectedTodo[] {
  try {
    const revision = noteRevision(snapshot)
    const note = createEditorNote({ id: snapshot.noteId, snapshot: new Uint8Array(Buffer.from(snapshot.snapshot, 'base64url')) })
    const identity = note.getIdentity()
    const journalDate = identity.kind === 'journal' ? identity.journalDate : null
    const noteTitle = note.getTitle()
    const projected: ProjectedTodo[] = []
    for (const entry of note.getEntries()) {
      if (entry.kind !== 'topic')
        continue
      const content = note.getTopicContent(entry.id)
      const blockById = new Map(content.blocks.map(block => [block.id, block]))
      const validation = note.getTopicValidationInput(entry.id)
      const blockNodes = new Map<string, EditorExportNode>()
      if ('document' in validation)
        collectBlockNodes(validation.document, blockNodes)
      for (const block of content.blocks) {
        if (block.kind !== 'task')
          continue
        try {
          let ancestorId = block.parentId
          let todoParent: string | null = null
          const visited = new Set([block.id])
          while (ancestorId !== null) {
            if (visited.has(ancestorId))
              throw new Error(`Todo ${block.id} contains a cyclic parent chain`)
            visited.add(ancestorId)
            const ancestor = blockById.get(ancestorId)
            if (!ancestor)
              break
            if (ancestor.kind === 'task' && todoParent === null)
              todoParent = todoId({ blockId: ancestor.id, noteId: snapshot.noteId, topicId: entry.id })
            ancestorId = ancestor.parentId
          }
          const schedule = parseTaskSchedule(block.attributes.schedule)
          if (schedule === null)
            throw new Error(`Todo ${block.id} contains invalid schedule metadata`)
          projected.push({
            attributes: block.attributes,
            blockId: block.id,
            content: blockNodes.get(block.id) ?? {
              content: [{ text: block.text, type: 'text' }],
              type: 'paragraph',
            },
            id: todoId({ blockId: block.id, noteId: snapshot.noteId, topicId: entry.id }),
            journalDate,
            noteId: snapshot.noteId,
            noteTitle,
            parentId: todoParent,
            revision,
            schedule,
            status: readTaskStatus(block.attributes.status),
            text: block.text,
            topicId: entry.id,
            topicTitle: content.title,
          })
        }
        catch (error) {
          console.warn(`Skipping invalid Todo ${block.id} in note ${snapshot.noteId}`, error)
        }
      }
    }
    return projected
  }
  catch (error) {
    console.warn(`Skipping invalid Todo note ${snapshot.noteId}`, error)
    return []
  }
}

function publicTodo(todo: ProjectedTodo, selectedIds: ReadonlySet<string>): DeviceTodoItem {
  const { id, noteTitle, parentId, revision, schedule, status, text, topicTitle } = todo
  return {
    id,
    noteTitle,
    parentId: parentId !== null && selectedIds.has(parentId) ? parentId : null,
    revision,
    schedule,
    status,
    text,
    topicTitle,
  }
}

export function createDeviceTodoModule(options: DeviceTodoModuleOptions): DeviceTodoModule {
  const now = options.now ?? Date.now
  const projectionCache = new Map<string, TodoProjection>()

  const cacheKey = (accountId: string, generation: number): string => `${accountId}:${generation}`

  const getProjection = async (accountId: string, generation: number): Promise<TodoProjection> => {
    const key = cacheKey(accountId, generation)
    const cached = projectionCache.get(key)
    if (cached)
      return cached
    const snapshots = await options.repository.listNoteSnapshots(accountId, generation)
    const projection = buildProjection(snapshots)
    projectionCache.set(key, projection)
    return projection
  }

  const authorize = async (token: string, scope: SyncDeviceTodoScope, prefix = deviceTokenPrefix): Promise<SyncDeviceTodoToken> => {
    if (!token.startsWith(prefix) || token.length > 256)
      throw new DeviceTodoError('unauthorized', 'Device token is invalid')
    const credential = await options.store.findToken(tokenHash(token))
    const timestamp = now()
    if (!credential || credential.revokedAt !== null || credential.expiresAt <= timestamp)
      throw new DeviceTodoError('unauthorized', 'Device token is invalid or expired')
    if (!credential.scopes.includes(scope))
      throw new DeviceTodoError('forbidden', `Device token does not grant ${scope}`)
    return credential
  }

  const accountState = async (accountId: string) => {
    const state = await options.repository.getAccountState(accountId)
    if (!state || !state.enabledModes.includes('authoritative'))
      throw new DeviceTodoError('account_not_authoritative', 'Account does not have authoritative Note state')
    return state
  }

  return {
    issueToken: input => attempt(async () => {
      const deviceName = input.deviceName.trim()
      if (deviceName.length < 1 || deviceName.length > 64)
        throw new DeviceTodoError('invalid_request', 'Device name must contain 1-64 characters')
      if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now())
        throw new DeviceTodoError('invalid_request', 'Device token expiry must be in the future')
      if (input.expiresAt > now() + maxTokenLifetimeMs)
        throw new DeviceTodoError('invalid_request', 'Device token expiry must be within one year')
      const scopes = [...new Set(input.scopes)]
      if (scopes.length !== 1 || scopes[0] !== 'todos:read')
        throw new DeviceTodoError('invalid_request', 'Device Todo is read-only and requires the todos:read scope')
      await accountState(input.accountId)
      const token = `${deviceTokenPrefix}${randomBytes(32).toString('base64url')}`
      const credential = await options.store.createToken({
        accountId: input.accountId,
        createdAt: now(),
        deviceId: `note4:${randomUUID()}`,
        deviceName,
        expiresAt: input.expiresAt,
        scopes,
        tokenHash: tokenHash(token),
      })
      return { credential, token }
    }),
    issueCalendarToken: input => attempt(async () => {
      const deviceName = input.deviceName.trim()
      if (input.accountId.length === 0 || input.deviceId.length === 0 || deviceName.length < 1 || deviceName.length > 64)
        throw new DeviceTodoError('invalid_request', 'Calendar feed device identity is invalid')
      await accountState(input.accountId)
      const existing = await options.store.listTokens(input.accountId)
      for (const token of existing) {
        if (token.scopes.includes('todos:calendar:read') && token.deviceId.startsWith(`calendar:${input.deviceId}:`))
          await options.store.revokeToken(input.accountId, token.deviceId, now())
      }
      const token = `${calendarTokenPrefix}${randomBytes(32).toString('base64url')}`
      const credential = await options.store.createToken({
        accountId: input.accountId,
        createdAt: now(),
        deviceId: `calendar:${input.deviceId}:${randomUUID()}`,
        deviceName,
        expiresAt: now() + maxTokenLifetimeMs,
        scopes: ['todos:calendar:read'],
        tokenHash: tokenHash(token),
      })
      return { credential, token }
    }),
    revokeCalendarToken: input => attempt(async () => {
      const tokens = await options.store.listTokens(input.accountId)
      let revoked = false
      for (const token of tokens) {
        if (token.scopes.includes('todos:calendar:read') && token.deviceId.startsWith(`calendar:${input.deviceId}:`))
          revoked ||= await options.store.revokeToken(input.accountId, token.deviceId, now())
      }
      return revoked
    }),
    listTokens: accountId => attempt(() => options.store.listTokens(accountId)),
    revokeToken: (accountId, deviceId) => attempt(() => options.store.revokeToken(accountId, deviceId, now())),
    invalidateAccount: (accountId, generation) => {
      for (const key of projectionCache.keys()) {
        if (key.startsWith(`${accountId}:`) && (generation === undefined || key === cacheKey(accountId, generation)))
          projectionCache.delete(key)
      }
    },
    revision: (accountId, generation) => attempt(async () => (await getProjection(accountId, generation)).revision),
    list: input => attempt(async () => {
      if (!validDate(input.date))
        throw new DeviceTodoError('invalid_request', 'Device Todo date must be a valid YYYY-MM-DD date')
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
        throw new DeviceTodoError('invalid_request', 'Device Todo limit must be between 1 and 100')
      const credential = await authorize(input.token, 'todos:read')
      const state = await accountState(credential.accountId)
      const projection = await getProjection(credential.accountId, state.generation)
      const todos = projection.todos.filter(todo => input.view === 'all'
        ? todo.status !== 'done'
        : todo.status !== 'done' && projectedDate(todo) === input.date)
      const selected = todos.slice(0, input.limit)
      const selectedIds = new Set(selected.map(todo => todo.id))
      return {
        generatedAt: new Date(now()).toISOString(),
        items: selected.map(todo => publicTodo(todo, selectedIds)),
        revision: projection.revision,
      }
    }),
    calendar: input => attempt(async () => {
      if (!validDate(input.options.from) || !validDate(input.options.through) || !validDate(input.options.undatedDate) || input.options.through < input.options.from)
        throw new DeviceTodoError('invalid_request', 'Todo calendar feed range is invalid')
      if (!Number.isSafeInteger(input.options.beforeDays) || input.options.beforeDays < 0 || input.options.beforeDays > 3660
        || !Number.isSafeInteger(input.options.afterDays) || input.options.afterDays < 0 || input.options.afterDays > 3660) {
        throw new DeviceTodoError('invalid_request', 'Todo calendar feed bounds are invalid')
      }
      const credential = await authorize(input.token, 'todos:calendar:read', calendarTokenPrefix)
      const state = await accountState(credential.accountId)
      const projection = await getProjection(credential.accountId, state.generation)
      const byId = new Map(projection.todos.map(todo => [todo.id, todo]))
      const sources = new Set<string>()
      for (const todo of projection.todos)
        imageSources(todo.content, sources)
      const managedAssets = sources.size === 0
        ? new Map<string, ManagedAsset>()
        : await loadManagedAssets(options.repository, credential.accountId, state.generation)
      const imageData = new Map<string, string>()
      await Promise.all([...sources].map(async (source) => {
        const value = await inlineManagedImage(
          options.repository,
          options.objectStore,
          managedAssets,
          credential.accountId,
          state.generation,
          source,
        )
        if (value !== undefined)
          imageData.set(source, value)
      }))
      const events: TaskIcsEvent[] = []
      for (const todo of projection.todos) {
        if (input.options.completed === 'hide' && todo.status === 'done')
          continue
        let schedule: TaskSchedule
        try {
          schedule = todo.schedule
        }
        catch {
          continue
        }
        const repeatValue = todo.attributes.repeatRule
        const repeatRule = repeatValue === undefined || repeatValue === null ? null : parseTaskRepeatRule(repeatValue)
        if (repeatValue !== undefined && repeatValue !== null && repeatRule === null)
          continue
        const occurrences = projectTaskOccurrences(schedule, repeatRule, {
          calendarEvents: input.options.calendarEvents,
          from: input.options.from,
          through: input.options.through,
          undatedDate: input.options.undated === 'today' ? input.options.undatedDate : undefined,
        })
        for (const occurrence of occurrences) {
          const parent = todo.parentId === null ? undefined : byId.get(todo.parentId)
          events.push({
            allDay: occurrence.allDay,
            description: `${todo.noteTitle} / ${todo.topicTitle}`,
            descriptionHtml: todoDescriptionHtml(todo, imageData, parent),
            end: occurrence.end,
            parentContext: parent?.text,
            start: occurrence.start,
            summary: todoSummary(todo.text),
            uid: todoOccurrenceUid(todo.id, occurrence.key),
          })
        }
      }
      const body = serializeTodoIcsFeed(events.slice(0, 10_000), {
        calendarName: 'Memorilo Todos',
        generatedAt: '1970-01-01T00:00:00Z',
        timeZone: input.options.timeZone,
      })
      if (Buffer.byteLength(body, 'utf8') > 2_000_000)
        throw new DeviceTodoError('invalid_request', 'Todo calendar feed is too large')
      return { body, revision: projection.revision }
    }),
  }
}
