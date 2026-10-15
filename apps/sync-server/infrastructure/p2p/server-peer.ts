import type { PairedDevice, SyncAccountState, SyncAssetManifest, SyncAuthStore, SyncChange, SyncDataNamespace, SyncDeviceCredential, SyncHello, SyncLearningEntityKind, SyncLearningEntityRecord, SyncObjectMetadata, SyncObjectStore, SyncRepository } from '@memorilo/sync'
import type { P2pApplication, SyncObjectPutRequest, SyncObjectTransferStore, SyncStateProvider } from '@memorilo/sync/node'
import type { Server } from 'node:http'
import type { SyncPeerMetricsRecorder } from '../metrics'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { learningMutationRecord, mergeAuthoritativeNoteSnapshot, objectKeyFor } from '@memorilo/sync'

import { decodeMemoriloProto } from '@memorilo/sync-protocol'
import { createP2pApplication, maxDeviceSignatureClockSkewMs, verifySyncHelloSignature, verifySyncObjectRequestSignature } from '@memorilo/sync/node'
import { Effect, Queue, Stream } from 'effect'
import { compareLearningEntityOrder } from '../database/shared'
import { withDatabaseFailureMetrics, withObjectStoreFailureMetrics } from '../metrics'

export interface SyncServerPeerOptions {
  readonly enabledModes?: readonly ('relay' | 'authoritative')[]
  readonly statePath: string
  readonly listenAddress: string
  readonly sharedWebSocketServer?: Server
  readonly auth: SyncAuthStore
  readonly objectStore: SyncObjectStore
  readonly repository: SyncRepository
  readonly readOnly?: boolean
  readonly now?: () => number
  readonly isAccepting?: () => boolean
  readonly maxObjectTransfersPerAccount?: number
  readonly maxSyncSessionsPerAccount?: number
  readonly sessionIdleTimeoutMs?: number
  readonly sessionTotalTimeoutMs?: number
  readonly metrics?: SyncPeerMetricsRecorder
  readonly onAuthoritativeNotesChanged?: (input: {
    readonly accountId: string
    readonly generation: number
    readonly changedAt: number
  }) => Promise<void> | void
}

interface RelayBroker {
  open: (accountId: string, paired: PairedDevice) => RelaySession
  /** Admission rejection must remove the provisional participant; normal release preserves online inbox state. */
  discard: (accountId: string, paired: PairedDevice) => void
  disconnect: (accountId: string, deviceId?: string) => void
  disconnectPeer: (peerId: string) => void
  peers: (accountId: string, excludingDeviceId: string) => readonly PairedDevice[]
  clear: () => void
}

interface RelaySession {
  release: () => void
  publish: (namespace: SyncDataNamespace, changes: readonly SyncChange[]) => void
  publishAssets: (manifests: readonly SyncAssetManifest[]) => void
  pull: (namespace: SyncDataNamespace, since: Readonly<Record<string, number>>) => readonly SyncChange[]
  pullAssets: (since: Readonly<Record<string, number>>) => readonly SyncAssetManifest[]
}

interface RelaySessionState {
  paired: PairedDevice
  activeSessions: number
  readonly assets: Map<string, SyncAssetManifest>
  readonly inboxes: Readonly<Record<SyncDataNamespace, Map<string, SyncChange>>>
  readonly assetOrigins: Map<string, string>
  readonly inboxOrigins: Readonly<Record<SyncDataNamespace, Map<string, string>>>
}

