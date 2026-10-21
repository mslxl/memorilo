import type { SyncAssetManifestRecord, SyncAuditStore, SyncAuthStore, SyncChangeRecord, SyncDeviceCredential, SyncDeviceTodoStore, SyncDeviceTodoToken, SyncInvite, SyncLearningEntityRecord, SyncLearningTombstoneRecord, SyncMutationBatch, SyncNoteSnapshotRecord, SyncPairingSession, SyncRepository, SyncResetJob } from '@memorilo/sync'
import { fileURLToPath } from 'node:url'
import { mergeAuthoritativeNoteSnapshot, validateAssetManifest, validatePolicyTransition } from '@memorilo/sync'
import { and, asc, desc, eq, gt, isNull, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate as migrateDrizzle } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { syncAccounts, syncAssetManifests, syncAuditEvents, syncChanges, syncDeviceCredentials, syncDeviceNonces, syncDeviceTodoTokens, syncInvites, syncLearningEntities, syncLearningTombstones, syncNoteSnapshots, syncObjects, syncPairingSessions, syncResetJobs, syncSessions, syncUsers } from './schema.postgres'
import { accountStateFromRow, compareLearningEntityOrder, deviceTodoTokenFromRow, frontierFromRows, objectMetadataFromRow, payloadHash, resetJobFromRow, restoredSyncPayload, storedSyncPayload } from './shared'

export interface PostgresSyncDatabaseOptions {
  readonly url: string
  readonly now?: () => number
  readonly maximumConnections?: number
  readonly connectTimeoutSeconds?: number
}

export interface PostgresSyncDatabase {
  readonly audit: SyncAuditStore
  readonly auth: SyncAuthStore
  readonly repository: SyncRepository
  readonly deviceTodo: SyncDeviceTodoStore
  readonly migrate: () => Promise<void>
  readonly close: () => Promise<void>
}

