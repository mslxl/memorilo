import type { SyncAssetManifest, SyncObjectMetadata, SyncObjectStore } from '@memorilo/sync'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { objectKeyFor } from '@memorilo/sync'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { createFilesystemObjectStore } from '../infrastructure/object-store/filesystem'
import { createResetWorker } from './reset-worker'

describe('sync reset worker', () => {
  async function withFixture<Result>(use: (fixture: {
    readonly database: ReturnType<typeof createSqliteSyncDatabase>
    readonly objectStore: ReturnType<typeof createFilesystemObjectStore>
  }) => Promise<Result>): Promise<Result> {
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), 'memorilo-reset-worker-test-')),
          catch: error => error instanceof Error ? error : new Error(String(error)),
        }),
        path => Effect.promise(() => rm(path, { force: true, recursive: true })),
      )
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })),
        current => Effect.sync(current.close),
      )
      yield* Effect.sync(database.migrate)
      const objectStore = yield* Effect.acquireRelease(
        Effect.sync(() => createFilesystemObjectStore({ root: join(directory, 'objects') })),
        current => Effect.promise(() => Promise.resolve(current.close())),
      )
      yield* Effect.promise(() => database.repository.createAccount({ accountId: 'account-1', enabledModes: ['authoritative'] }))
      return yield* Effect.promise(() => use({ database, objectStore }))
    })))
  }

  async function seedGeneration(
    database: ReturnType<typeof createSqliteSyncDatabase>,
    objectStore: ReturnType<typeof createFilesystemObjectStore>,
  ): Promise<{ readonly metadata: SyncObjectMetadata, readonly manifest: SyncAssetManifest }> {
    const bytes = new TextEncoder().encode('reset me')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const metadata: SyncObjectMetadata = {
      accountId: 'account-1',
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: 10,
      generation: 0,
      key: objectKeyFor('account-1', 0, contentHash),
      namespace: 'assets',
    }
    await objectStore.putImmutable(metadata, (async function* () {
      yield bytes
    })())
    await database.repository.putObjectMetadata(metadata)
    const manifest: SyncAssetManifest = {
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: 10,
      deviceId: 'device-1',
      fileName: 'reset.txt',
      id: 'reset-manifest',
      operation: 'put',
      originalFileName: 'reset.txt',
      sequence: 1,
    }
    await database.repository.appendAssetManifests('account-1', 0, [manifest])
    await database.repository.appendChanges({
      accountId: 'account-1',
      changes: [{ deviceId: 'device-1', id: 'reset-change', kind: 'note-update', payload: new Uint8Array([0x0A, 0x01, 0x6E, 0x12, 0x01, 0x01]), sequence: 1 }],
      generation: 0,
      namespace: 'notes',
    })
    return { manifest, metadata }
  }

  it('retries a failed cleanup and completes idempotently after restart', async () => {
    await withFixture(async ({ database, objectStore }) => {
      const seeded = await seedGeneration(database, objectStore)
      await database.repository.requestGenerationReset('account-1', 0, 'reset-job', 20)
      let failed = false
      const flakyStore: SyncObjectStore = {
        ...objectStore,
        delete: async (accountId, key) => {
          if (!failed) {
            failed = true
            throw new Error('injected object delete failure')
          }
          await objectStore.delete(accountId, key)
        },
      }
      const worker = createResetWorker({
        intervalMs: 60 * 60 * 1_000,
        leaseDurationMs: 1_000,
        now: () => 100,
        objectStore: flakyStore,
        repository: database.repository,
      })
      try {
        await worker.runNow()
        await expect(database.repository.getResetJob('account-1', 'reset-job')).resolves.toMatchObject({
          lastError: 'injected object delete failure',
          status: 'pending',
        })
      }
      finally {
        await worker.close()
      }

      const restarted = createResetWorker({
        intervalMs: 60 * 60 * 1_000,
        leaseDurationMs: 1_000,
        now: () => 200,
        objectStore,
        repository: database.repository,
      })
      try {
        await restarted.runNow()
        await restarted.runNow()
      }
      finally {
        await restarted.close()
      }

      await expect(database.repository.getResetJob('account-1', 'reset-job')).resolves.toMatchObject({ status: 'completed' })
      await expect(database.repository.getAccountState('account-1')).resolves.toMatchObject({ generation: 1 })
      await expect(database.repository.listChanges('account-1', 'notes', 0, {}, 10)).resolves.toEqual([])
      await expect(database.repository.listAssetManifests('account-1', 0, {}, 10)).resolves.toEqual([])
      await expect(database.repository.getObjectMetadata('account-1', 0, seeded.metadata.contentHash)).resolves.toBeNull()
      await expect(objectStore.head('account-1', seeded.metadata.key)).resolves.toBeNull()
    })
  })

  it('allows a second owner to claim a reset job after the first lease expires', async () => {
    await withFixture(async ({ database, objectStore }) => {
      await database.repository.requestGenerationReset('account-1', 0, 'lease-job', 10)
      await expect(database.repository.claimResetJob('owner-a', 100, 50)).resolves.toMatchObject({
        attempts: 1,
        leaseOwner: 'owner-a',
        status: 'running',
      })
      await expect(database.repository.claimResetJob('owner-b', 120, 50)).resolves.toBeNull()
      await expect(database.repository.claimResetJob('owner-b', 151, 50)).resolves.toMatchObject({
        attempts: 2,
        leaseOwner: 'owner-b',
        status: 'running',
      })
      await expect(database.repository.completeResetJob('lease-job', 'owner-a', 200)).rejects.toThrow('lease was lost')
      await expect(database.repository.retryResetJob('lease-job', 'owner-b', 'test retry')).resolves.toBeUndefined()
      await expect(database.repository.getResetJob('account-1', 'lease-job')).resolves.toMatchObject({ status: 'pending' })
      await objectStore.close()
    })
  })
})
