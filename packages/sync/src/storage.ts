import type { SyncAssetManifest, SyncChange, VersionVector } from './model'

export type SyncNamespace = 'notes' | 'learning' | 'assets'

export interface SyncAccountState {
  readonly accountId: string
  readonly generation: number
  readonly membershipEpoch: number
  readonly policyEpoch: number
  readonly enabledModes: readonly ('relay' | 'authoritative')[]
}

export interface SyncChangeRecord extends SyncChange {
  readonly accountId: string
  readonly namespace: Exclude<SyncNamespace, 'assets'>
  readonly generation: number
  readonly payloadHash: string
  readonly receiptSequence: number
  readonly receivedAt: number
}

export interface SyncObjectMetadata {
  readonly accountId: string
  readonly generation: number
  readonly namespace: 'assets'
  readonly key: string
  readonly contentHash: string
  readonly contentLength: number
  readonly contentType: string | null
  readonly createdAt: number
}

export interface SyncAssetManifestRecord extends SyncAssetManifest {
  readonly accountId: string
  readonly generation: number
  readonly receivedAt: number
}

export interface SyncNoteSnapshotRecord {
  readonly accountId: string
  readonly generation: number
  readonly noteId: string
  readonly snapshot: string
  readonly frontier: VersionVector
  readonly updatedAt: number
}

export type SyncDeviceTodoScope = 'todos:read' | 'todos:calendar:read'

export interface SyncDeviceTodoToken {
  readonly tokenHash: string
  readonly accountId: string
  readonly deviceId: string
  readonly deviceName: string
  readonly scopes: readonly SyncDeviceTodoScope[]
  readonly createdAt: number
  readonly expiresAt: number
  readonly revokedAt: number | null
}

export interface SyncDeviceTodoStore {
  readonly createToken: (input: Omit<SyncDeviceTodoToken, 'revokedAt'>) => Promise<SyncDeviceTodoToken>
  readonly findToken: (tokenHash: string) => Promise<SyncDeviceTodoToken | null>
  readonly listTokens: (accountId: string) => Promise<readonly SyncDeviceTodoToken[]>
  readonly revokeToken: (accountId: string, deviceId: string, revokedAt: number) => Promise<boolean>
}

export type SyncLearningEntityKind = 'assignment' | 'card' | 'optimizer' | 'review-event' | 'tombstone'
export type SyncLearningMutationOperation = 'upsert' | 'delete'