export function createRelayBroker(maxPerSession = 512, metrics?: SyncPeerMetricsRecorder): RelayBroker {
  const accounts = new Map<string, Map<string, RelaySessionState>>()
  const clearState = (state: RelaySessionState): void => {
    state.inboxes.learning.clear()
    state.inboxes.notes.clear()
    state.assets.clear()
    state.inboxOrigins.learning.clear()
    state.inboxOrigins.notes.clear()
    state.assetOrigins.clear()
  }
  const disconnect = (accountId: string, deviceId?: string): void => {
    const participants = accounts.get(accountId)
    if (!participants)
      return
    const removedPeers = new Set([...participants.values()]
      .filter(state => deviceId === undefined || state.paired.deviceId === deviceId)
      .map(state => state.paired.peerId))
    for (const state of participants.values()) {
      for (const namespace of ['notes', 'learning'] as const) {
        for (const [id, origin] of state.inboxOrigins[namespace]) {
          if (removedPeers.has(origin)) {
            state.inboxOrigins[namespace].delete(id)
            state.inboxes[namespace].delete(id)
          }
        }
      }
      for (const [id, origin] of state.assetOrigins) {
        if (removedPeers.has(origin)) {
          state.assetOrigins.delete(id)
          state.assets.delete(id)
        }
      }
    }
    for (const [currentDeviceId, state] of participants) {
      if (deviceId !== undefined && currentDeviceId !== deviceId)
        continue
      clearState(state)
      participants.delete(currentDeviceId)
    }
    if (participants.size === 0)
      accounts.delete(accountId)
  }
  return {
    clear: () => {
      for (const accountId of [...accounts.keys()])
        disconnect(accountId)
    },
    disconnect,
    disconnectPeer: (peerId) => {
      for (const [accountId, participants] of accounts) {
        // A relay entry is valid only while both endpoints are online. Remove
        // entries originating from a peer before dropping that peer's session.
        for (const state of participants.values()) {
          for (const namespace of ['notes', 'learning'] as const) {
            for (const [id, origin] of state.inboxOrigins[namespace]) {
              if (origin === peerId) {
                state.inboxOrigins[namespace].delete(id)
                state.inboxes[namespace].delete(id)
              }
            }
          }
          for (const [id, origin] of state.assetOrigins) {
            if (origin === peerId) {
              state.assetOrigins.delete(id)
              state.assets.delete(id)
            }
          }
        }
        for (const [deviceId, state] of participants) {
          if (state.paired.peerId === peerId)
            disconnect(accountId, deviceId)
        }
      }
    },
    discard: (accountId, paired) => {
      const participants = accounts.get(accountId)
      const current = participants?.get(paired.deviceId)
      if (current?.paired.peerId !== paired.peerId || current.paired.pairingId !== paired.pairingId)
        return
      clearState(current)
      participants?.delete(paired.deviceId)
      if (participants?.size === 0)
        accounts.delete(accountId)
    },
    open: (accountId, paired) => {
      const { deviceId, peerId } = paired
      const participants = accounts.get(accountId) ?? new Map<string, RelaySessionState>()
      const previous = participants.get(deviceId)
      if (previous && previous.paired.peerId !== peerId)
        clearState(previous)
      const state: RelaySessionState = previous !== undefined && previous.paired.peerId === peerId && previous.paired.pairingId === paired.pairingId
        ? previous
        : {
            activeSessions: 0,
            assetOrigins: new Map(),
            assets: new Map(),
            inboxes: { learning: new Map(), notes: new Map() },
            inboxOrigins: { learning: new Map(), notes: new Map() },
            paired,
          }
      state.paired = paired
      state.activeSessions += 1
      participants.set(deviceId, state)
      accounts.set(accountId, participants)
      let released = false
      return {
        release: () => {
          if (released)
            return
          released = true
          if (state.activeSessions > 0)
            state.activeSessions -= 1
          // Relay state follows the authenticated libp2p connection, not an individual
          // sync stream. onPeerDisconnected is the owning boundary that clears it; a
          // stream can finish while the peer remains online and opens another stream.
        },
        publishAssets: (manifests) => {
          for (const destination of participants.values()) {
            if (destination.paired.deviceId === deviceId)
              continue
            for (const manifest of manifests)
              destination.assets.set(manifest.id, manifest)
            for (const manifest of manifests)
              destination.assetOrigins.set(manifest.id, peerId)
            while (destination.assets.size > maxPerSession) {
              const oldest = destination.assets.keys().next().value as string | undefined
              if (oldest === undefined)
                break
              destination.assets.delete(oldest)
              destination.assetOrigins.delete(oldest)
              metrics?.relayDropped()
            }
            metrics?.relayDelivered()
          }
        },
        publish: (namespace, changes) => {
          if (changes.length === 0)
            return
          for (const destination of participants.values()) {
            if (destination.paired.deviceId === deviceId)
              continue
            const inbox = destination.inboxes[namespace]
            for (const change of changes)
              inbox.set(change.id, change)
            for (const change of changes)
              destination.inboxOrigins[namespace].set(change.id, peerId)
            while (inbox.size > maxPerSession) {
              const oldest = inbox.keys().next().value as string | undefined
              if (oldest === undefined)
                break
              inbox.delete(oldest)
              destination.inboxOrigins[namespace].delete(oldest)
              metrics?.relayDropped()
            }
            metrics?.relayDelivered()
          }
        },
        pull: (namespace, since) => {
          const inbox = state.inboxes[namespace]
          for (const [id, change] of inbox) {
            if (change.sequence <= (since[change.deviceId] ?? 0)) {
              state.inboxOrigins[namespace].delete(id)
              inbox.delete(id)
            }
          }
          return [...inbox.values()]
            .filter(change => change.sequence > (since[change.deviceId] ?? 0))
            .slice(0, 256)
        },
        pullAssets: (since) => {
          for (const [id, manifest] of state.assets) {
            if (manifest.sequence <= (since[manifest.deviceId] ?? 0)) {
              state.assetOrigins.delete(id)
              state.assets.delete(id)
            }
          }
          return [...state.assets.values()]
            .filter(manifest => manifest.sequence > (since[manifest.deviceId] ?? 0))
            .slice(0, 256)
        },
      }
    },
    peers: (accountId, excludingDeviceId) => [...(accounts.get(accountId)?.values() ?? [])]
      .filter(participant => participant.paired.deviceId !== excludingDeviceId)
      .map(participant => ({ ...participant.paired })),
  }
}

interface RelayBytePipe {
  readonly body: AsyncIterable<Uint8Array>
  readonly end: () => void
  readonly fail: (error: unknown) => void
  readonly push: (chunk: Uint8Array) => Promise<void>
  readonly stop: () => void
}