export function createPostgresSyncDatabase(options: PostgresSyncDatabaseOptions): PostgresSyncDatabase {
  const client = postgres(options.url, {
    max: options.maximumConnections ?? 10,
    ...(options.connectTimeoutSeconds === undefined ? {} : { connect_timeout: options.connectTimeoutSeconds }),
  })
  const db = drizzle(client)
  const now = options.now ?? Date.now

  const audit: SyncAuditStore = {
    append: async (event) => {
      await db.insert(syncAuditEvents).values(event)
    },
    listForAccount: async (accountId, limit, before) => db.select()
      .from(syncAuditEvents)
      .where(and(
        eq(syncAuditEvents.accountId, accountId),
        before === undefined ? undefined : lt(syncAuditEvents.createdAt, before),
      ))
      .orderBy(desc(syncAuditEvents.createdAt), desc(syncAuditEvents.id))
      .limit(limit),
  }

  const auth: SyncAuthStore = {
    consumeInvite: async (tokenHash, timestamp) => {
      const rows = await db.update(syncInvites).set({ consumedAt: timestamp }).where(and(
        eq(syncInvites.tokenHash, tokenHash),
        gt(syncInvites.expiresAt, timestamp),
        isNull(syncInvites.revokedAt),
        isNull(syncInvites.consumedAt),
      )).returning({ tokenHash: syncInvites.tokenHash })
      return rows.length === 1
    },
    consumePairingSession: async (pairingId, accountId, timestamp) => {
      const rows = await db.update(syncPairingSessions).set({ consumedAt: timestamp }).where(and(
        eq(syncPairingSessions.pairingId, pairingId),
        eq(syncPairingSessions.accountId, accountId),
        gt(syncPairingSessions.expiresAt, timestamp),
        isNull(syncPairingSessions.consumedAt),
      )).returning({ pairingId: syncPairingSessions.pairingId })
      return rows.length === 1
    },
    countAccounts: async () => (await db.select({ accountId: syncUsers.accountId }).from(syncUsers)).length,
    createDeviceCredential: async (input): Promise<SyncDeviceCredential> => {
      return db.transaction(async (transaction) => {
        const existing = (await transaction.select({ credentialHash: syncDeviceCredentials.credentialHash })
          .from(syncDeviceCredentials)
          .where(and(
            eq(syncDeviceCredentials.accountId, input.accountId),
            eq(syncDeviceCredentials.deviceId, input.deviceId),
          ))
          .for('update')
          .limit(1))[0]
        if (existing) {
          await transaction.delete(syncDeviceNonces).where(eq(syncDeviceNonces.credentialHash, existing.credentialHash))
          await transaction.delete(syncDeviceCredentials).where(eq(syncDeviceCredentials.credentialHash, existing.credentialHash))
        }
        const [row] = await transaction.insert(syncDeviceCredentials).values({ ...input, revokedAt: null }).returning()
        if (!row)
          throw new Error('Failed to create device credential')
        return row
      })
    },
    consumeDeviceNonce: async (input) => {
      if (input.expiresAt <= input.createdAt)
        return false
      return db.transaction(async (transaction) => {
        await transaction.delete(syncDeviceNonces).where(lte(syncDeviceNonces.expiresAt, input.createdAt))
        const inserted = await transaction.insert(syncDeviceNonces).values(input).onConflictDoNothing().returning({ nonceHash: syncDeviceNonces.nonceHash })
        return inserted.length === 1
      })
    },
    createInvite: async (input): Promise<SyncInvite> => {
      const [row] = await db.insert(syncInvites).values(input).returning()
      if (!row)
        throw new Error('Failed to create registration invite')
      return row
    },
    createPairingSession: async (input): Promise<SyncPairingSession> => {
      const [row] = await db.insert(syncPairingSessions).values({ ...input, consumedAt: null }).returning()
      if (!row)
        throw new Error('Failed to create pairing session')
      return row
    },
    createSession: async (session) => {
      await db.insert(syncSessions).values(session)
    },
    findAccountById: async accountId => (await db.select().from(syncUsers).where(eq(syncUsers.accountId, accountId)).limit(1))[0] ?? null,
    findAccountByUsername: async username => (await db.select().from(syncUsers).where(eq(syncUsers.username, username)).limit(1))[0] ?? null,
    findDeviceCredential: async credentialHash => (await db.select().from(syncDeviceCredentials).where(eq(syncDeviceCredentials.credentialHash, credentialHash)).limit(1))[0] ?? null,
    findDeviceCredentialByDevice: async (accountId, deviceId) => (await db.select().from(syncDeviceCredentials).where(and(eq(syncDeviceCredentials.accountId, accountId), eq(syncDeviceCredentials.deviceId, deviceId))).limit(1))[0] ?? null,
    findPairingSession: async (pairingId, accountId, timestamp) => (await db.select().from(syncPairingSessions).where(and(
      eq(syncPairingSessions.pairingId, pairingId),
      eq(syncPairingSessions.accountId, accountId),
      gt(syncPairingSessions.expiresAt, timestamp),
      isNull(syncPairingSessions.consumedAt),
    )).limit(1))[0] ?? null,
    getSession: async (tokenHash, timestamp) => {
      const row = (await db.select().from(syncSessions).where(eq(syncSessions.tokenHash, tokenHash)).limit(1))[0]
      if (!row)
        return null
      if (row.expiresAt > timestamp)
        return row
      await db.delete(syncSessions).where(eq(syncSessions.tokenHash, tokenHash))
      return null
    },
    listDeviceCredentials: async accountId => db.select().from(syncDeviceCredentials).where(eq(syncDeviceCredentials.accountId, accountId)).orderBy(asc(syncDeviceCredentials.createdAt), asc(syncDeviceCredentials.deviceId)),
    provisionAccount: async input => db.transaction(async (transaction) => {
      if (input.requireEmpty && (await transaction.select({ accountId: syncUsers.accountId }).from(syncUsers).limit(1)).length > 0)
        throw new Error('Initial setup has already been completed')
      if (input.inviteTokenHash) {
        const invite = (await transaction.select().from(syncInvites).where(eq(syncInvites.tokenHash, input.inviteTokenHash)).for('update').limit(1))[0]
        if (!invite || invite.expiresAt <= input.createdAt || invite.revokedAt !== null || invite.consumedAt !== null)
          throw new Error('Invalid registration invite')
        const consumed = await transaction.update(syncInvites).set({ consumedAt: input.createdAt }).where(and(
          eq(syncInvites.tokenHash, input.inviteTokenHash),
          isNull(syncInvites.consumedAt),
          isNull(syncInvites.revokedAt),
        )).returning({ tokenHash: syncInvites.tokenHash })
        if (consumed.length !== 1)
          throw new Error('Invalid registration invite')
      }
      await transaction.insert(syncAccounts).values({ accountId: input.accountId, enabledModes: input.enabledModes, membershipEpoch: 1 })
      const [account] = await transaction.insert(syncUsers).values({
        accountId: input.accountId,
        createdAt: input.createdAt,
        passwordHash: input.passwordHash,
        username: input.username,
      }).returning()
      if (!account)
        throw new Error('Failed to provision account')
      return account
    }),
    revokeDeviceCredential: async (accountId, credentialHash, revokedAt) => db.transaction(async (transaction) => {
      const credential = (await transaction.select().from(syncDeviceCredentials).where(and(
        eq(syncDeviceCredentials.accountId, accountId),
        eq(syncDeviceCredentials.credentialHash, credentialHash),
      )).for('update').limit(1))[0]
      if (!credential || credential.revokedAt !== null)
        return null
      const revoked = await transaction.update(syncDeviceCredentials).set({ revokedAt }).where(and(
        eq(syncDeviceCredentials.accountId, accountId),
        eq(syncDeviceCredentials.credentialHash, credentialHash),
        isNull(syncDeviceCredentials.revokedAt),
      )).returning({ credentialHash: syncDeviceCredentials.credentialHash })
      if (revoked.length !== 1)
        return null
      await transaction.delete(syncDeviceNonces).where(eq(syncDeviceNonces.credentialHash, credentialHash))
      const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).for('update').limit(1))[0]
      if (!account)
        throw new Error('Sync account does not exist')
      const [updated] = await transaction.update(syncAccounts).set({ membershipEpoch: account.membershipEpoch + 1 }).where(eq(syncAccounts.accountId, accountId)).returning({ membershipEpoch: syncAccounts.membershipEpoch })
      if (!updated)
        throw new Error('Sync account does not exist')
      return updated.membershipEpoch
    }),
    revokeSession: async (tokenHash) => {
      await db.delete(syncSessions).where(eq(syncSessions.tokenHash, tokenHash))
    },
  }

  const repository: SyncRepository = {
    appendAssetManifests: async (accountId, generation, manifests) => {
      const acceptedManifestIds = await db.transaction(async (transaction) => {
        const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).for('update').limit(1))[0]
        if (!account || account.generation !== generation || !account.enabledModes.includes('authoritative'))
          throw new Error('Sync account generation is not writable')
        const accepted: string[] = []
        for (const manifest of manifests) {
          validateAssetManifest(manifest)
          const existingById = (await transaction.select().from(syncAssetManifests).where(and(
            eq(syncAssetManifests.accountId, accountId),
            eq(syncAssetManifests.generation, generation),
            eq(syncAssetManifests.id, manifest.id),
          )).limit(1))[0]
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
            accepted.push(manifest.id)
            continue
          }
          const sequenceConflict = (await transaction.select({ id: syncAssetManifests.id }).from(syncAssetManifests).where(and(
            eq(syncAssetManifests.accountId, accountId),
            eq(syncAssetManifests.generation, generation),
            eq(syncAssetManifests.deviceId, manifest.deviceId),
            eq(syncAssetManifests.sequence, manifest.sequence),
          )).limit(1))[0]
          if (sequenceConflict)
            throw new Error('Sync asset manifest device sequence conflict')
          if (manifest.operation === 'put') {
            const object = (await transaction.select().from(syncObjects).where(and(
              eq(syncObjects.accountId, accountId),
              eq(syncObjects.generation, generation),
              eq(syncObjects.contentHash, manifest.contentHash!),
            )).limit(1))[0]
            if (!object || object.contentLength !== manifest.contentLength || object.contentType !== manifest.contentType)
              throw new Error('Sync asset object must exist before its manifest is committed')
          }
          await transaction.insert(syncAssetManifests).values({ accountId, generation, receivedAt: now(), ...manifest })
          accepted.push(manifest.id)
        }
        return accepted
      })
      return { acceptedManifestIds, frontier: await repository.getAssetFrontier(accountId, generation) }
    },
    appendChanges: async (batch: SyncMutationBatch) => {
      const acceptedChangeIds = await db.transaction(async (transaction) => {
        const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, batch.accountId)).for('update').limit(1))[0]
        if (!account || account.generation !== batch.generation || !account.enabledModes.includes('authoritative'))
          throw new Error('Sync account generation is not writable')
        const accepted: string[] = []
        let nextReceiptSequence = account.nextReceiptSequence
        for (const change of batch.changes) {
          if (!Number.isSafeInteger(change.sequence) || change.sequence <= 0)
            throw new TypeError('Sync change sequence must be a positive safe integer')
          if ((batch.namespace === 'notes' && change.kind !== 'note-update') || (batch.namespace === 'learning' && change.kind !== 'learning-mutation'))
            throw new TypeError('Sync change kind does not match its namespace')
          const hash = payloadHash(change.payload)
          const existingById = (await transaction.select().from(syncChanges).where(and(
            eq(syncChanges.accountId, batch.accountId),
            eq(syncChanges.generation, batch.generation),
            eq(syncChanges.namespace, batch.namespace),
            eq(syncChanges.id, change.id),
          )).limit(1))[0]
          if (existingById) {
            if (existingById.payloadHash !== hash || existingById.deviceId !== change.deviceId || existingById.sequence !== change.sequence || existingById.kind !== change.kind)
              throw new Error('Sync change idempotency conflict')
            accepted.push(change.id)
            continue
          }
          const sequenceConflict = (await transaction.select({ id: syncChanges.id }).from(syncChanges).where(and(
            eq(syncChanges.accountId, batch.accountId),
            eq(syncChanges.generation, batch.generation),
            eq(syncChanges.namespace, batch.namespace),
            eq(syncChanges.deviceId, change.deviceId),
            eq(syncChanges.sequence, change.sequence),
          )).limit(1))[0]
          if (sequenceConflict)
            throw new Error('Sync device sequence conflict')
          await transaction.insert(syncChanges).values({
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
          })
          nextReceiptSequence += 1
          accepted.push(change.id)
        }
        if (nextReceiptSequence !== account.nextReceiptSequence)
          await transaction.update(syncAccounts).set({ nextReceiptSequence }).where(eq(syncAccounts.accountId, batch.accountId))
        return accepted
      })
      return { acceptedChangeIds, frontier: await repository.getFrontier(batch.accountId, batch.namespace, batch.generation) }
    },
    claimResetJob: async (owner, timestamp, leaseDurationMs) => db.transaction(async (transaction) => {
      const job = (await transaction.select().from(syncResetJobs).where(or(
        eq(syncResetJobs.status, 'pending'),
        and(eq(syncResetJobs.status, 'running'), lte(syncResetJobs.leaseExpiresAt, timestamp)),
      )).orderBy(asc(syncResetJobs.createdAt), asc(syncResetJobs.id)).for('update', { skipLocked: true }).limit(1))[0]
      if (!job)
        return null
      const [claimed] = await transaction.update(syncResetJobs).set({
        attempts: job.attempts + 1,
        leaseExpiresAt: timestamp + leaseDurationMs,
        leaseOwner: owner,
        status: 'running',
      }).where(eq(syncResetJobs.id, job.id)).returning()
      return claimed ? resetJobFromRow(claimed) : null
    }),
    clearGeneration: async (accountId, generation) => {
      await db.delete(syncNoteSnapshots).where(and(eq(syncNoteSnapshots.accountId, accountId), eq(syncNoteSnapshots.generation, generation)))
      await db.delete(syncLearningEntities).where(and(eq(syncLearningEntities.accountId, accountId), eq(syncLearningEntities.generation, generation)))
      await db.delete(syncLearningTombstones).where(and(eq(syncLearningTombstones.accountId, accountId), eq(syncLearningTombstones.generation, generation)))
      await db.delete(syncAssetManifests).where(and(eq(syncAssetManifests.accountId, accountId), eq(syncAssetManifests.generation, generation)))
      await db.delete(syncChanges).where(and(eq(syncChanges.accountId, accountId), eq(syncChanges.generation, generation)))
    },
    completeResetJob: async (jobId, owner, completedAt) => {
      const rows = await db.update(syncResetJobs).set({ completedAt, lastError: null, leaseExpiresAt: null, leaseOwner: null, status: 'completed' }).where(and(
        eq(syncResetJobs.id, jobId),
        eq(syncResetJobs.status, 'running'),
        eq(syncResetJobs.leaseOwner, owner),
      )).returning({ id: syncResetJobs.id })
      if (rows.length !== 1)
        throw new Error('Reset job lease was lost')
    },
    createAccount: async (input) => {
      const [row] = await db.insert(syncAccounts).values({ accountId: input.accountId, enabledModes: input.enabledModes, membershipEpoch: 1 }).returning()
      if (!row)
        throw new Error('Failed to create sync account')
      return accountStateFromRow(row)
    },
    deleteObjectMetadata: async (accountId, generation, contentHash) => {
      await db.delete(syncObjects).where(and(eq(syncObjects.accountId, accountId), eq(syncObjects.generation, generation), eq(syncObjects.contentHash, contentHash)))
    },
    getAccountState: async (accountId) => {
      const row = (await db.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).limit(1))[0]
      return row ? accountStateFromRow(row) : null
    },
    listAccountStates: async () => (await db.select().from(syncAccounts).orderBy(asc(syncAccounts.accountId))).map(accountStateFromRow),
    getAssetFrontier: async (accountId, generation) => frontierFromRows(await db.select({
      deviceId: syncAssetManifests.deviceId,
      sequence: syncAssetManifests.sequence,
    }).from(syncAssetManifests).where(and(
      eq(syncAssetManifests.accountId, accountId),
      eq(syncAssetManifests.generation, generation),
    )).orderBy(asc(syncAssetManifests.deviceId), asc(syncAssetManifests.sequence))),
    getFrontier: async (accountId, namespace, generation) => {
      const rows = await db.select({ deviceId: syncChanges.deviceId, sequence: syncChanges.sequence }).from(syncChanges).where(and(eq(syncChanges.accountId, accountId), eq(syncChanges.namespace, namespace), eq(syncChanges.generation, generation))).orderBy(asc(syncChanges.deviceId), asc(syncChanges.sequence))
      return frontierFromRows(rows)
    },
    getNoteSnapshot: async (accountId, generation, noteId) => {
      const row = (await db.select().from(syncNoteSnapshots).where(and(
        eq(syncNoteSnapshots.accountId, accountId),
        eq(syncNoteSnapshots.generation, generation),
        eq(syncNoteSnapshots.noteId, noteId),
      )).limit(1))[0]
      return row === undefined ? null : row as SyncNoteSnapshotRecord
    },
    mergeNoteSnapshot: async (accountId, generation, noteId, update, updatedAt) => db.transaction(async (transaction) => {
      const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).for('update').limit(1))[0]
      if (!account || account.generation !== generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      const current = (await transaction.select().from(syncNoteSnapshots).where(and(
        eq(syncNoteSnapshots.accountId, accountId),
        eq(syncNoteSnapshots.generation, generation),
        eq(syncNoteSnapshots.noteId, noteId),
      )).limit(1))[0]
      const merged = mergeAuthoritativeNoteSnapshot(current?.snapshot ?? null, update)
      const record: SyncNoteSnapshotRecord = {
        accountId,
        generation,
        noteId,
        snapshot: merged.snapshot,
        frontier: merged.frontier,
        updatedAt,
      }
      await transaction.insert(syncNoteSnapshots).values(record).onConflictDoUpdate({
        target: [syncNoteSnapshots.accountId, syncNoteSnapshots.generation, syncNoteSnapshots.noteId],
        set: { frontier: record.frontier, snapshot: record.snapshot, updatedAt: record.updatedAt },
      })
      return record
    }),
    listNoteSnapshots: async (accountId, generation) => await db.select().from(syncNoteSnapshots).where(and(
      eq(syncNoteSnapshots.accountId, accountId),
      eq(syncNoteSnapshots.generation, generation),
    )).orderBy(asc(syncNoteSnapshots.noteId)) as SyncNoteSnapshotRecord[],
    upsertNoteSnapshot: async (record) => {
      const account = (await db.select().from(syncAccounts).where(eq(syncAccounts.accountId, record.accountId)).limit(1))[0]
      if (!account || account.generation !== record.generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      await db.insert(syncNoteSnapshots).values(record).onConflictDoUpdate({
        target: [syncNoteSnapshots.accountId, syncNoteSnapshots.generation, syncNoteSnapshots.noteId],
        set: { frontier: record.frontier, snapshot: record.snapshot, updatedAt: record.updatedAt },
      })
    },
    listLearningEntities: async (accountId, generation) => await db.select().from(syncLearningEntities).where(and(
      eq(syncLearningEntities.accountId, accountId),
      eq(syncLearningEntities.generation, generation),
    )).orderBy(asc(syncLearningEntities.entityId)) as SyncLearningEntityRecord[],
    upsertLearningEntity: async (record) => {
      await db.transaction(async (transaction) => {
        const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, record.accountId)).for('update').limit(1))[0]
        if (!account || account.generation !== record.generation || !account.enabledModes.includes('authoritative'))
          throw new Error('Sync account generation is not writable')
        const existing = (await transaction.select().from(syncLearningEntities).where(and(
          eq(syncLearningEntities.accountId, record.accountId),
          eq(syncLearningEntities.generation, record.generation),
          eq(syncLearningEntities.entityId, record.entityId),
        )).limit(1))[0]
        if (existing !== undefined && compareLearningEntityOrder(existing, record) >= 0)
          return
        await transaction.insert(syncLearningEntities).values(record).onConflictDoUpdate({
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
        })
      })
    },
    listLearningTombstones: async (accountId, generation) => await db.select().from(syncLearningTombstones).where(and(
      eq(syncLearningTombstones.accountId, accountId),
      eq(syncLearningTombstones.generation, generation),
    )).orderBy(asc(syncLearningTombstones.scopeKind), asc(syncLearningTombstones.scopeId)) as SyncLearningTombstoneRecord[],
    upsertLearningTombstone: async (record) => {
      const account = (await db.select().from(syncAccounts).where(eq(syncAccounts.accountId, record.accountId)).limit(1))[0]
      if (!account || account.generation !== record.generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      const existing = (await db.select().from(syncLearningTombstones).where(and(
        eq(syncLearningTombstones.accountId, record.accountId),
        eq(syncLearningTombstones.generation, record.generation),
        eq(syncLearningTombstones.scopeKind, record.scopeKind),
        eq(syncLearningTombstones.scopeId, record.scopeId),
      )).limit(1))[0]
      if (existing && existing.tombstoneGeneration > record.tombstoneGeneration)
        return
      await db.insert(syncLearningTombstones).values(record).onConflictDoUpdate({
        target: [syncLearningTombstones.accountId, syncLearningTombstones.generation, syncLearningTombstones.scopeKind, syncLearningTombstones.scopeId],
        set: { createdAt: record.createdAt, tombstoneGeneration: record.tombstoneGeneration, tombstoneId: record.tombstoneId },
      })
    },
    getObjectMetadata: async (accountId, generation, contentHash) => {
      const row = (await db.select().from(syncObjects).where(and(eq(syncObjects.accountId, accountId), eq(syncObjects.generation, generation), eq(syncObjects.contentHash, contentHash))).limit(1))[0]
      return row ? objectMetadataFromRow(row) : null
    },
    getResetJob: async (accountId, jobId) => {
      const row = (await db.select().from(syncResetJobs).where(and(eq(syncResetJobs.accountId, accountId), eq(syncResetJobs.id, jobId))).limit(1))[0]
      return row ? resetJobFromRow(row) : null
    },
    listResetJobs: async () => (await db.select().from(syncResetJobs).orderBy(asc(syncResetJobs.createdAt))).map(resetJobFromRow),
    listAssetManifests: async (accountId, generation, since, limit) => {
      const rows = await db.select().from(syncAssetManifests).where(and(
        eq(syncAssetManifests.accountId, accountId),
        eq(syncAssetManifests.generation, generation),
      )).orderBy(asc(syncAssetManifests.receivedAt), asc(syncAssetManifests.deviceId), asc(syncAssetManifests.sequence))
      return rows
        .filter(row => row.sequence > (since[row.deviceId] ?? 0))
        .slice(0, limit)
        .map<SyncAssetManifestRecord>(row => ({ ...row }))
    },
    listChanges: async (accountId, namespace, generation, since, limit) => {
      const rows = await db.select().from(syncChanges).where(and(eq(syncChanges.accountId, accountId), eq(syncChanges.namespace, namespace), eq(syncChanges.generation, generation))).orderBy(asc(syncChanges.receiptSequence), asc(syncChanges.deviceId), asc(syncChanges.sequence))
      return rows.filter(row => row.sequence > (since[row.deviceId] ?? 0)).slice(0, limit).map<SyncChangeRecord>(row => ({ ...row, payload: restoredSyncPayload(row.payload), namespace: row.namespace }))
    },
    isObjectReferenced: async (accountId, generation, contentHash) => (await db.select({ id: syncAssetManifests.id }).from(syncAssetManifests).where(and(
      eq(syncAssetManifests.accountId, accountId),
      eq(syncAssetManifests.generation, generation),
      eq(syncAssetManifests.operation, 'put'),
      eq(syncAssetManifests.contentHash, contentHash),
    )).limit(1)).length > 0,
    listObjectMetadata: async (accountId, generation, limit, afterKey) => (await db.select().from(syncObjects).where(and(
      eq(syncObjects.accountId, accountId),
      eq(syncObjects.generation, generation),
      afterKey === undefined ? undefined : gt(syncObjects.key, afterKey),
    )).orderBy(asc(syncObjects.key)).limit(limit)).map(objectMetadataFromRow),
    putObjectMetadata: async metadata => db.transaction(async (transaction) => {
      const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, metadata.accountId)).for('update').limit(1))[0]
      if (!account || account.generation !== metadata.generation || !account.enabledModes.includes('authoritative'))
        throw new Error('Sync account generation is not writable')
      const existing = (await transaction.select().from(syncObjects).where(eq(syncObjects.key, metadata.key)).limit(1))[0]
      if (existing) {
        if (existing.accountId !== metadata.accountId || existing.generation !== metadata.generation || existing.contentHash !== metadata.contentHash || existing.contentLength !== metadata.contentLength || existing.contentType !== metadata.contentType)
          throw new Error('Sync object idempotency conflict')
        return
      }
      await transaction.insert(syncObjects).values(metadata)
    }),
    requestGenerationReset: async (accountId, expectedGeneration, jobId, createdAt) => db.transaction(async (transaction) => {
      const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).for('update').limit(1))[0]
      if (!account)
        throw new Error('Sync account generation changed or does not exist')
      if (account.generation !== expectedGeneration) {
        const existing = (await transaction.select().from(syncResetJobs).where(and(eq(syncResetJobs.accountId, accountId), eq(syncResetJobs.generation, expectedGeneration))).limit(1))[0]
        if (existing && account.generation === expectedGeneration + 1)
          return { generation: account.generation, job: resetJobFromRow(existing) }
        throw new Error('Sync account generation changed or does not exist')
      }
      const [job] = await transaction.insert(syncResetJobs).values({ accountId, createdAt, generation: expectedGeneration, id: jobId, status: 'pending' }).returning()
      if (!job)
        throw new Error('Failed to create reset job')
      const generation = expectedGeneration + 1
      await transaction.update(syncAccounts).set({ generation, membershipEpoch: account.membershipEpoch + 1, nextReceiptSequence: 1 }).where(eq(syncAccounts.accountId, accountId))
      await transaction.update(syncDeviceCredentials)
        .set({ membershipEpoch: account.membershipEpoch + 1 })
        .where(and(
          eq(syncDeviceCredentials.accountId, accountId),
          isNull(syncDeviceCredentials.revokedAt),
        ))
      return { generation, job: resetJobFromRow(job) }
    }),
    retryResetJob: async (jobId, owner, error) => {
      const rows = await db.update(syncResetJobs).set({ lastError: error.slice(0, 4096), leaseExpiresAt: null, leaseOwner: null, status: 'pending' }).where(and(
        eq(syncResetJobs.id, jobId),
        eq(syncResetJobs.status, 'running'),
        eq(syncResetJobs.leaseOwner, owner),
      )).returning({ id: syncResetJobs.id })
      if (rows.length !== 1)
        throw new Error('Reset job lease was lost')
    },
    updateAccountPolicy: async (accountId, update) => db.transaction(async (transaction) => {
      const account = (await transaction.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId)).for('update').limit(1))[0]
      if (!account || account.policyEpoch !== update.expectedPolicyEpoch)
        throw new Error('Sync account policy changed or does not exist')
      validatePolicyTransition(account.enabledModes, update)
      const resetsGeneration = update.transition === 'start-authoritative' || update.transition === 'clear-authoritative'
      let resetJob: SyncResetJob | null = null
      if (resetsGeneration && update.reset) {
        const [job] = await transaction.insert(syncResetJobs).values({
          accountId,
          createdAt: update.reset.createdAt,
          generation: account.generation,
          id: update.reset.jobId,
          status: 'pending',
        }).returning()
        if (!job)
          throw new Error('Failed to create reset job')
        resetJob = resetJobFromRow(job)
      }
      const [updated] = await transaction.update(syncAccounts).set({
        enabledModes: update.enabledModes,
        generation: resetsGeneration ? account.generation + 1 : account.generation,
        membershipEpoch: resetsGeneration ? account.membershipEpoch + 1 : account.membershipEpoch,
        nextReceiptSequence: resetsGeneration ? 1 : account.nextReceiptSequence,
        policyEpoch: update.expectedPolicyEpoch + 1,
      }).where(eq(syncAccounts.accountId, accountId)).returning()
      if (!updated)
        throw new Error('Sync account does not exist')
      if (resetsGeneration) {
        await transaction.update(syncDeviceCredentials)
          .set({ membershipEpoch: account.membershipEpoch + 1 })
          .where(and(
            eq(syncDeviceCredentials.accountId, accountId),
            isNull(syncDeviceCredentials.revokedAt),
          ))
      }
      return { resetJob, state: accountStateFromRow(updated) }
    }),
  }

  const deviceTodo: SyncDeviceTodoStore = {
    createToken: async (input) => {
      const [row] = await db.insert(syncDeviceTodoTokens).values({ ...input, revokedAt: null }).returning()
      if (!row)
        throw new Error('Failed to create device todo token')
      return deviceTodoTokenFromRow(row as SyncDeviceTodoToken)
    },
    findToken: async (tokenHash) => {
      const [row] = await db.select().from(syncDeviceTodoTokens).where(eq(syncDeviceTodoTokens.tokenHash, tokenHash)).limit(1)
      return row === undefined ? null : deviceTodoTokenFromRow(row as SyncDeviceTodoToken)
    },
    listTokens: async accountId => (await db.select().from(syncDeviceTodoTokens).where(eq(syncDeviceTodoTokens.accountId, accountId)).orderBy(asc(syncDeviceTodoTokens.createdAt), asc(syncDeviceTodoTokens.deviceId)))
      .map(row => deviceTodoTokenFromRow(row as SyncDeviceTodoToken)),
    revokeToken: async (accountId, deviceId, revokedAt) => {
      const rows = await db.update(syncDeviceTodoTokens).set({ revokedAt }).where(and(eq(syncDeviceTodoTokens.accountId, accountId), eq(syncDeviceTodoTokens.deviceId, deviceId), isNull(syncDeviceTodoTokens.revokedAt))).returning({ deviceId: syncDeviceTodoTokens.deviceId })
      return rows.length === 1
    },
  }

  return {
    audit,
    auth,
    close: () => client.end(),
    migrate: () => migrateDrizzle(db, { migrationsFolder: fileURLToPath(new URL('./migrations-postgres', import.meta.url)) }),
    repository,
    deviceTodo,
  }
}
