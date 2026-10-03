import type { SyncAuditStore, SyncAuthStore, SyncObjectStore, SyncRepository } from '@memorilo/sync'
import { createHash, randomUUID } from 'node:crypto'
import { toError } from '@memorilo/effect-lifecycle'
import { objectKeyFor } from '@memorilo/sync'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'
import { Effect } from 'effect'
import { expect } from 'vitest'

interface ConformanceDatabase {
  readonly audit: SyncAuditStore
  readonly auth: SyncAuthStore
  readonly close: () => Promise<void> | void
  readonly migrate: () => Promise<void> | void
  readonly repository: SyncRepository
}

export interface StorageConformanceOptions {
  readonly createDatabase: () => ConformanceDatabase | Promise<ConformanceDatabase>
  readonly createObjectStore: () => SyncObjectStore | Promise<SyncObjectStore>
}

async function bytesOf(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of body)
    chunks.push(chunk)
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function withStorage<Result>(
  options: StorageConformanceOptions,
  operation: (database: ConformanceDatabase, objectStore: SyncObjectStore) => Promise<Result>,
): Effect.Effect<Result, Error> {
  return Effect.scoped(Effect.gen(function* () {
    const database = yield* Effect.acquireRelease(
      Effect.tryPromise({ catch: toError, try: async () => options.createDatabase() }),
      current => Effect.tryPromise({ catch: toError, try: async () => current.close() }).pipe(Effect.orDie),
    )
    const objectStore = yield* Effect.acquireRelease(
      Effect.tryPromise({ catch: toError, try: async () => options.createObjectStore() }),
      current => Effect.tryPromise({ catch: toError, try: async () => current.close() }).pipe(Effect.orDie),
    )
    yield* Effect.tryPromise({ catch: toError, try: async () => database.migrate() })
    yield* Effect.tryPromise({ catch: toError, try: objectStore.verify })
    return yield* Effect.tryPromise({ catch: toError, try: () => operation(database, objectStore) })
  }))
}

export async function verifyStorageConformance(options: StorageConformanceOptions): Promise<void> {
  const identity = randomUUID()
  const accountId = `account-${identity}`
  const otherAccountId = `account-other-${identity}`
  const deviceId = `device-${identity}`
  const change = {
    deviceId,
    id: `change-${identity}`,
    kind: 'note-update' as const,
    payload: encodeMemoriloProto('NoteUpdate', { noteId: 'portable', loroUpdate: Uint8Array.from([1]) }),
    sequence: 1,
  }
  const bytes = new TextEncoder().encode(`object-${identity}`)
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const metadata = {
    accountId,
    contentHash,
    contentLength: bytes.byteLength,
    contentType: 'text/plain',
    createdAt: 2,
    generation: 0,
    key: objectKeyFor(accountId, 0, contentHash),
    namespace: 'assets' as const,
  }
  await Effect.runPromise(withStorage(options, async (database, objectStore) => {
    await database.auth.provisionAccount({
      accountId,
      createdAt: 1,
      enabledModes: ['authoritative'],
      passwordHash: 'not-used-by-conformance',
      username: `owner-${identity}`,
    })
    await database.auth.provisionAccount({
      accountId: otherAccountId,
      createdAt: 1,
      enabledModes: ['authoritative'],
      passwordHash: 'not-used-by-conformance',
      username: `other-${identity}`,
    })
    await database.repository.appendChanges({ accountId, changes: [change], generation: 0, namespace: 'notes' })
    await database.repository.appendChanges({ accountId, changes: [change], generation: 0, namespace: 'notes' })
    await expect(database.repository.listChanges(accountId, 'notes', 0, {}, 10)).resolves.toHaveLength(1)
    await expect(database.repository.listChanges(otherAccountId, 'notes', 0, {}, 10)).resolves.toEqual([])

    await objectStore.putImmutable(metadata, (async function* () {
      yield bytes
    })())
    await database.repository.putObjectMetadata(metadata)
    await database.repository.appendAssetManifests(accountId, 0, [{
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: 2,
      deviceId,
      fileName: `${identity}.txt`,
      id: `manifest-${identity}`,
      operation: 'put',
      originalFileName: 'portable.txt',
      sequence: 1,
    }])
    await database.audit.append({
      accountId,
      action: 'conformance.write',
      actorId: accountId,
      actorType: 'system',
      createdAt: 3,
      details: { adapter: 'conformance' },
      id: `audit-${identity}`,
      outcome: 'success',
      remoteAddress: null,
      requestId: `request-${identity}`,
    })
  }))

  await Effect.runPromise(withStorage(options, async (database, objectStore) => {
    await expect(database.repository.listChanges(accountId, 'notes', 0, {}, 10)).resolves.toEqual([
      expect.objectContaining({ id: change.id, payload: change.payload }),
    ])
    const stored = await objectStore.get(accountId, metadata.key)
    expect(stored?.metadata).toMatchObject(metadata)
    if (!stored)
      throw new Error('Conformance object was not durable')
    await expect(bytesOf(stored.body)).resolves.toEqual(bytes)
    await expect(database.audit.listForAccount(accountId, 10)).resolves.toEqual([
      expect.objectContaining({ action: 'conformance.write', accountId }),
    ])
    await expect(database.audit.listForAccount(otherAccountId, 10)).resolves.toEqual([])
  }))
}