export interface SyncLearningEntityRecord {
  readonly accountId: string
  readonly generation: number
  readonly entityId: string
  readonly entityKind: SyncLearningEntityKind
  readonly operation: SyncLearningMutationOperation
  readonly mutationId: string
  readonly sourceDeviceId: string
  readonly sourceSequence: number
  readonly payload: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SyncLearningTombstoneRecord {
  readonly accountId: string
  readonly generation: number
  readonly scopeKind: 'target' | 'card' | 'optimizer'
  readonly scopeId: string
  readonly tombstoneId: string
  readonly tombstoneGeneration: number
  readonly createdAt: number
}

export interface SyncResetJob {
  readonly id: string
  readonly accountId: string
  readonly generation: number
  readonly status: 'pending' | 'running' | 'completed'
  readonly attempts: number
  readonly leaseOwner: string | null
  readonly leaseExpiresAt: number | null
  readonly lastError: string | null
  readonly createdAt: number
  readonly completedAt: number | null
}

export interface SyncMutationBatch {
  readonly accountId: string
  readonly generation: number
  readonly namespace: Exclude<SyncNamespace, 'assets'>
  readonly changes: readonly SyncChange[]
}

export type SyncPolicyTransition = 'unchanged' | 'start-authoritative' | 'retain-authoritative' | 'clear-authoritative'

export interface SyncPolicyUpdate {
  readonly enabledModes: readonly ('relay' | 'authoritative')[]
  readonly expectedPolicyEpoch: number
  readonly transition: SyncPolicyTransition
  readonly reset?: { readonly jobId: string, readonly createdAt: number }
}

export interface SyncPolicyUpdateResult {
  readonly state: SyncAccountState
  readonly resetJob: SyncResetJob | null
}

export interface SyncRepository {
  readonly createAccount: (input: Pick<SyncAccountState, 'accountId' | 'enabledModes'>) => Promise<SyncAccountState>
  readonly getAccountState: (accountId: string) => Promise<SyncAccountState | null>
  readonly listAccountStates: () => Promise<readonly SyncAccountState[]>
  readonly getAssetFrontier: (accountId: string, generation: number) => Promise<VersionVector>
  readonly getFrontier: (accountId: string, namespace: Exclude<SyncNamespace, 'assets'>, generation: number) => Promise<VersionVector>
  readonly getNoteSnapshot: (accountId: string, generation: number, noteId: string) => Promise<SyncNoteSnapshotRecord | null>
  /** Atomically merges a Loro update while holding the account's database lock. */
  readonly mergeNoteSnapshot?: (accountId: string, generation: number, noteId: string, update: string, updatedAt: number) => Promise<SyncNoteSnapshotRecord>
  readonly listNoteSnapshots: (accountId: string, generation: number) => Promise<readonly SyncNoteSnapshotRecord[]>
  readonly upsertNoteSnapshot: (record: SyncNoteSnapshotRecord) => Promise<void>
  readonly listLearningEntities: (accountId: string, generation: number) => Promise<readonly SyncLearningEntityRecord[]>
  readonly upsertLearningEntity: (record: SyncLearningEntityRecord) => Promise<void>
  readonly listLearningTombstones: (accountId: string, generation: number) => Promise<readonly SyncLearningTombstoneRecord[]>
  readonly upsertLearningTombstone: (record: SyncLearningTombstoneRecord) => Promise<void>
  readonly listAssetManifests: (accountId: string, generation: number, since: VersionVector, limit: number) => Promise<readonly SyncAssetManifestRecord[]>
  readonly listChanges: (accountId: string, namespace: Exclude<SyncNamespace, 'assets'>, generation: number, since: VersionVector, limit: number) => Promise<readonly SyncChangeRecord[]>
  readonly appendAssetManifests: (accountId: string, generation: number, manifests: readonly SyncAssetManifest[]) => Promise<{ readonly frontier: VersionVector, readonly acceptedManifestIds: readonly string[] }>
  readonly appendChanges: (batch: SyncMutationBatch) => Promise<{ readonly frontier: VersionVector, readonly acceptedChangeIds: readonly string[] }>
  readonly updateAccountPolicy: (accountId: string, update: SyncPolicyUpdate) => Promise<SyncPolicyUpdateResult>
  readonly requestGenerationReset: (accountId: string, expectedGeneration: number, jobId: string, createdAt: number) => Promise<{ readonly generation: number, readonly job: SyncResetJob }>
  readonly getResetJob: (accountId: string, jobId: string) => Promise<SyncResetJob | null>
  readonly listResetJobs?: () => Promise<readonly SyncResetJob[]>
  readonly claimResetJob: (owner: string, timestamp: number, leaseDurationMs: number) => Promise<SyncResetJob | null>
  readonly retryResetJob: (jobId: string, owner: string, error: string) => Promise<void>
  readonly completeResetJob: (jobId: string, owner: string, completedAt: number) => Promise<void>
  readonly clearGeneration: (accountId: string, generation: number) => Promise<void>
  readonly putObjectMetadata: (metadata: SyncObjectMetadata) => Promise<void>
  readonly getObjectMetadata: (accountId: string, generation: number, contentHash: string) => Promise<SyncObjectMetadata | null>
  readonly listObjectMetadata: (accountId: string, generation: number, limit: number, afterKey?: string) => Promise<readonly SyncObjectMetadata[]>
  readonly isObjectReferenced: (accountId: string, generation: number, contentHash: string) => Promise<boolean>
  readonly deleteObjectMetadata: (accountId: string, generation: number, contentHash: string) => Promise<void>
}

export interface SyncObjectStore {
  readonly close: () => Promise<void> | void
  /** Verifies that the configured store supports the operations required before the server becomes ready. */
  readonly verify: () => Promise<void>
  readonly putImmutable: (metadata: SyncObjectMetadata, body: AsyncIterable<Uint8Array>) => Promise<void>
  readonly get: (accountId: string, key: string) => Promise<{ readonly metadata: SyncObjectMetadata, readonly body: AsyncIterable<Uint8Array> } | null>
  readonly head: (accountId: string, key: string) => Promise<SyncObjectMetadata | null>
  readonly delete: (accountId: string, key: string) => Promise<void>
  readonly list: (accountId: string, cursor?: string, limit?: number) => Promise<{ readonly items: readonly SyncObjectMetadata[], readonly cursor: string | null }>
}

export interface SyncStorageProviderConfig {
  readonly metadataDatabase: 'sqlite' | 'postgres'
  readonly objectStore: 'filesystem' | 's3'
}

export function isSyncNamespace(value: string): value is SyncNamespace {
  return value === 'notes' || value === 'learning' || value === 'assets'
}

export function validatePolicyTransition(
  currentModes: readonly ('relay' | 'authoritative')[],
  update: SyncPolicyUpdate,
): void {
  if (update.enabledModes.length === 0 || update.enabledModes.some(mode => mode !== 'relay' && mode !== 'authoritative'))
    throw new TypeError('At least one supported sync mode must remain enabled')
  const hadAuthoritative = currentModes.includes('authoritative')
  const hasAuthoritative = update.enabledModes.includes('authoritative')
  const expected = hadAuthoritative === hasAuthoritative
    ? ['unchanged']
    : hasAuthoritative
      ? ['start-authoritative']
      : ['retain-authoritative', 'clear-authoritative']
  if (!expected.includes(update.transition))
    throw new Error('Sync policy transition confirmation does not match the requested mode change')
  const resetsGeneration = update.transition === 'start-authoritative' || update.transition === 'clear-authoritative'
  if (resetsGeneration !== (update.reset !== undefined))
    throw new Error('Sync policy transition reset identity is invalid')
}

export function objectKeyFor(accountId: string, generation: number, contentHash: string): string {
  if (!/^[\w-]+$/u.test(accountId) || !Number.isSafeInteger(generation) || generation < 0 || !/^[a-f\d]{64}$/u.test(contentHash))
    throw new TypeError('Invalid sync object key parts')
  return `tenants/${accountId}/generations/${generation}/objects/${contentHash.slice(0, 2)}/${contentHash}`
}

export function deviceSequenceFor(change: Pick<SyncChange, 'deviceId' | 'sequence'>): string {
  if (!change.deviceId || !Number.isSafeInteger(change.sequence) || change.sequence <= 0)
    throw new TypeError('Invalid sync change sequence')
  return `${change.deviceId}:${change.sequence}`
}
