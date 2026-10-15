// Generated from packages/sync/schema/server-schema.json. Do not edit directly.
import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

export const syncAccounts = pgTable('sync_accounts', {
  accountId: text('account_id').primaryKey(),
  generation: bigint('generation', { mode: 'number' }).notNull().default(0),
  membershipEpoch: bigint('membership_epoch', { mode: 'number' }).notNull().default(1),
  nextReceiptSequence: bigint('next_receipt_sequence', { mode: 'number' }).notNull().default(1),
  policyEpoch: bigint('policy_epoch', { mode: 'number' }).notNull().default(0),
  enabledModes: jsonb('enabled_modes').$type<readonly ('relay' | 'authoritative')[]>().notNull(),
})

export const syncUsers = pgTable('sync_users', {
  accountId: text('account_id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
})

export const syncSessions = pgTable('sync_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
})

export const syncInvites = pgTable('sync_invites', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  revokedAt: bigint('revoked_at', { mode: 'number' }),
  consumedAt: bigint('consumed_at', { mode: 'number' }),
})

export const syncDeviceCredentials = pgTable('sync_device_credentials', {
  credentialHash: text('credential_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  deviceId: text('device_id').notNull(),
  deviceName: text('device_name').notNull(),
  peerId: text('peer_id').notNull(),
  pairingId: text('pairing_id').notNull(),
  sharedSecretHash: text('shared_secret_hash').notNull(),
  signingPublicKey: text('signing_public_key').notNull(),
  membershipEpoch: bigint('membership_epoch', { mode: 'number' }).notNull(),
  scopes: jsonb('scopes').$type<readonly ('sync' | 'object')[]>().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  revokedAt: bigint('revoked_at', { mode: 'number' }),
}, table => ({
  deviceCredentialsAccountDevice: uniqueIndex('sync_device_credentials_account_device').on(table.accountId, table.deviceId),
}))

export const syncDeviceNonces = pgTable('sync_device_nonces', {
  nonceHash: text('nonce_hash').primaryKey(),
  credentialHash: text('credential_hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
}, table => ({
  deviceNoncesExpiry: index('sync_device_nonces_expiry').on(table.expiresAt),
  deviceNoncesCredential: index('sync_device_nonces_credential').on(table.credentialHash),
}))

export const syncDeviceTodoTokens = pgTable('sync_device_todo_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  deviceId: text('device_id').notNull(),
  deviceName: text('device_name').notNull(),
  scopes: jsonb('scopes').$type<readonly ('todos:read' | 'todos:calendar:read')[]>().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  revokedAt: bigint('revoked_at', { mode: 'number' }),
}, table => ({
  deviceTodoTokensAccountDevice: uniqueIndex('sync_device_todo_tokens_account_device').on(table.accountId, table.deviceId),
  deviceTodoTokensAccount: index('sync_device_todo_tokens_account').on(table.accountId),
}))

export const syncPairingSessions = pgTable('sync_pairing_sessions', {
  pairingId: text('pairing_id').primaryKey(),
  accountId: text('account_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  consumedAt: bigint('consumed_at', { mode: 'number' }),
})

export const syncChanges = pgTable('sync_changes', {
  id: text('id').notNull(),
  accountId: text('account_id').notNull(),
  namespace: text('namespace', { enum: ['notes', 'learning'] }).notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  deviceId: text('device_id').notNull(),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  kind: text('kind', { enum: ['note-update', 'learning-mutation'] }).notNull(),
  payload: text('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  receiptSequence: bigint('receipt_sequence', { mode: 'number' }).notNull(),
  receivedAt: bigint('received_at', { mode: 'number' }).notNull(),
}, table => ({
  changesIdentity: uniqueIndex('sync_changes_identity').on(table.accountId, table.generation, table.namespace, table.deviceId, table.sequence),
  changesId: uniqueIndex('sync_changes_id').on(table.accountId, table.generation, table.namespace, table.id),
  changesReceiptSequence: uniqueIndex('sync_changes_receipt_sequence').on(table.accountId, table.generation, table.receiptSequence),
  validNamespaceAndKind: check('sync_changes_namespace_kind', sql`(
    (${table.namespace} = 'notes' AND ${table.kind} = 'note-update') OR
    (${table.namespace} = 'learning' AND ${table.kind} = 'learning-mutation')
  )`),
  positiveSequence: check('sync_changes_positive_sequence', sql`${table.sequence} > 0`),
}))

export const syncObjects = pgTable('sync_objects', {
  key: text('key').primaryKey(),
  accountId: text('account_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  namespace: text('namespace', { enum: ['assets'] }).notNull(),
  contentHash: text('content_hash').notNull(),
  contentLength: bigint('content_length', { mode: 'number' }).notNull(),
  contentType: text('content_type'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, table => ({
  objectsContentIdentity: uniqueIndex('sync_objects_content_identity').on(table.accountId, table.generation, table.contentHash),
  nonNegativeLength: check('sync_objects_non_negative_length', sql`${table.contentLength} >= 0`),
}))

export const syncAssetManifests = pgTable('sync_asset_manifests', {
  id: text('id').notNull(),
  accountId: text('account_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  deviceId: text('device_id').notNull(),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  fileName: text('file_name').notNull(),
  originalFileName: text('original_file_name').notNull(),
  operation: text('operation', { enum: ['put', 'delete'] }).notNull(),
  contentHash: text('content_hash'),
  contentLength: bigint('content_length', { mode: 'number' }),
  contentType: text('content_type'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  receivedAt: bigint('received_at', { mode: 'number' }).notNull(),
}, table => ({
  assetManifestsIdentity: uniqueIndex('sync_asset_manifests_identity').on(table.accountId, table.generation, table.deviceId, table.sequence),
  assetManifestsId: uniqueIndex('sync_asset_manifests_id').on(table.accountId, table.generation, table.id),
  validAssetManifestShape: check('sync_asset_manifests_shape', sql`(
    (${table.operation} = 'delete' AND ${table.contentHash} IS NULL AND ${table.contentLength} IS NULL AND ${table.contentType} IS NULL) OR
    (${table.operation} = 'put' AND ${table.contentHash} IS NOT NULL AND ${table.contentLength} IS NOT NULL AND ${table.contentLength} >= 0)
  )`),
  positiveSequence: check('sync_asset_manifests_positive_sequence', sql`${table.sequence} > 0`),
}))

export const syncNoteSnapshots = pgTable('sync_note_snapshots', {
  accountId: text('account_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  noteId: text('note_id').notNull(),
  snapshot: text('snapshot').notNull(),
  frontier: jsonb('frontier').$type<Readonly<Record<string, number>>>().notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, table => ({
  noteSnapshotsIdentity: uniqueIndex('sync_note_snapshots_identity').on(table.accountId, table.generation, table.noteId),
}))

export const syncLearningEntities = pgTable('sync_learning_entities', {
  accountId: text('account_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  entityId: text('entity_id').notNull(),
  entityKind: text('entity_kind', { enum: ['assignment', 'card', 'optimizer', 'review-event', 'tombstone'] }).notNull(),
  operation: text('operation', { enum: ['upsert', 'delete'] }).notNull(),
  mutationId: text('mutation_id').notNull(),
  sourceDeviceId: text('source_device_id').notNull(),
  sourceSequence: bigint('source_sequence', { mode: 'number' }).notNull(),
  payload: text('payload').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, table => ({
  learningEntitiesIdentity: uniqueIndex('sync_learning_entities_identity').on(table.accountId, table.generation, table.entityId),
  positiveSequence: check('sync_learning_entities_positive_sequence', sql`${table.sourceSequence} > 0`),
}))

export const syncLearningTombstones = pgTable('sync_learning_tombstones', {
  accountId: text('account_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  scopeKind: text('scope_kind', { enum: ['target', 'card', 'optimizer'] }).notNull(),
  scopeId: text('scope_id').notNull(),
  tombstoneId: text('tombstone_id').notNull(),
  tombstoneGeneration: bigint('tombstone_generation', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, table => ({
  learningTombstonesIdentity: uniqueIndex('sync_learning_tombstones_identity').on(table.accountId, table.generation, table.scopeKind, table.scopeId),
}))

export const syncResetJobs = pgTable('sync_reset_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  status: text('status', { enum: ['pending', 'running', 'completed'] }).notNull(),
  attempts: bigint('attempts', { mode: 'number' }).notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: bigint('lease_expires_at', { mode: 'number' }),
  lastError: text('last_error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
}, table => ({
  resetJobsGeneration: uniqueIndex('sync_reset_jobs_generation').on(table.accountId, table.generation),
}))

export const syncAuditEvents = pgTable('sync_audit_events', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  action: text('action').notNull(),
  actorType: text('actor_type', { enum: ['anonymous', 'browser', 'device', 'system'] }).notNull(),
  actorId: text('actor_id'),
  outcome: text('outcome', { enum: ['success', 'denied', 'failure'] }).notNull(),
  requestId: text('request_id').notNull(),
  remoteAddress: text('remote_address'),
  details: jsonb('details').$type<Readonly<Record<string, boolean | number | string | null>>>().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, table => ({
  auditEventsAccountCreated: index('sync_audit_events_account_created').on(table.accountId, table.createdAt),
}))