export function createRelayBytePipe(): RelayBytePipe {
  let stopped = false
  const queue = Effect.runSync(Queue.bounded<Uint8Array, unknown>(1))
  const stream = Stream.toAsyncIterable(Stream.fromQueue(queue))
  return {
    body: (async function* () {
      try {
        for await (const chunk of stream)
          yield chunk
      }
      catch (error) {
        if (!stopped)
          throw error
      }
    })(),
    end: () => Effect.runSync(Queue.end(queue)),
    fail: error => Effect.runSync(Queue.fail(queue, error)),
    push: async (chunk) => {
      if (stopped)
        return
      try {
        const accepted = await Effect.runPromise(Queue.offer(queue, chunk))
        if (!accepted && !stopped)
          throw new Error('Relay destination closed before transfer completed')
      }
      catch (error) {
        if (!stopped)
          throw error
      }
    },
    stop: () => {
      stopped = true
      Effect.runSync(Queue.shutdown(queue))
    },
  }
}

function credentialHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function replayNonceHash(credentialHashValue: string, nonce: string): string {
  return createHash('sha256').update(credentialHashValue).update('\0').update(nonce).digest('hex')
}

function hasCredentialScope(credential: SyncDeviceCredential, scope: 'sync' | 'object', timestamp: number): boolean {
  return credential.revokedAt === null && credential.expiresAt > timestamp && credential.scopes.includes(scope)
}

async function consumeRequestNonce(
  auth: SyncAuthStore,
  credential: SyncDeviceCredential,
  issuedAt: number,
  nonce: string,
  timestamp: number,
): Promise<boolean> {
  if (Math.abs(timestamp - issuedAt) > maxDeviceSignatureClockSkewMs)
    return false
  return auth.consumeDeviceNonce({
    createdAt: timestamp,
    credentialHash: credential.credentialHash,
    expiresAt: timestamp + maxDeviceSignatureClockSkewMs * 2,
    nonceHash: replayNonceHash(credential.credentialHash, nonce),
  })
}

function pairedDevice(hello: SyncHello, peerId: string, createdAt: number, signingPublicKey: string): PairedDevice {
  return {
    addedAt: createdAt,
    deviceId: hello.deviceId,
    deviceName: hello.deviceName,
    lastSeenAt: createdAt,
    pairingId: hello.pairingId,
    peerId,
    role: 'device',
    sharedSecret: hello.sharedSecret,
    signingPublicKey,
  }
}

function validateAuthoritativePayload(namespace: SyncDataNamespace, change: SyncChange): void {
  let payload: Record<string, unknown>
  try {
    payload = namespace === 'notes'
      ? decodeMemoriloProto('NoteUpdate', change.payload) as Record<string, unknown>
      : learningMutationRecord(change.payload)
  }
  catch {
    throw new Error('sync-payload-invalid')
  }
  if (namespace === 'notes') {
    const noteId = payload.noteId
    const update = payload.loroUpdate
    if (typeof noteId !== 'string' || noteId.length === 0 || !(update instanceof Uint8Array) || update.length === 0)
      throw new Error('sync-note-payload-invalid')
    try {
      mergeAuthoritativeNoteSnapshot(null, Buffer.from(update).toString('base64url'))
    }
    catch {
      throw new Error('sync-note-payload-invalid')
    }
    return
  }
  if (typeof payload.mutationId !== 'string' || typeof payload.entityId !== 'string'
    || typeof payload.entityKind !== 'string' || typeof payload.operation !== 'string') {
    throw new TypeError('sync-learning-payload-invalid')
  }
  const entityKind = payload.entityKind
  const operation = payload.operation
  if (!['assignment', 'card', 'optimizer', 'review-event', 'tombstone'].includes(entityKind)
    || !['upsert', 'delete'].includes(operation)) {
    throw new Error('sync-learning-payload-invalid')
  }
  if (entityKind === 'tombstone' && operation === 'delete') {
    const tombstone = payload.payload as Record<string, unknown>
    if ((tombstone.scopeKind !== 'target' && tombstone.scopeKind !== 'card' && tombstone.scopeKind !== 'optimizer')
      || typeof tombstone.scopeId !== 'string' || tombstone.scopeId.length === 0
      || typeof tombstone.tombstoneId !== 'string' || tombstone.tombstoneId.length === 0
      || !Number.isSafeInteger(tombstone.generation) || (tombstone.generation as number) < 0) {
      throw new Error('sync-learning-payload-invalid')
    }
  }
}

function payloadRecord(change: SyncChange): Record<string, unknown> | null {
  try {
    return change.kind === 'note-update'
      ? decodeMemoriloProto('NoteUpdate', change.payload) as Record<string, unknown>
      : learningMutationRecord(change.payload)
  }
  catch {
    return null
  }
}

