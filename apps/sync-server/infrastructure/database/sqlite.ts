import type { SyncAssetManifestRecord, SyncAuditStore, SyncAuthStore, SyncChangeRecord, SyncDeviceCredential, SyncDeviceTodoStore, SyncDeviceTodoToken, SyncInvite, SyncLearningEntityRecord, SyncLearningTombstoneRecord, SyncMutationBatch, SyncNoteSnapshotRecord, SyncPairingSession, SyncRepository, SyncResetJob } from '@memorilo/sync'
import type Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { mergeAuthoritativeNoteSnapshot, validateAssetManifest, validatePolicyTransition } from '@memorilo/sync'
import BetterSqlite3 from 'better-sqlite3'
import { and, asc, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator'
import { syncAccounts, syncAssetManifests, syncAuditEvents, syncChanges, syncDeviceCredentials, syncDeviceNonces, syncDeviceTodoTokens, syncInvites, syncLearningEntities, syncLearningTombstones, syncNoteSnapshots, syncObjects, syncPairingSessions, syncResetJobs, syncSessions, syncUsers } from './schema'
import { accountStateFromRow, compareLearningEntityOrder, deviceTodoTokenFromRow, frontierFromRows, objectMetadataFromRow, payloadHash, resetJobFromRow, restoredSyncPayload, storedSyncPayload } from './shared'

export interface SqliteSyncDatabaseOptions {
  readonly filename: string
  readonly now?: () => number
}

export interface SqliteSyncDatabase {
  readonly audit: SyncAuditStore
  readonly database: Database.Database
  readonly auth: SyncAuthStore
  readonly provisionAccount: SyncAuthStore['provisionAccount']
  readonly repository: SyncRepository
  readonly deviceTodo: SyncDeviceTodoStore
  readonly migrate: () => void
  readonly close: () => void
}

export function createSqliteSyncDatabase(options: SqliteSyncDatabaseOptions): SqliteSyncDatabase {
  const database = new BetterSqlite3(options.filename)
  const db = drizzle(database)
  const now = options.now ?? Date.now

  const audit: SyncAuditStore = {
    append: async (event) => {
      db.insert(syncAuditEvents).values(event).run()
    },
    listForAccount: async (accountId, limit, before) => db.select()
      .from(syncAuditEvents)
      .where(and(
        eq(syncAuditEvents.accountId, accountId),
        before === undefined ? undefined : lt(syncAuditEvents.createdAt, before),
      ))
      .orderBy(desc(syncAuditEvents.createdAt), desc(syncAuditEvents.id))
      .limit(limit)
      .all(),
  }

  function migrate(): void {
    database.pragma('journal_mode = WAL')
    migrateDrizzle(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) })
  }

  const provisionAccount: SyncAuthStore['provisionAccount'] = async (input) => {
    db.transaction((transaction) => {
      if (input.requireEmpty && transaction.select({ accountId: syncUsers.accountId }).from(syncUsers).limit(1).get())
        throw new Error('Initial setup has already been completed')
      if (input.inviteTokenHash) {
        const invite = transaction.select({
          consumedAt: syncInvites.consumedAt,
          expiresAt: syncInvites.expiresAt,
          revokedAt: syncInvites.revokedAt,
        }).from(syncInvites).where(eq(syncInvites.tokenHash, input.inviteTokenHash)).get()
        if (!invite || invite.expiresAt <= input.createdAt || invite.revokedAt !== null || invite.consumedAt !== null)
          throw new Error('Invalid registration invite')
      }
      transaction.insert(syncAccounts).values({
        accountId: input.accountId,
        enabledModes: input.enabledModes,
        membershipEpoch: 1,
      }).run()
      transaction.insert(syncUsers).values({
        accountId: input.accountId,
        createdAt: input.createdAt,
        passwordHash: input.passwordHash,
        username: input.username,
      }).run()
      if (input.inviteTokenHash) {
        const consumed = transaction.update(syncInvites)
          .set({ consumedAt: input.createdAt })
          .where(and(
            eq(syncInvites.tokenHash, input.inviteTokenHash),
            isNull(syncInvites.consumedAt),
            isNull(syncInvites.revokedAt),
          ))
          .run()
        if (consumed.changes !== 1)
          throw new Error('Invalid registration invite')
      }
    })
    return {
      accountId: input.accountId,
      createdAt: input.createdAt,
      passwordHash: input.passwordHash,
      username: input.username,
    }
  }

  const auth: SyncAuthStore = {
    countAccounts: async () => db.select({ accountId: syncUsers.accountId }).from(syncUsers).all().length,
    provisionAccount,
    createSession: async (session) => {
      db.insert(syncSessions).values(session).run()
    },
    findAccountByUsername: async (username) => {
      const row = db.select().from(syncUsers).where(eq(syncUsers.username, username)).get()
      return row ?? null
    },
    createDeviceCredential: async (input): Promise<SyncDeviceCredential> => {
      return db.transaction((transaction) => {
        const existing = transaction.select({ credentialHash: syncDeviceCredentials.credentialHash })
          .from(syncDeviceCredentials)
          .where(and(
            eq(syncDeviceCredentials.accountId, input.accountId),
            eq(syncDeviceCredentials.deviceId, input.deviceId),
          ))
          .get()
        if (existing) {
          transaction.delete(syncDeviceNonces).where(eq(syncDeviceNonces.credentialHash, existing.credentialHash)).run()
          transaction.delete(syncDeviceCredentials).where(eq(syncDeviceCredentials.credentialHash, existing.credentialHash)).run()
        }
        transaction.insert(syncDeviceCredentials).values({ ...input, revokedAt: null }).run()
        return { ...input, revokedAt: null }
      })
    },
    consumeDeviceNonce: async (input) => {
      if (input.expiresAt <= input.createdAt)
        return false
      return db.transaction((transaction) => {
        transaction.delete(syncDeviceNonces).where(lte(syncDeviceNonces.expiresAt, input.createdAt)).run()
        const inserted = transaction.insert(syncDeviceNonces).values(input).onConflictDoNothing().run()
        return inserted.changes === 1
      })
    },
    findDeviceCredential: async (credentialHash) => {
      const row = db.select().from(syncDeviceCredentials).where(eq(syncDeviceCredentials.credentialHash, credentialHash)).get()
      return row ?? null
    },
    findDeviceCredentialByDevice: async (accountId, deviceId) => {
      const row = db.select().from(syncDeviceCredentials).where(and(eq(syncDeviceCredentials.accountId, accountId), eq(syncDeviceCredentials.deviceId, deviceId))).get()
      return row ?? null
    },
    listDeviceCredentials: async accountId => db.select()
      .from(syncDeviceCredentials)
      .where(eq(syncDeviceCredentials.accountId, accountId))
      .orderBy(asc(syncDeviceCredentials.createdAt), asc(syncDeviceCredentials.deviceId))
      .all(),
    revokeDeviceCredential: async (accountId, credentialHash, revokedAt) => db.transaction((transaction) => {
      const credential = transaction.select({ revokedAt: syncDeviceCredentials.revokedAt })
        .from(syncDeviceCredentials)
        .where(and(
          eq(syncDeviceCredentials.accountId, accountId),
          eq(syncDeviceCredentials.credentialHash, credentialHash),
        ))
        .get()
      if (!credential || credential.revokedAt !== null)
        return null
      const revoked = transaction.update(syncDeviceCredentials)
        .set({ revokedAt })
        .where(and(
          eq(syncDeviceCredentials.accountId, accountId),
          eq(syncDeviceCredentials.credentialHash, credentialHash),
          isNull(syncDeviceCredentials.revokedAt),
        ))
        .run()
      if (revoked.changes !== 1)
        return null
      transaction.delete(syncDeviceNonces).where(eq(syncDeviceNonces.credentialHash, credentialHash)).run()
      const advanced = transaction.update(syncAccounts)
        .set({ membershipEpoch: sql`${syncAccounts.membershipEpoch} + 1` })
        .where(eq(syncAccounts.accountId, accountId))
        .run()
      if (advanced.changes !== 1)
        throw new Error('Sync account does not exist')
      const account = transaction.select({ membershipEpoch: syncAccounts.membershipEpoch })
        .from(syncAccounts)
        .where(eq(syncAccounts.accountId, accountId))
        .get()
      if (!account)
        throw new Error('Sync account does not exist')
      return account.membershipEpoch
    }),
    createPairingSession: async (input): Promise<SyncPairingSession> => {
      db.insert(syncPairingSessions).values({ ...input, consumedAt: null }).run()
      return { ...input, consumedAt: null }
    },
    findPairingSession: async (pairingId, accountId, timestamp) => {
      const row = db.select().from(syncPairingSessions).where(and(eq(syncPairingSessions.pairingId, pairingId), eq(syncPairingSessions.accountId, accountId), isNull(syncPairingSessions.consumedAt))).get()
      if (!row || row.expiresAt <= timestamp)
        return null
      return row
    },
    consumePairingSession: async (pairingId, accountId, timestamp) => {
      const result = db.update(syncPairingSessions)
        .set({ consumedAt: timestamp })
        .where(and(eq(syncPairingSessions.pairingId, pairingId), eq(syncPairingSessions.accountId, accountId), isNull(syncPairingSessions.consumedAt)))
        .run()
      if (result.changes !== 1)
        return false
      const row = db.select({ expiresAt: syncPairingSessions.expiresAt }).from(syncPairingSessions).where(eq(syncPairingSessions.pairingId, pairingId)).get()
      if (!row || row.expiresAt <= timestamp) {
        db.update(syncPairingSessions).set({ consumedAt: null }).where(eq(syncPairingSessions.pairingId, pairingId)).run()
        return false
      }
      return true
    },
    createInvite: async (input): Promise<SyncInvite> => {
      db.insert(syncInvites).values(input).run()
      return { ...input, revokedAt: null, consumedAt: null }
    },
    consumeInvite: async (tokenHash, timestamp) => {
      const result = db.update(syncInvites)
        .set({ consumedAt: timestamp })
        .where(and(eq(syncInvites.tokenHash, tokenHash), isNull(syncInvites.revokedAt), isNull(syncInvites.consumedAt)))
        .run()
      if (result.changes !== 1)
        return false
      const row = db.select({ expiresAt: syncInvites.expiresAt }).from(syncInvites).where(eq(syncInvites.tokenHash, tokenHash)).get()
      if (!row || row.expiresAt <= timestamp) {
        db.update(syncInvites).set({ consumedAt: null }).where(eq(syncInvites.tokenHash, tokenHash)).run()
        return false
      }
      return true
    },
    findAccountById: async (accountId) => {
      const row = db.select().from(syncUsers).where(eq(syncUsers.accountId, accountId)).get()
      return row ?? null
    },
    getSession: async (tokenHash, timestamp) => {
      const row = db.select().from(syncSessions).where(eq(syncSessions.tokenHash, tokenHash)).get()
      if (!row || row.expiresAt <= timestamp) {
        if (row)
          db.delete(syncSessions).where(eq(syncSessions.tokenHash, tokenHash)).run()
        return null
      }
      return row
    },
    revokeSession: async (tokenHash) => {
      db.delete(syncSessions).where(eq(syncSessions.tokenHash, tokenHash)).run()
    },
  }

  const repository: SyncRepository = {
    appendAssetManifests: async (accountId, generation, manifests) => {
      const acceptedManifestIds: string[] = []
      db.transaction((transaction) => {
        const account = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).get()
        if (!account || account.generation !== generation || !account.enabledModes.includes('authoritative'))
          throw new Error('Sync account generation is not writable')
        for (const manifest of manifests) {
          validateAssetManifest(manifest)
          const existingById = transaction.select().from(syncAssetManifests).where(and(
            eq(syncAssetManifests.accountId, accountId),
            eq(syncAssetManifests.generation, generation),
            eq(syncAssetManifests.id, manifest.id),
          )).get()
          if (existingById) {
            if (existingById.deviceId !== manifest.deviceId
              || existingById.sequence !== manifest.sequence
              || existingById.fileName !== manifest.fileName
              || existingById.operation !== manifest.operation
              || existingById.contentHash !== manifest.contentHash
              || existingById.contentLength !== manifest.contentLength
              || existingById.contentType !== manifest.contentType
              || existingById.createdAt !== manifest.createdAt) {
              throw new Error('Sync asset manifest idempotency conflict')
            }
            acceptedManifestIds.push(manifest.id)
            continue
          }
          const sequenceConflict = transaction.select({ id: syncAssetManifests.id }).from(syncAssetManifests).where(and(
            eq(syncAssetManifests.accountId, accountId),
            eq(syncAssetManifests.generation, generation),
            eq(syncAssetManifests.deviceId, manifest.deviceId),
            eq(syncAssetManifests.sequence, manifest.sequence),
          )).get()
          if (sequenceConflict)
            throw new Error('Sync asset manifest device sequence conflict')
          if (manifest.operation === 'put') {
            const object = transaction.select().from(syncObjects).where(and(
              eq(syncObjects.accountId, accountId),
              eq(syncObjects.generation, generation),
              eq(syncObjects.contentHash, manifest.contentHash!),
            )).get()
            if (!object || object.contentLength !== manifest.contentLength || object.contentType !== manifest.contentType)
              throw new Error('Sync asset object must exist before its manifest is committed')
          }
          transaction.insert(syncAssetManifests).values({ accountId, generation, receivedAt: now(), ...manifest }).run()
          acceptedManifestIds.push(manifest.id)
        }
      })
      return {
        acceptedManifestIds,
        frontier: await repository.getAssetFrontier(accountId, generation),
      }
    },
    appendChanges: async (batch: SyncMutationBatch) => {
      const acceptedChangeIds: string[] = []
      db.transaction((transaction) => {
        const account = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, batch.accountId)).get()
        if (!account || account.generation !== batch.generation || !account.enabledModes.includes('authoritative'))
          throw new Error('Sync account generation is not writable')
        let nextReceiptSequence = account.nextReceiptSequence
        for (const change of batch.changes) {
          if (change.sequence <= 0 || !Number.isSafeInteger(change.sequence))
            throw new TypeError('Sync change sequence must be a positive safe integer')
          if ((batch.namespace === 'notes' && change.kind !== 'note-update') || (batch.namespace === 'learning' && change.kind !== 'learning-mutation'))
            throw new TypeError('Sync change kind does not match its namespace')
          const hash = payloadHash(change.payload)
          const existingById = transaction.select().from(syncChanges).where(and(
            eq(syncChanges.accountId, batch.accountId),
            eq(syncChanges.generation, batch.generation),
            eq(syncChanges.namespace, batch.namespace),
            eq(syncChanges.id, change.id),
          )).get()
          if (existingById) {
            if (existingById.payloadHash !== hash
              || existingById.deviceId !== change.deviceId
              || existingById.sequence !== change.sequence
              || existingById.kind !== change.kind) {
              throw new Error('Sync change idempotency conflict')
            }
            acceptedChangeIds.push(change.id)
            continue
          }
          const existingBySequence = transaction.select({ id: syncChanges.id, payloadHash: syncChanges.payloadHash }).from(syncChanges).where(and(
            eq(syncChanges.accountId, batch.accountId),
            eq(syncChanges.generation, batch.generation),
            eq(syncChanges.namespace, batch.namespace),
            eq(syncChanges.deviceId, change.deviceId),
            eq(syncChanges.sequence, change.sequence),
          )).get()
          if (existingBySequence)
            throw new Error('Sync device sequence conflict')
          transaction.insert(syncChanges).values({
            accountId: batch.accountId,
            deviceId: change.deviceId,
            generation: batch.generation,
            id: change.id,
            kind: change.kind,
            namespace: batch.namespace,
            payload: storedSyncPayload(change.payload),
            payloadHash: hash,
            receiptSequence: nextReceiptSequence,
            receivedAt: now(),
            sequence: change.sequence,
          }).run()
          nextReceiptSequence += 1
          acceptedChangeIds.push(change.id)
        }
        if (nextReceiptSequence !== account.nextReceiptSequence) {
          transaction.update(syncAccounts)
            .set({ nextReceiptSequence })
            .where(eq(syncAccounts.accountId, batch.accountId))
            .run()
        }
      })
      return {
        acceptedChangeIds,
        frontier: await repository.getFrontier(batch.accountId, batch.namespace, batch.generation),
      }
    },
    updateAccountPolicy: async (accountId, update) => db.transaction((transaction) => {
      const account = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).get()
      if (!account || account.policyEpoch !== update.expectedPolicyEpoch)
        throw new Error('Sync account policy changed or does not exist')
      validatePolicyTransition(account.enabledModes, update)
      const resetsGeneration = update.transition === 'start-authoritative' || update.transition === 'clear-authoritative'
      let resetJob: SyncResetJob | null = null
      if (resetsGeneration && update.reset) {
        const job: typeof syncResetJobs.$inferInsert = {
          accountId,
          attempts: 0,
          completedAt: null,
          createdAt: update.reset.createdAt,
          generation: account.generation,
          id: update.reset.jobId,
          lastError: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          status: 'pending',
        }
        transaction.insert(syncResetJobs).values(job).run()
        resetJob = resetJobFromRow(job as typeof syncResetJobs.$inferSelect)
      }
      transaction.update(syncAccounts).set({
        enabledModes: update.enabledModes,
        generation: resetsGeneration ? account.generation + 1 : account.generation,
        membershipEpoch: resetsGeneration ? account.membershipEpoch + 1 : account.membershipEpoch,
        nextReceiptSequence: resetsGeneration ? 1 : account.nextReceiptSequence,
        policyEpoch: update.expectedPolicyEpoch + 1,
      }).where(eq(syncAccounts.accountId, accountId)).run()
      if (resetsGeneration) {
        transaction.update(syncDeviceCredentials)
          .set({ membershipEpoch: account.membershipEpoch + 1 })
          .where(and(
            eq(syncDeviceCredentials.accountId, accountId),
            isNull(syncDeviceCredentials.revokedAt),
          ))
          .run()
      }
      const row = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).get()
      if (!row)
        throw new Error('Sync account does not exist')
      return { resetJob, state: accountStateFromRow(row) }
    }),
    clearGeneration: async (accountId, generation) => {
      db.delete(syncNoteSnapshots)
        .where(and(eq(syncNoteSnapshots.accountId, accountId), eq(syncNoteSnapshots.generation, generation)))
        .run()
      db.delete(syncLearningEntities)
        .where(and(eq(syncLearningEntities.accountId, accountId), eq(syncLearningEntities.generation, generation)))
        .run()
      db.delete(syncLearningTombstones)
        .where(and(eq(syncLearningTombstones.accountId, accountId), eq(syncLearningTombstones.generation, generation)))
        .run()
      db.delete(syncAssetManifests)
        .where(and(eq(syncAssetManifests.accountId, accountId), eq(syncAssetManifests.generation, generation)))
        .run()
      db.delete(syncChanges)
        .where(and(eq(syncChanges.accountId, accountId), eq(syncChanges.generation, generation)))
        .run()
    },
    claimResetJob: async (owner, timestamp, leaseDurationMs) => db.transaction((transaction) => {
      const job = transaction.select().from(syncResetJobs).where(or(
        eq(syncResetJobs.status, 'pending'),
        and(eq(syncResetJobs.status, 'running'), lte(syncResetJobs.leaseExpiresAt, timestamp)),
      )).orderBy(asc(syncResetJobs.createdAt), asc(syncResetJobs.id)).limit(1).get()
      if (!job)
        return null
      transaction.update(syncResetJobs).set({
        attempts: job.attempts + 1,
        leaseExpiresAt: timestamp + leaseDurationMs,
        leaseOwner: owner,
        status: 'running',
      }).where(eq(syncResetJobs.id, job.id)).run()
      return resetJobFromRow({
        ...job,
        attempts: job.attempts + 1,
        leaseExpiresAt: timestamp + leaseDurationMs,
        leaseOwner: owner,
        status: 'running',
      })
    }),
    completeResetJob: async (jobId, owner, completedAt) => {
      const result = db.update(syncResetJobs).set({
        completedAt,
        lastError: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        status: 'completed',
      }).where(and(eq(syncResetJobs.id, jobId), eq(syncResetJobs.status, 'running'), eq(syncResetJobs.leaseOwner, owner))).run()
      if (result.changes !== 1)
        throw new Error('Reset job lease was lost')
    },
    createAccount: async (input) => {
      const row: typeof syncAccounts.$inferInsert = {
        accountId: input.accountId,
        enabledModes: input.enabledModes,
        membershipEpoch: 1,
      }
      db.insert(syncAccounts).values(row).run()
      return {
        accountId: input.accountId,
        enabledModes: input.enabledModes,
        generation: 0,
        membershipEpoch: 1,
        policyEpoch: 0,
      }
    },
    getAccountState: async (accountId) => {
      const row = db.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).get()
      return row ? accountStateFromRow(row) : null
    },
    listAccountStates: async () => db.select().from(syncAccounts).orderBy(asc(syncAccounts.accountId)).all().map(accountStateFromRow),
    getAssetFrontier: async (accountId, generation) => frontierFromRows(db.select({
      deviceId: syncAssetManifests.deviceId,
      sequence: syncAssetManifests.sequence,
    }).from(syncAssetManifests).where(and(
      eq(syncAssetManifests.accountId, accountId),
      eq(syncAssetManifests.generation, generation),
    )).orderBy(asc(syncAssetManifests.deviceId), asc(syncAssetManifests.sequence)).all()),
    deleteObjectMetadata: async (accountId, generation, contentHash) => {
      db.delete(syncObjects).where(and(
        eq(syncObjects.accountId, accountId),
        eq(syncObjects.generation, generation),
        eq(syncObjects.contentHash, contentHash),
      )).run()
    },
    getFrontier: async (accountId, namespace, generation) => {
      const rows = db.select({ deviceId: syncChanges.deviceId, sequence: syncChanges.sequence })
        .from(syncChanges)
        .where(and(eq(syncChanges.accountId, accountId), eq(syncChanges.namespace, namespace), eq(syncChanges.generation, generation)))
        .orderBy(asc(syncChanges.deviceId), asc(syncChanges.sequence))
        .all()
      return frontierFromRows(rows)
    },
    getNoteSnapshot: async (accountId, generation, noteId) => {
      const row = db.select().from(syncNoteSnapshots).where(and(
        eq(syncNoteSnapshots.accountId, accountId),
        eq(syncNoteSnapshots.generation, generation),
        eq(syncNoteSnapshots.noteId, noteId),
      )).get()
      return row === undefined ? null : row as SyncNoteSnapshotRecord
    },
    mergeNoteSnapshot: async (accountId, generation, noteId, update, updatedAt) => db.transaction((transaction) => {
      const account = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).get()
      if (!account || account.generation !== generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      const current = transaction.select().from(syncNoteSnapshots).where(and(
        eq(syncNoteSnapshots.accountId, accountId),
        eq(syncNoteSnapshots.generation, generation),
        eq(syncNoteSnapshots.noteId, noteId),
      )).get()
      const merged = mergeAuthoritativeNoteSnapshot(current?.snapshot ?? null, update)
      const record: SyncNoteSnapshotRecord = {
        accountId,
        generation,
        noteId,
        snapshot: merged.snapshot,
        frontier: merged.frontier,
        updatedAt,
      }
      transaction.insert(syncNoteSnapshots).values(record).onConflictDoUpdate({
        target: [syncNoteSnapshots.accountId, syncNoteSnapshots.generation, syncNoteSnapshots.noteId],
        set: { frontier: record.frontier, snapshot: record.snapshot, updatedAt: record.updatedAt },
      }).run()
      return record
    }),
    listNoteSnapshots: async (accountId, generation) => db.select().from(syncNoteSnapshots).where(and(
      eq(syncNoteSnapshots.accountId, accountId),
      eq(syncNoteSnapshots.generation, generation),
    )).orderBy(asc(syncNoteSnapshots.noteId)).all() as SyncNoteSnapshotRecord[],
    upsertNoteSnapshot: async (record) => {
      const account = db.select().from(syncAccounts).where(eq(syncAccounts.accountId, record.accountId)).get()
      if (!account || account.generation !== record.generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      db.insert(syncNoteSnapshots).values(record).onConflictDoUpdate({
        target: [syncNoteSnapshots.accountId, syncNoteSnapshots.generation, syncNoteSnapshots.noteId],
        set: { frontier: record.frontier, snapshot: record.snapshot, updatedAt: record.updatedAt },
      }).run()
    },
    listLearningEntities: async (accountId, generation) => db.select().from(syncLearningEntities).where(and(
      eq(syncLearningEntities.accountId, accountId),
      eq(syncLearningEntities.generation, generation),
    )).orderBy(asc(syncLearningEntities.entityId)).all() as SyncLearningEntityRecord[],
    upsertLearningEntity: async (record) => {
      db.transaction((transaction) => {
        const account = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, record.accountId)).get()
        if (!account || account.generation !== record.generation || !account.enabledModes.includes('authoritative'))
          throw new Error('Sync account generation is not writable')
        const existing = transaction.select().from(syncLearningEntities).where(and(
          eq(syncLearningEntities.accountId, record.accountId),
          eq(syncLearningEntities.generation, record.generation),
          eq(syncLearningEntities.entityId, record.entityId),
        )).get()
        if (existing !== undefined && compareLearningEntityOrder(existing, record) >= 0)
          return
        transaction.insert(syncLearningEntities).values(record).onConflictDoUpdate({
          target: [syncLearningEntities.accountId, syncLearningEntities.generation, syncLearningEntities.entityId],
          set: {
            createdAt: record.createdAt,
            entityKind: record.entityKind,
            mutationId: record.mutationId,
            operation: record.operation,
            payload: record.payload,
            sourceDeviceId: record.sourceDeviceId,
            sourceSequence: record.sourceSequence,
            updatedAt: record.updatedAt,
          },
        }).run()
      })
    },
    listLearningTombstones: async (accountId, generation) => db.select().from(syncLearningTombstones).where(and(
      eq(syncLearningTombstones.accountId, accountId),
      eq(syncLearningTombstones.generation, generation),
    )).orderBy(asc(syncLearningTombstones.scopeKind), asc(syncLearningTombstones.scopeId)).all() as SyncLearningTombstoneRecord[],
    upsertLearningTombstone: async (record) => {
      const account = db.select().from(syncAccounts).where(eq(syncAccounts.accountId, record.accountId)).get()
      if (!account || account.generation !== record.generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      const existing = db.select().from(syncLearningTombstones).where(and(
        eq(syncLearningTombstones.accountId, record.accountId),
        eq(syncLearningTombstones.generation, record.generation),
        eq(syncLearningTombstones.scopeKind, record.scopeKind),
        eq(syncLearningTombstones.scopeId, record.scopeId),
      )).get()
      if (existing && existing.tombstoneGeneration > record.tombstoneGeneration)
        return
      db.insert(syncLearningTombstones).values(record).onConflictDoUpdate({
        target: [syncLearningTombstones.accountId, syncLearningTombstones.generation, syncLearningTombstones.scopeKind, syncLearningTombstones.scopeId],
        set: { createdAt: record.createdAt, tombstoneGeneration: record.tombstoneGeneration, tombstoneId: record.tombstoneId },
      }).run()
    },
    listChanges: async (accountId, namespace, generation, since, limit) => {
      const rows = db.select().from(syncChanges).where(and(eq(syncChanges.accountId, accountId), eq(syncChanges.namespace, namespace), eq(syncChanges.generation, generation))).orderBy(asc(syncChanges.receiptSequence), asc(syncChanges.deviceId), asc(syncChanges.sequence)).all()
      return rows.filter(row => row.sequence > (since[row.deviceId] ?? 0)).slice(0, limit).map<SyncChangeRecord>(row => ({
        accountId: row.accountId,
        deviceId: row.deviceId,
        generation: row.generation,
        id: row.id,
        kind: row.kind,
        namespace: row.namespace,
        payload: restoredSyncPayload(row.payload),
        payloadHash: row.payloadHash,
        receivedAt: row.receivedAt,
        receiptSequence: row.receiptSequence,
        sequence: row.sequence,
      }))
    },
    getObjectMetadata: async (accountId, generation, contentHash) => {
      const row = db.select().from(syncObjects).where(and(
        eq(syncObjects.accountId, accountId),
        eq(syncObjects.generation, generation),
        eq(syncObjects.contentHash, contentHash),
      )).get()
      return row ? objectMetadataFromRow(row) : null
    },
    getResetJob: async (accountId, jobId) => {
      const row = db.select().from(syncResetJobs).where(and(eq(syncResetJobs.accountId, accountId), eq(syncResetJobs.id, jobId))).get()
      return row ? resetJobFromRow(row) : null
    },
    listResetJobs: async () => db.select().from(syncResetJobs).orderBy(asc(syncResetJobs.createdAt)).all().map(resetJobFromRow),
    listAssetManifests: async (accountId, generation, since, limit) => {
      const rows = db.select().from(syncAssetManifests).where(and(
        eq(syncAssetManifests.accountId, accountId),
        eq(syncAssetManifests.generation, generation),
      )).orderBy(asc(syncAssetManifests.receivedAt), asc(syncAssetManifests.deviceId), asc(syncAssetManifests.sequence)).all()
      return rows
        .filter(row => row.sequence > (since[row.deviceId] ?? 0))
        .slice(0, limit)
        .map<SyncAssetManifestRecord>(row => ({ ...row }))
    },
    isObjectReferenced: async (accountId, generation, contentHash) => db.select({ id: syncAssetManifests.id }).from(syncAssetManifests).where(and(
      eq(syncAssetManifests.accountId, accountId),
      eq(syncAssetManifests.generation, generation),
      eq(syncAssetManifests.operation, 'put'),
      eq(syncAssetManifests.contentHash, contentHash),
    )).limit(1).get() !== undefined,
    listObjectMetadata: async (accountId, generation, limit, afterKey) => db.select().from(syncObjects).where(and(
      eq(syncObjects.accountId, accountId),
      eq(syncObjects.generation, generation),
      afterKey === undefined ? undefined : gt(syncObjects.key, afterKey),
    )).orderBy(asc(syncObjects.key)).limit(limit).all().map(objectMetadataFromRow),
    putObjectMetadata: async (metadata) => {
      const account = db.select({ enabledModes: syncAccounts.enabledModes, generation: syncAccounts.generation }).from(syncAccounts).where(eq(syncAccounts.accountId, metadata.accountId)).get()
      if (!account || account.generation !== metadata.generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      const existing = db.select().from(syncObjects).where(eq(syncObjects.key, metadata.key)).get()
      if (existing) {
        if (existing.accountId !== metadata.accountId
          || existing.generation !== metadata.generation
          || existing.contentHash !== metadata.contentHash
          || existing.contentLength !== metadata.contentLength
          || existing.contentType !== metadata.contentType) {
          throw new Error('Sync object idempotency conflict')
        }
        return
      }
      db.insert(syncObjects).values(metadata).run()
    },
    requestGenerationReset: async (accountId, expectedGeneration, jobId, createdAt) => db.transaction((transaction) => {
      const account = transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).get()
      if (!account)
        throw new Error('Sync account generation changed or does not exist')
      if (account.generation !== expectedGeneration) {
        const existing = transaction.select().from(syncResetJobs).where(and(
          eq(syncResetJobs.accountId, accountId),
          eq(syncResetJobs.generation, expectedGeneration),
        )).get()
        if (existing && account.generation === expectedGeneration + 1)
          return { generation: account.generation, job: resetJobFromRow(existing) }
        throw new Error('Sync account generation changed or does not exist')
      }
      const job: typeof syncResetJobs.$inferInsert = {
        accountId,
        attempts: 0,
        completedAt: null,
        createdAt,
        generation: expectedGeneration,
        id: jobId,
        lastError: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        status: 'pending',
      }
      transaction.insert(syncResetJobs).values(job).run()
      const generation = expectedGeneration + 1
      transaction.update(syncAccounts).set({
        generation,
        membershipEpoch: account.membershipEpoch + 1,
        nextReceiptSequence: 1,
      }).where(eq(syncAccounts.accountId, accountId)).run()
      transaction.update(syncDeviceCredentials)
        .set({ membershipEpoch: account.membershipEpoch + 1 })
        .where(and(
          eq(syncDeviceCredentials.accountId, accountId),
          isNull(syncDeviceCredentials.revokedAt),
        ))
        .run()
      return {
        generation,
        job: {
          accountId,
          attempts: 0,
          completedAt: null,
          createdAt,
          generation: expectedGeneration,
          id: jobId,
          lastError: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          status: 'pending',
        },
      }
    }),
    retryResetJob: async (jobId, owner, error) => {
      const result = db.update(syncResetJobs).set({
        lastError: error.slice(0, 4096),
        leaseExpiresAt: null,
        leaseOwner: null,
        status: 'pending',
      }).where(and(eq(syncResetJobs.id, jobId), eq(syncResetJobs.status, 'running'), eq(syncResetJobs.leaseOwner, owner))).run()
      if (result.changes !== 1)
        throw new Error('Reset job lease was lost')
    },
  }

  const deviceTodo: SyncDeviceTodoStore = {
    createToken: async (input) => {
      const row: typeof syncDeviceTodoTokens.$inferInsert = { ...input, revokedAt: null }
      db.insert(syncDeviceTodoTokens).values(row).run()
      return deviceTodoTokenFromRow(row as SyncDeviceTodoToken)
    },
    findToken: async (tokenHash) => {
      const row = db.select().from(syncDeviceTodoTokens).where(eq(syncDeviceTodoTokens.tokenHash, tokenHash)).get()
      return row === undefined ? null : deviceTodoTokenFromRow(row as SyncDeviceTodoToken)
    },
    listTokens: async accountId => db.select().from(syncDeviceTodoTokens).where(eq(syncDeviceTodoTokens.accountId, accountId)).orderBy(asc(syncDeviceTodoTokens.createdAt), asc(syncDeviceTodoTokens.deviceId)).all().map(row => deviceTodoTokenFromRow(row as SyncDeviceTodoToken)),
    revokeToken: async (accountId, deviceId, revokedAt) => {
      const result = db.update(syncDeviceTodoTokens).set({ revokedAt }).where(and(eq(syncDeviceTodoTokens.accountId, accountId), eq(syncDeviceTodoTokens.deviceId, deviceId), isNull(syncDeviceTodoTokens.revokedAt))).run()
      return result.changes === 1
    },
  }

  return {
    audit,
    close: () => database.close(),
    auth,
    provisionAccount,
    database,
    migrate,
    repository,
    deviceTodo,
  }
}
