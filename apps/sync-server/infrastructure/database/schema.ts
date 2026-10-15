// Generated from packages/sync/schema/server-schema.json. Do not edit directly.
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const syncAccounts = sqliteTable('sync_accounts', {
  accountId: text('account_id').primaryKey(),
  generation: integer('generation').notNull().default(0),
  membershipEpoch: integer('membership_epoch').notNull().default(1),
  nextReceiptSequence: integer('next_receipt_sequence').notNull().default(1),
  policyEpoch: integer('policy_epoch').notNull().default(0),
  enabledModes: text('enabled_modes', { mode: 'json' }).$type<readonly ('relay' | 'authoritative')[]>().notNull(),
})

export const syncUsers = sqliteTable('sync_users', {
  accountId: text('account_id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const syncSessions = sqliteTable('sync_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const syncInvites = sqliteTable('sync_invites', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  consumedAt: integer('consumed_at'),
})

export const syncDeviceCredentials = sqliteTable('sync_device_credentials', {
  credentialHash: text('credential_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  deviceId: text('device_id').notNull(),
  deviceName: text('device_name').notNull(),
  peerId: text('peer_id').notNull(),
  pairingId: text('pairing_id').notNull(),
  sharedSecretHash: text('shared_secret_hash').notNull(),
  signingPublicKey: text('signing_public_key').notNull(),
  membershipEpoch: integer('membership_epoch').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<readonly ('sync' | 'object')[]>().notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => ({
  deviceCredentialsAccountDevice: uniqueIndex('sync_device_credentials_account_device').on(table.accountId, table.deviceId),
}))

export const syncDeviceNonces = sqliteTable('sync_device_nonces', {
  nonceHash: text('nonce_hash').primaryKey(),
  credentialHash: text('credential_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => ({
  deviceNoncesExpiry: index('sync_device_nonces_expiry').on(table.expiresAt),
  deviceNoncesCredential: index('sync_device_nonces_credential').on(table.credentialHash),
}))

export const syncDeviceTodoTokens = sqliteTable('sync_device_todo_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull(),
  deviceId: text('device_id').notNull(),
  deviceName: text('device_name').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<readonly ('todos:read' | 'todos:calendar:read')[]>().notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => ({
  deviceTodoTokensAccountDevice: uniqueIndex('sync_device_todo_tokens_account_device').on(table.accountId, table.deviceId),
  deviceTodoTokensAccount: index('sync_device_todo_tokens_account').on(table.accountId),
}))

export const syncPairingSessions = sqliteTable('sync_pairing_sessions', {
  pairingId: text('pairing_id').primaryKey(),
  accountId: text('account_id').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: integer('consumed_at'),
})

export const syncChanges = sqliteTable('sync_changes', {
  id: text('id').notNull(),
  accountId: text('account_id').notNull(),
  namespace: text('namespace', { enum: ['notes', 'learning'] }).notNull(),
  generation: integer('generation').notNull(),
  deviceId: text('device_id').notNull(),
  sequence: integer('sequence').notNull(),
  kind: text('kind', { enum: ['note-update', 'learning-mutation'] }).notNull(),
  payload: text('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  receiptSequence: integer('receipt_sequence').notNull(),
  receivedAt: integer('received_at').notNull(),
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

export const syncObjects = sqliteTable('sync_objects', {
  key: text('key').primaryKey(),
  accountId: text('account_id').notNull(),
  generation: integer('generation').notNull(),
  namespace: text('namespace', { enum: ['assets'] }).notNull(),
  contentHash: text('content_hash').notNull(),
  contentLength: integer('content_length').notNull(),
  contentType: text('content_type'),
  createdAt: integer('created_at').notNull(),
}, table => ({
  objectsContentIdentity: uniqueIndex('sync_objects_content_identity').on(table.accountId, table.generation, table.contentHash),
  nonNegativeLength: check('sync_objects_non_negative_length', sql`${table.contentLength} >= 0`),
}))

export const syncAssetManifests = sqliteTable('sync_asset_manifests', {
  id: text('id').notNull(),
  accountId: text('account_id').notNull(),
  generation: integer('generation').notNull(),
  deviceId: text('device_id').notNull(),
  sequence: integer('sequence').notNull(),
  fileName: text('file_name').notNull(),
  originalFileName: text('original_file_name').notNull(),
  operation: text('operation', { enum: ['put', 'delete'] }).notNull(),
  contentHash: text('content_hash'),
  contentLength: integer('content_length'),
  contentType: text('content_type'),
  createdAt: integer('created_at').notNull(),
  receivedAt: integer('received_at').notNull(),
}, table => ({
  assetManifestsIdentity: uniqueIndex('sync_asset_manifests_identity').on(table.accountId, table.generation, table.deviceId, table.sequence),
  assetManifestsId: uniqueIndex('sync_asset_manifests_id').on(table.accountId, table.generation, table.id),
  validAssetManifestShape: check('sync_asset_manifests_shape', sql`(
    (${table.operation} = 'delete' AND ${table.contentHash} IS NULL AND ${table.contentLength} IS NULL AND ${table.contentType} IS NULL) OR
    (${table.operation} = 'put' AND ${table.contentHash} IS NOT NULL AND ${table.contentLength} IS NOT NULL AND ${table.contentLength} >= 0)
  )`),
  positiveSequence: check('sync_asset_manifests_positive_sequence', sql`${table.sequence} > 0`),
}))

export const syncNoteSnapshots = sqliteTable('sync_note_snapshots', {
  accountId: text('account_id').notNull(),
  generation: integer('generation').notNull(),
  noteId: text('note_id').notNull(),
  snapshot: text('snapshot').notNull(),
  frontier: text('frontier', { mode: 'json' }).$type<Readonly<Record<string, number>>>().notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  noteSnapshotsIdentity: uniqueIndex('sync_note_snapshots_identity').on(table.accountId, table.generation, table.noteId),
}))

export const syncLearningEntities = sqliteTable('sync_learning_entities', {
  accountId: text('account_id').notNull(),
  generation: integer('generation').notNull(),
  entityId: text('entity_id').notNull(),
  entityKind: text('entity_kind', { enum: ['assignment', 'card', 'optimizer', 'review-event', 'tombstone'] }).notNull(),
  operation: text('operation', { enum: ['upsert', 'delete'] }).notNull(),
  mutationId: text('mutation_id').notNull(),
  sourceDeviceId: text('source_device_id').notNull(),
  sourceSequence: integer('source_sequence').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  learningEntitiesIdentity: uniqueIndex('sync_learning_entities_identity').on(table.accountId, table.generation, table.entityId),
  positiveSequence: check('sync_learning_entities_positive_sequence', sql`${table.sourceSequence} > 0`),
}))

export const syncLearningTombstones = sqliteTable('sync_learning_tombstones', {
  accountId: text('account_id').notNull(),
  generation: integer('generation').notNull(),
  scopeKind: text('scope_kind', { enum: ['target', 'card', 'optimizer'] }).notNull(),
  scopeId: text('scope_id').notNull(),
  tombstoneId: text('tombstone_id').notNull(),
  tombstoneGeneration: integer('tombstone_generation').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => ({
  learningTombstonesIdentity: uniqueIndex('sync_learning_tombstones_identity').on(table.accountId, table.generation, table.scopeKind, table.scopeId),
}))

export const syncResetJobs = sqliteTable('sync_reset_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  generation: integer('generation').notNull(),
  status: text('status', { enum: ['pending', 'running', 'completed'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: integer('lease_expires_at'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
}, table => ({
  resetJobsGeneration: uniqueIndex('sync_reset_jobs_generation').on(table.accountId, table.generation),
}))

export const syncAuditEvents = sqliteTable('sync_audit_events', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  action: text('action').notNull(),
  actorType: text('actor_type', { enum: ['anonymous', 'browser', 'device', 'system'] }).notNull(),
  actorId: text('actor_id'),
  outcome: text('outcome', { enum: ['success', 'denied', 'failure'] }).notNull(),
  requestId: text('request_id').notNull(),
  remoteAddress: text('remote_address'),
  details: text('details', { mode: 'json' }).$type<Readonly<Record<string, boolean | number | string | null>>>().notNull(),
  createdAt: integer('created_at').notNull(),
}, table => ({
  auditEventsAccountCreated: index('sync_audit_events_account_created').on(table.accountId, table.createdAt),
}))