async function materializeAuthoritativeChanges(
  repository: SyncRepository,
  accountId: string,
  generation: number,
  changes: readonly SyncChange[],
  now: () => number,
): Promise<void> {
  const existingEntities = new Map((await repository.listLearningEntities(accountId, generation)).map(entity => [entity.entityId, entity]))
  for (const change of changes) {
    const payload = payloadRecord(change)
    if (change.kind === 'note-update') {
      const noteId = typeof payload?.noteId === 'string' ? payload.noteId : null
      const updateBytes = payload?.loroUpdate instanceof Uint8Array ? payload.loroUpdate : null
      const update = updateBytes === null ? null : Buffer.from(updateBytes).toString('base64url')
      if (noteId === null || update === null)
        throw new Error('sync-note-payload-invalid')
      try {
        // Validate before entering the repository so malformed protobuf data is
        // rejected while database failures still abort the session before ACK.
        mergeAuthoritativeNoteSnapshot(null, update)
      }
      catch {
        throw new Error('sync-note-payload-invalid')
      }
      if (repository.mergeNoteSnapshot !== undefined) {
        await repository.mergeNoteSnapshot(accountId, generation, noteId, update, now())
      }
      else {
        const current = await repository.getNoteSnapshot(accountId, generation, noteId)
        const merged = mergeAuthoritativeNoteSnapshot(current?.snapshot ?? null, update)
        await repository.upsertNoteSnapshot({ accountId, generation, noteId, snapshot: merged.snapshot, frontier: merged.frontier, updatedAt: now() })
      }
      continue
    }
    if (payload === null)
      throw new Error('sync-learning-payload-invalid')
    const entityId = typeof payload.entityId === 'string' && payload.entityId.length > 0 ? payload.entityId : change.id
    const entityKind = payload.entityKind
    const operation = payload.operation
    if ((entityKind !== 'assignment' && entityKind !== 'card' && entityKind !== 'optimizer' && entityKind !== 'review-event' && entityKind !== 'tombstone')
      || (operation !== 'upsert' && operation !== 'delete')) {
      throw new Error('sync-learning-payload-invalid')
    }
    const createdAt = Number.isSafeInteger(payload.createdAt) && (payload.createdAt as number) >= 0 ? payload.createdAt as number : now()
    const record: SyncLearningEntityRecord = {
      accountId,
      generation,
      entityId,
      entityKind: entityKind as SyncLearningEntityKind,
      operation,
      mutationId: typeof payload.mutationId === 'string' ? payload.mutationId : change.id,
      sourceDeviceId: change.deviceId,
      sourceSequence: change.sequence,
      payload: JSON.stringify(payload),
      createdAt,
      updatedAt: now(),
    }
    const current = existingEntities.get(entityId)
    if (current !== undefined && compareLearningEntityOrder(current, record) >= 0)
      continue
    await repository.upsertLearningEntity(record)
    existingEntities.set(entityId, record)
    if (entityKind === 'tombstone' && operation === 'delete') {
      const tombstone = payload.payload as Record<string, unknown>
      const scopeKind = tombstone.scopeKind
      const scopeId = tombstone.scopeId
      const tombstoneGeneration = tombstone.generation
      const tombstoneId = tombstone.tombstoneId
      if ((scopeKind === 'target' || scopeKind === 'card' || scopeKind === 'optimizer')
        && typeof scopeId === 'string' && scopeId.length > 0
        && Number.isSafeInteger(tombstoneGeneration) && (tombstoneGeneration as number) >= 0
        && typeof tombstoneId === 'string' && tombstoneId.length > 0) {
        await repository.upsertLearningTombstone({
          accountId,
          generation,
          scopeKind,
          scopeId,
          tombstoneId,
          tombstoneGeneration: tombstoneGeneration as number,
          createdAt,
        })
      }
      else {
        throw new Error('sync-learning-payload-invalid')
      }
    }
  }
}

/** Rebuilds projections after a crash between the durable log commit and projection update. */
export async function rebuildAuthoritativeState(repository: SyncRepository, account: SyncAccountState, now = Date.now): Promise<void> {
  if (!account.enabledModes.includes('authoritative'))
    return
  for (const namespace of ['notes', 'learning'] as const) {
    let since: Record<string, number> = {}
    while (true) {
      const changes = await repository.listChanges(account.accountId, namespace, account.generation, since, 256)
      if (changes.length === 0)
        break
      await materializeAuthoritativeChanges(repository, account.accountId, account.generation, changes, now)
      const next = { ...since }
      for (const change of changes)
        next[change.deviceId] = Math.max(next[change.deviceId] ?? 0, change.sequence)
      if (Object.keys(next).length === Object.keys(since).length
        && Object.entries(next).every(([deviceId, sequence]) => sequence === since[deviceId])) {
        break
      }
      since = next
      if (changes.length < 256)
        break
    }
  }
}

function accountProvider(
  repository: SyncRepository,
  auth: SyncAuthStore,
  objectStore: SyncObjectStore,
  application: () => P2pApplication,
  relay: RelaySession,
  credential: SyncDeviceCredential,
  initialState: SyncAccountState,
  serverEnabledModes: readonly ('relay' | 'authoritative')[],
  readOnly: boolean,
  now: () => number,
  withAccountLock: <Result>(accountId: string, operation: () => Promise<Result>) => Promise<Result>,
  onAuthoritativeNotesChanged?: (input: {
    readonly accountId: string
    readonly generation: number
    readonly changedAt: number
  }) => Promise<void> | void,
  metrics?: SyncPeerMetricsRecorder,
): SyncStateProvider {
  const empty = (): Record<string, number> => ({})
  let state = initialState
  const refreshAuthorization = async (remoteMembershipEpoch?: number): Promise<SyncAccountState> => {
    const [currentCredential, currentState] = await Promise.all([
      auth.findDeviceCredential(credential.credentialHash),
      repository.getAccountState(credential.accountId),
    ])
    if (!currentCredential
      || !hasCredentialScope(currentCredential, 'sync', now())
      || currentCredential.accountId !== credential.accountId
      || currentCredential.deviceId !== credential.deviceId
      || currentCredential.peerId !== credential.peerId
      || currentCredential.membershipEpoch !== currentState?.membershipEpoch) {
      throw new Error('sync-credential-revoked')
    }
    const enabledModes = currentState?.enabledModes.filter(mode => serverEnabledModes.includes(mode)) ?? []
    if (!currentState || enabledModes.length === 0)
      throw new Error('sync-mode-disabled')
    if (remoteMembershipEpoch !== undefined && remoteMembershipEpoch !== currentState.membershipEpoch)
      throw new Error('sync-membership-epoch-stale')
    state = { ...currentState, enabledModes }
    return state
  }
  return {
    applyChanges: async () => undefined,
    applyChangesAsync: async (namespace, changes, _peer, remoteMembershipEpoch) => {
      let current = await refreshAuthorization(remoteMembershipEpoch)
      if (readOnly && changes.length > 0)
        throw new Error('server-read-only')
      if (current.enabledModes.includes('authoritative')) {
        const startedAt = now()
        await withAccountLock(credential.accountId, async () => {
          current = await refreshAuthorization(remoteMembershipEpoch)
          for (const change of changes)
            validateAuthoritativePayload(namespace, change)
          await repository.appendChanges({ accountId: credential.accountId, changes, generation: current.generation, namespace })
          await materializeAuthoritativeChanges(repository, credential.accountId, current.generation, changes, now)
          if (namespace === 'notes' && changes.length > 0)
            await onAuthoritativeNotesChanged?.({ accountId: credential.accountId, generation: current.generation, changedAt: now() })
        })
        metrics?.authoritativeCommit(now() - startedAt)
      }
      if (current.enabledModes.includes('relay'))
        relay.publish(namespace, changes)
    },
    getChanges: async () => [],
    getChangesAsync: async (namespace, since) => {
      const current = await refreshAuthorization()
      const durable = current.enabledModes.includes('authoritative')
        ? await repository.listChanges(credential.accountId, namespace, current.generation, since, 256)
        : []
      const relayed = current.enabledModes.includes('relay')
        ? relay.pull(namespace, since).map(change => ({
            change: wireChange(change),
            receivedAt: now(),
          }))
        : []
      return [
        ...durable.map(change => ({ change: wireChange(change), receivedAt: change.receivedAt })),
        ...relayed,
      ]
        .sort((left, right) => left.receivedAt - right.receivedAt)
        .slice(0, 256)
        .map(entry => entry.change)
    },
    getAssetManifests: async (since) => {
      const current = await refreshAuthorization()
      const durable = current.enabledModes.includes('authoritative')
        ? repository.listAssetManifests(credential.accountId, current.generation, since, 256)
        : []
      const relayed = current.enabledModes.includes('relay') ? relay.pullAssets(since) : []
      return [
        ...(await durable).map(manifest => ({ manifest: wireManifest(manifest), receivedAt: manifest.receivedAt })),
        ...relayed.map(manifest => ({ manifest: wireManifest(manifest), receivedAt: manifest.createdAt })),
      ]
        .sort((left, right) => left.receivedAt - right.receivedAt)
        .slice(0, 256)
        .map(entry => entry.manifest)
    },
    getAssetVersionVector: async () => {
      const current = await refreshAuthorization()
      return current.enabledModes.includes('authoritative')
        ? repository.getAssetFrontier(credential.accountId, current.generation)
        : empty()
    },
    getGeneration: () => state.generation,
    getMembershipEpoch: () => state.membershipEpoch,
    getModes: () => state.enabledModes,
    getPolicyEpoch: () => state.policyEpoch,
    getVersionVector: empty,
    getVersionVectorAsync: async (namespace) => {
      const current = await refreshAuthorization()
      return current.enabledModes.includes('authoritative')
        ? repository.getFrontier(credential.accountId, namespace, current.generation)
        : empty()
    },
    applyAssetManifests: async (manifests, _peer, remoteMembershipEpoch) => {
      const current = await refreshAuthorization(remoteMembershipEpoch)
      if (readOnly && manifests.length > 0)
        throw new Error('server-read-only')
      if (current.enabledModes.includes('authoritative'))
        await repository.appendAssetManifests(credential.accountId, current.generation, manifests)
      if (current.enabledModes.includes('relay'))
        relay.publishAssets(manifests)
    },
    prepareAssetManifestsForPeer: async (manifests, peer) => {
      const current = await refreshAuthorization()
      if (!current.enabledModes.includes('authoritative'))
        return
      for (const manifest of manifests) {
        if (manifest.operation !== 'put' || manifest.contentHash === null)
          continue
        const key = objectKeyFor(credential.accountId, current.generation, manifest.contentHash)
        const object = await objectStore.get(credential.accountId, key)
        if (object === null)
          throw new Error('sync-object-missing')
        await application().putObject(peer.peerId, manifest, object.body, {
          generation: current.generation,
          membershipEpoch: current.membershipEpoch,
          paired: peer,
          policyEpoch: current.policyEpoch,
        })
      }
    },
    validateRemoteHello: async (hello) => {
      const current = await refreshAuthorization()
      if (hello.role !== 'device')
        throw new Error('sync-peer-role-invalid')
      if (hello.generation !== current.generation)
        throw new Error('sync-generation-stale')
      if (hello.membershipEpoch !== current.membershipEpoch)
        throw new Error('sync-membership-epoch-stale')
      if (hello.policyEpoch !== current.policyEpoch)
        throw new Error('sync-policy-epoch-stale')
      if (!hello.modes.some(mode => mode !== 'direct' && current.enabledModes.includes(mode)))
        throw new Error('sync-mode-disabled')
    },
  }
}

function objectMetadata(accountId: string, generation: number, manifest: SyncAssetManifest, createdAt: number): SyncObjectMetadata {
  if (manifest.operation !== 'put' || manifest.contentHash === null || manifest.contentLength === null)
    throw new Error('object-manifest-invalid')
  return {
    accountId,
    contentHash: manifest.contentHash,
    contentLength: manifest.contentLength,
    contentType: manifest.contentType,
    createdAt,
    generation,
    key: objectKeyFor(accountId, generation, manifest.contentHash),
    namespace: 'assets',
  }
}

function wireChange(change: SyncChange): SyncChange {
  return {
    deviceId: change.deviceId,
    id: change.id,
    kind: change.kind,
    payload: change.payload,
    sequence: change.sequence,
  }
}

function wireManifest(manifest: SyncAssetManifest): SyncAssetManifest {
  return {
    contentHash: manifest.contentHash,
    contentLength: manifest.contentLength,
    contentType: manifest.contentType,
    createdAt: manifest.createdAt,
    deviceId: manifest.deviceId,
    fileName: manifest.fileName,
    id: manifest.id,
    operation: manifest.operation,
    originalFileName: manifest.originalFileName,
    sequence: manifest.sequence,
  }
}

export interface SyncServerPeer {
  readonly application: P2pApplication
  /** The concrete listen addresses are needed by local integration tests and front-door wiring. */
  readonly multiaddrs: readonly unknown[]
  readonly closeAccountSessions: (accountId: string) => Promise<void>
  readonly closeDeviceSessions: (accountId: string, deviceId: string) => Promise<void>
  readonly drain: () => Promise<void>
  readonly metrics: () => { readonly activeObjectTransfers: number, readonly activeSyncSessions: number }
  readonly close: () => Promise<void>
}

export async function createSyncServerPeer(options: SyncServerPeerOptions): Promise<SyncServerPeer> {
  const now = options.now ?? Date.now
  const serverEnabledModes = options.enabledModes ?? ['relay', 'authoritative']
  const auth = withDatabaseFailureMetrics(options.auth, options.metrics)
  const repository = withDatabaseFailureMetrics(options.repository, options.metrics)
  const objectStore = withObjectStoreFailureMetrics(options.objectStore, options.metrics)
  const relay = createRelayBroker(512, options.metrics)
  const sessions = new Map<string, Map<string, { readonly deviceId: string, readonly peerId: string, readonly close: () => Promise<void>, readonly closed: Promise<void> }>>()
  const objectTransfers = new Map<string, number>()
  const accountLocks = new Map<string, Promise<void>>()
  const withAccountLock = async <Result>(accountId: string, operation: () => Promise<Result>): Promise<Result> => {
    const previous = accountLocks.get(accountId) ?? Promise.resolve()
    const running = previous.catch(() => undefined).then(operation)
    const tail = running.then(() => undefined, () => undefined)
    accountLocks.set(accountId, tail)
    try {
      return await running
    }
    finally {
      if (accountLocks.get(accountId) === tail)
        accountLocks.delete(accountId)
    }
  }
  let application: P2pApplication | undefined
  const getApplication = (): P2pApplication => {
    if (application === undefined)
      throw new Error('Sync server peer is not ready')
    return application
  }
  const closeSessions = async (accountId: string, deviceId?: string): Promise<void> => {
    relay.disconnect(accountId, deviceId)
    const accountSessions = sessions.get(accountId)
    if (accountSessions === undefined)
      return
    const selected = [...accountSessions.entries()].filter(([, session]) => deviceId === undefined || session.deviceId === deviceId)
    await Promise.allSettled(selected.map(async ([sessionId, session]) => {
      accountSessions.delete(sessionId)
      await session.close()
      await session.closed
    }))
    if (accountSessions.size === 0)
      sessions.delete(accountId)
  }
  const drain = async (): Promise<void> => {
    await Promise.all([...sessions.keys()].map(accountId => closeSessions(accountId)))
    relay.clear()
  }
  const authorizeObject = async (peerId: string, request: SyncObjectPutRequest): Promise<{
    readonly paired: PairedDevice
    readonly store: SyncObjectTransferStore
  } | null> => {
    if (options.isAccepting?.() === false)
      return null
    if (request.credential === undefined)
      return null
    const credential = await auth.findDeviceCredential(credentialHash(request.credential))
    const timestamp = now()
    if (!credential
      || !hasCredentialScope(credential, 'object', timestamp)
      || credential.peerId !== peerId
      || credential.deviceId !== request.deviceId
      || credential.pairingId !== request.pairingId
      || credential.sharedSecretHash !== credentialHash(request.sharedSecret)
      || !verifySyncObjectRequestSignature(request, credential.signingPublicKey)) {
      return null
    }
    const state = await repository.getAccountState(credential.accountId)
    const enabledModes = state?.enabledModes.filter(mode => serverEnabledModes.includes(mode)) ?? []
    if (!state
      || enabledModes.length === 0
      || state.generation !== request.generation
      || state.membershipEpoch !== request.membershipEpoch
      || credential.membershipEpoch !== state.membershipEpoch
      || state.policyEpoch !== request.policyEpoch) {
      return null
    }
    if (!await consumeRequestNonce(auth, credential, request.issuedAt, request.nonce, timestamp))
      return null
    const metadata = objectMetadata(credential.accountId, state.generation, request.manifest, now())
    const revalidate = async (requiredMode?: 'relay' | 'authoritative'): Promise<void> => {
      const [currentCredential, currentState] = await Promise.all([
        auth.findDeviceCredential(credential.credentialHash),
        repository.getAccountState(credential.accountId),
      ])
      const currentEnabledModes = currentState?.enabledModes.filter(mode => serverEnabledModes.includes(mode)) ?? []
      if (!currentCredential
        || !hasCredentialScope(currentCredential, 'object', now())
        || currentCredential.peerId !== peerId
        || currentCredential.deviceId !== request.deviceId
        || currentCredential.pairingId !== request.pairingId
        || currentCredential.membershipEpoch !== currentState?.membershipEpoch
        || !currentState
        || currentEnabledModes.length === 0
        || (requiredMode !== undefined && !currentEnabledModes.includes(requiredMode))
        || currentState.generation !== request.generation
        || currentState.membershipEpoch !== request.membershipEpoch
        || currentState.policyEpoch !== request.policyEpoch) {
        throw new Error('object-authorization-stale')
      }
    }
    return {
      paired: {
        addedAt: credential.createdAt,
        deviceId: credential.deviceId,
        deviceName: credential.deviceName,
        lastSeenAt: now(),
        pairingId: credential.pairingId,
        peerId: credential.peerId,
        role: 'device',
        sharedSecret: request.sharedSecret,
        signingPublicKey: credential.signingPublicKey,
      },
      store: {
        has: async () => {
          if (!enabledModes.includes('authoritative'))
            return false
          await revalidate('authoritative')
          const registered = await repository.getObjectMetadata(credential.accountId, state.generation, metadata.contentHash)
          if (registered === null)
            return false
          const stored = await objectStore.head(credential.accountId, metadata.key)
          if (stored === null)
            throw new Error('object-integrity-missing')
          return true
        },
        put: async (manifest, body) => {
          if (options.readOnly)
            throw new Error('server-read-only')
          const activeTransfers = objectTransfers.get(credential.accountId) ?? 0
          if (activeTransfers >= (options.maxObjectTransfersPerAccount ?? 4)) {
            options.metrics?.quotaRejected()
            throw new Error('rate-limited')
          }
          objectTransfers.set(credential.accountId, activeTransfers + 1)
          if (enabledModes.includes('relay'))
            await revalidate('relay')
          const destinations = enabledModes.includes('relay')
            ? relay.peers(credential.accountId, credential.deviceId)
                .filter(destination => destination.peerId !== peerId)
            : []
          const pipes = destinations.map(() => createRelayBytePipe())
          const transfers = destinations.map((destination, index) => {
            const pipe = pipes[index]!
            return getApplication().putObject(
              destination.peerId,
              manifest,
              pipe.body,
              {
                generation: state.generation,
                membershipEpoch: state.membershipEpoch,
                paired: destination,
                policyEpoch: state.policyEpoch,
              },
            ).then(() => {
              options.metrics?.relayDelivered()
              pipe.stop()
            }).catch((error) => {
              options.metrics?.relayFailed()
              pipe.fail(error)
              throw error
            })
          })
          if (enabledModes.includes('authoritative')) {
            const persistentPipe = createRelayBytePipe()
            pipes.push(persistentPipe)
            transfers.push((async () => {
              await objectStore.putImmutable(metadata, persistentPipe.body)
              await revalidate('authoritative')
              await repository.putObjectMetadata(metadata)
            })().then(() => persistentPipe.stop()).catch((error) => {
              persistentPipe.fail(error)
              throw error
            }))
          }
          const hash = createHash('sha256')
          let received = 0
          try {
            for await (const chunk of body) {
              received += chunk.byteLength
              hash.update(chunk)
              await Promise.all(pipes.map(pipe => pipe.push(chunk)))
            }
            if (received !== metadata.contentLength || hash.digest('hex') !== metadata.contentHash)
              throw new Error('object-integrity-invalid')
            for (const pipe of pipes)
              pipe.end()
            await Promise.all(transfers)
            await revalidate()
          }
          catch (error) {
            for (const pipe of pipes)
              pipe.fail(error)
            await Promise.allSettled(transfers)
            throw error
          }
          finally {
            const remaining = (objectTransfers.get(credential.accountId) ?? 1) - 1
            if (remaining <= 0)
              objectTransfers.delete(credential.accountId)
            else
              objectTransfers.set(credential.accountId, remaining)
          }
        },
      },
    }
  }
  application = await createP2pApplication({
    authorizeIncomingObject: authorizeObject,
    deviceName: 'Memorilo Sync Server',
    discovery: false,
    listenAddresses: [options.listenAddress],
    sharedWebSocketServer: options.sharedWebSocketServer,
    now,
    onStatus: (status) => {
      if (status.state === 'error')
        console.warn('Memorilo sync server peer failed', status.error)
    },
    onPeerDisconnected: peerId => relay.disconnectPeer(peerId),
    persistCompletedPairings: false,
    provider: undefined,
    role: 'server',
    statePath: options.statePath,
    sessionIdleTimeoutMs: options.sessionIdleTimeoutMs,
    sessionTotalTimeoutMs: options.sessionTotalTimeoutMs,
    transport: 'websocket',
    authorizeIncomingSync: async (peerId, hello, session) => {
      if (options.isAccepting?.() === false)
        return null
      const credentialValue = hello.credential
      const credential = credentialValue === undefined ? null : await auth.findDeviceCredential(credentialHash(credentialValue))
      const timestamp = now()
      if (!credential
        || credential.peerId !== peerId
        || credential.deviceId !== hello.deviceId
        || credential.pairingId !== hello.pairingId
        || credential.sharedSecretHash !== credentialHash(hello.sharedSecret)
        || !verifySyncHelloSignature(hello, credential.signingPublicKey)) {
        return null
      }
      if (!hasCredentialScope(credential, 'sync', timestamp))
        throw new Error('sync-credential-revoked')
      const state = await repository.getAccountState(credential.accountId)
      if (!state)
        throw new Error('sync-credential-revoked')
      const enabledModes = state.enabledModes.filter(mode => serverEnabledModes.includes(mode))
      if (hello.role !== 'device'
        || !hello.namespaces.includes('notes')
        || !hello.namespaces.includes('learning')) {
        throw new Error('sync-protocol-invalid')
      }
      if (credential.membershipEpoch !== state.membershipEpoch)
        throw new Error('sync-membership-epoch-stale')
      if (enabledModes.length === 0)
        throw new Error('sync-mode-disabled')
      if (!await consumeRequestNonce(auth, credential, hello.issuedAt, hello.nonce, timestamp))
        throw new Error('sync-protocol-invalid')
      const authenticatedPeer = pairedDevice(hello, peerId, now(), credential.signingPublicKey)
      const sessionId = randomUUID()
      const accountSessions = sessions.get(credential.accountId) ?? new Map()
      if (accountSessions.size >= (options.maxSyncSessionsPerAccount ?? 8)) {
        options.metrics?.quotaRejected()
        return null
      }
      const relaySession = relay.open(credential.accountId, authenticatedPeer)
      accountSessions.set(sessionId, { close: session.close, closed: session.closed, deviceId: credential.deviceId, peerId })
      sessions.set(credential.accountId, accountSessions)
      return {
        onClose: () => {
          relaySession.release()
          const current = sessions.get(credential.accountId)
          current?.delete(sessionId)
          if (current?.size === 0)
            sessions.delete(credential.accountId)
        },
        paired: authenticatedPeer,
        provider: accountProvider(
          repository,
          auth,
          objectStore,
          getApplication,
          relaySession,
          credential,
          { ...state, enabledModes },
          serverEnabledModes,
          options.readOnly ?? false,
          now,
          withAccountLock,
          options.onAuthoritativeNotesChanged,
          options.metrics,
        ),
      }
    },
  })
  return {
    application,
    close: async () => {
      await drain()
      await application.close()
    },
    closeAccountSessions: accountId => closeSessions(accountId),
    closeDeviceSessions: (accountId, deviceId) => closeSessions(accountId, deviceId),
    drain,
    metrics: () => ({
      activeObjectTransfers: [...objectTransfers.values()].reduce((total, count) => total + count, 0),
      activeSyncSessions: [...sessions.values()].reduce((total, accountSessions) => total + accountSessions.size, 0),
    }),
    multiaddrs: application.multiaddrs(),
  }
}

export function hashDeviceCredential(value: string): string {
  if (value.length < 16)
    throw new TypeError('Device credential is too short')
  return credentialHash(value)
}

export function hashPairingSharedSecret(value: string): string {
  if (value.length < 16)
    throw new TypeError('Pairing shared secret is too short')
  return credentialHash(value)
}

export function newDeviceCredential(): string {
  return randomUUID() + randomUUID()
}
