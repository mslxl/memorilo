import { sql } from 'drizzle-orm'
import { blob, check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const notes = sqliteTable('notes', {
  rowId: integer('row_id').primaryKey({ autoIncrement: true }),
  id: text().notNull(),
  title: text().notNull(),
  kind: text().default('regular').notNull(),
  checkpointSnapshot: blob('checkpoint_snapshot'),
  checkpointSequence: integer('checkpoint_sequence').default(0).notNull(),
  latestSequence: integer('latest_sequence').default(0).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  uniqueIndex('notes_id_unique').on(table.id),
  uniqueIndex('notes_regular_title_unique')
    .on(sql`${table.title} COLLATE NOCASE`)
    .where(sql`${table.kind} = 'regular'`),
  check('notes_kind_check', sql`kind IN ('regular', 'journal')`),
  check('notes_checkpoint_sequence_check', sql`checkpoint_sequence >= 0`),
  check('notes_latest_sequence_check', sql`latest_sequence >= checkpoint_sequence`),
])

export const userDocuments = sqliteTable('user_documents', {
  documentId: text('document_id').primaryKey(),
  snapshot: blob().notNull(),
  updatedAt: integer('updated_at').notNull(),
}, () => [
  check('user_documents_id_check', sql`length(trim(document_id)) > 0`),
  check('user_documents_snapshot_check', sql`length(snapshot) > 0`),
])

export const journals = sqliteTable('journals', {
  noteRowId: integer('note_row_id').primaryKey().references(() => notes.rowId, { onDelete: 'cascade' }),
  journalDate: text('journal_date').notNull(),
  hasUserContent: integer('has_user_content').notNull(),
}, table => [
  index('journals_feed_idx').on(table.hasUserContent, table.journalDate),
  uniqueIndex('journals_date_unique').on(table.journalDate),
  check('journals_date_check', sql`journal_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  check('journals_content_check', sql`has_user_content IN (0, 1)`),
])

export const assets = sqliteTable('assets', {
  fileName: text('file_name').primaryKey(),
  originalFileName: text('original_file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: integer('created_at').notNull(),
  unreferencedAt: integer('unreferenced_at'),
  deletionClaimedAt: integer('deletion_claimed_at'),
}, () => [
  check('assets_byte_size_check', sql`byte_size > 0`),
])

export const assetSyncManifests = sqliteTable('asset_sync_manifests', {
  id: text().primaryKey(),
  deviceId: text('device_id').notNull(),
  sequence: integer().notNull(),
  fileName: text('file_name').notNull(),
  originalFileName: text('original_file_name').notNull(),
  operation: text({ enum: ['put', 'delete'] }).notNull(),
  contentHash: text('content_hash'),
  contentLength: integer('content_length'),
  contentType: text('content_type'),
  createdAt: integer('created_at').notNull(),
}, table => [
  uniqueIndex('asset_sync_manifests_device_sequence_unique').on(table.deviceId, table.sequence),
  check('asset_sync_manifests_sequence_check', sql`${table.sequence} > 0`),
  check('asset_sync_manifests_shape_check', sql`(
    (${table.operation} = 'put' AND ${table.contentHash} IS NOT NULL AND ${table.contentLength} IS NOT NULL AND ${table.contentType} IS NOT NULL) OR
    (${table.operation} = 'delete' AND ${table.contentHash} IS NULL AND ${table.contentLength} IS NULL AND ${table.contentType} IS NULL)
  )`),
])

export const noteAssetReferences = sqliteTable('note_asset_references', {
  noteRowId: integer('note_row_id').notNull().references(() => notes.rowId, { onDelete: 'cascade' }),
  assetFileName: text('asset_file_name').notNull().references(() => assets.fileName, { onDelete: 'restrict' }),
  referenceCount: integer('reference_count').notNull(),
}, table => [
  index('note_asset_references_asset_idx').on(table.assetFileName),
  primaryKey({ columns: [table.noteRowId, table.assetFileName], name: 'note_asset_references_note_row_id_asset_file_name_pk' }),
  check('note_asset_references_count_check', sql`reference_count > 0`),
])

export const noteUpdates = sqliteTable('note_updates', {
  noteRowId: integer('note_row_id').notNull().references(() => notes.rowId, { onDelete: 'cascade' }),
  sequence: integer().notNull(),
  updateHash: text('update_hash').notNull(),
  updateBlob: blob('update_blob').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.noteRowId, table.sequence], name: 'note_updates_note_row_id_sequence_pk' }),
  uniqueIndex('note_updates_hash_unique').on(table.noteRowId, table.updateHash),
  check('note_updates_sequence_check', sql`sequence > 0`),
])

export const noteUpdateReceipts = sqliteTable('note_update_receipts', {
  noteRowId: integer('note_row_id').notNull().references(() => notes.rowId, { onDelete: 'cascade' }),
  updateHash: text('update_hash').notNull(),
  sequence: integer().notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.noteRowId, table.updateHash], name: 'note_update_receipts_note_row_id_update_hash_pk' }),
  check('note_update_receipts_sequence_check', sql`sequence > 0`),
])

export const noteEntries = sqliteTable('note_entries', {
  rowId: integer('row_id').primaryKey({ autoIncrement: true }),
  noteRowId: integer('note_row_id').notNull().references(() => notes.rowId, { onDelete: 'cascade' }),
  entryId: text('entry_id').notNull(),
  parentEntryId: text('parent_entry_id'),
  ordinal: integer().notNull(),
  kind: text().notNull(),
  label: text().notNull(),
}, table => [
  index('note_entries_parent_order_idx').on(table.noteRowId, table.parentEntryId, table.ordinal),
  uniqueIndex('note_entries_note_entry_unique').on(table.noteRowId, table.entryId),
  check('note_entries_ordinal_check', sql`ordinal >= 0`),
  check('note_entries_kind_check', sql`kind IN ('folder', 'topic')`),
])

export const topics = sqliteTable('topics', {
  rowId: integer('row_id').primaryKey({ autoIncrement: true }),
  noteRowId: integer('note_row_id').notNull().references(() => notes.rowId, { onDelete: 'cascade' }),
  topicId: text('topic_id').notNull(),
  topicType: text('topic_type').notNull(),
  editorMode: integer('editor_mode'),
  cardSourceJson: text('card_source_json'),
  title: text().notNull(),
}, table => [
  uniqueIndex('topics_note_topic_unique').on(table.noteRowId, table.topicId),
  check('topics_type_check', sql`topic_type IN ('regular', 'book', 'image-occlusion', 'whiteboard')`),
  check('topics_editor_mode_check', sql`editor_mode IS NULL OR editor_mode IN (0, 1)`),
])

export const bookTopics = sqliteTable('book_topics', {
  noteRowId: integer('note_row_id').notNull(),
  topicId: text('topic_id').notNull(),
  format: text().notNull(),
  contentHash: text('content_hash').notNull(),
  byteLength: integer('byte_length').notNull(),
  originalName: text('original_name').notNull(),
  publicationTitle: text('publication_title').notNull(),
  authorsJson: text('authors_json').notNull(),
  retrievalHintsJson: text('retrieval_hints_json').notNull(),
}, table => [
  index('book_topics_file_idx').on(table.format, table.contentHash),
  foreignKey(() => ({
    columns: [table.noteRowId, table.topicId],
    foreignColumns: [topics.noteRowId, topics.topicId],
    name: 'book_topics_note_row_id_topic_id_topics_note_row_id_topic_id_fk',
  })).onDelete('cascade'),
  primaryKey({ columns: [table.noteRowId, table.topicId], name: 'book_topics_note_row_id_topic_id_pk' }),
  uniqueIndex('book_topics_file_unique').on(table.noteRowId, table.format, table.contentHash),
  check('book_topics_format_check', sql`format IN ('cbr', 'cbz', 'epub', 'pdf', 'txt')`),
  check('book_topics_hash_check', sql`length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'`),
  check('book_topics_byte_length_check', sql`byte_length > 0`),
])

export const noteFavorites = sqliteTable('note_favorites', {
  noteRowId: integer('note_row_id').primaryKey().references(() => notes.rowId, { onDelete: 'cascade' }),
  favoritedAt: integer('favorited_at').notNull(),
}, table => [
  index('note_favorites_order_idx').on(table.favoritedAt, table.noteRowId),
])

export const noteOpenHistory = sqliteTable('note_open_history', {
  noteRowId: integer('note_row_id').primaryKey().references(() => notes.rowId, { onDelete: 'cascade' }),
  topicId: text('topic_id').notNull(),
  openedAt: integer('opened_at').notNull(),
}, table => [
  index('note_open_history_order_idx').on(table.openedAt, table.noteRowId),
  foreignKey(() => ({
    columns: [table.noteRowId, table.topicId],
    foreignColumns: [topics.noteRowId, topics.topicId],
    name: 'note_open_history_note_row_id_topic_id_topics_note_row_id_topic_id_fk',
  })).onDelete('cascade'),
])

export const topicBlocks = sqliteTable('topic_blocks', {
  rowId: integer('row_id').primaryKey({ autoIncrement: true }),
  noteRowId: integer('note_row_id').notNull().references(() => notes.rowId, { onDelete: 'cascade' }),
  topicId: text('topic_id').notNull(),
  blockId: text('block_id').notNull(),
  parentBlockId: text('parent_block_id'),
  ordinal: integer().notNull(),
  kind: text().notNull(),
  text: text().notNull(),
  attributesJson: text('attributes_json').notNull(),
  contentHash: text('content_hash').notNull(),
}, table => [
  index('topic_blocks_task_status_idx').on(table.rowId),
  index('topic_blocks_task_feed_idx').on(table.rowId),
  index('topic_blocks_parent_order_idx').on(table.noteRowId, table.topicId, table.parentBlockId, table.ordinal),
  foreignKey(() => ({
    columns: [table.noteRowId, table.topicId],
    foreignColumns: [topics.noteRowId, topics.topicId],
    name: 'topic_blocks_note_row_id_topic_id_topics_note_row_id_topic_id_fk',
  })).onDelete('cascade'),
  uniqueIndex('topic_blocks_identity_unique').on(table.noteRowId, table.topicId, table.blockId),
  check('topic_blocks_ordinal_check', sql`ordinal >= 0`),
])

export const todoCalendarSubscriptions = sqliteTable('todo_calendar_subscriptions', {
  id: text().primaryKey(),
  url: text().notNull(),
  title: text().notNull(),
  enabled: integer().notNull(),
  version: text(),
  fetchedAt: integer('fetched_at'),
  etag: text(),
  lastModified: text('last_modified'),
}, () => [
  check('todo_calendar_subscriptions_id_check', sql`length(trim(id)) > 0`),
  check('todo_calendar_subscriptions_url_check', sql`length(trim(url)) > 0`),
  check('todo_calendar_subscriptions_enabled_check', sql`enabled IN (0, 1)`),
])

export const todoCalendarVersions = sqliteTable('todo_calendar_versions', {
  subscriptionId: text('subscription_id').notNull().references(() => todoCalendarSubscriptions.id, { onDelete: 'cascade' }),
  version: text().notNull(),
  fetchedAt: integer('fetched_at').notNull(),
  rawIcs: text('raw_ics').notNull(),
}, table => [
  primaryKey({ columns: [table.subscriptionId, table.version], name: 'todo_calendar_versions_subscription_id_version_pk' }),
])

export const todoCalendarEvents = sqliteTable('todo_calendar_events', {
  subscriptionId: text('subscription_id').notNull(),
  version: text().notNull(),
  uid: text().notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  startAt: text('start_at'),
  endAt: text('end_at'),
  allDay: integer('all_day').default(1).notNull(),
  title: text().notNull(),
}, table => [
  index('todo_calendar_events_date_idx').on(table.startDate, table.endDate),
  foreignKey(() => ({
    columns: [table.subscriptionId, table.version],
    foreignColumns: [todoCalendarVersions.subscriptionId, todoCalendarVersions.version],
    name: 'todo_calendar_events_subscription_id_version_todo_calendar_versions_subscription_id_version_fk',
  })).onDelete('cascade'),
  primaryKey({ columns: [table.subscriptionId, table.version, table.uid, table.startDate], name: 'todo_calendar_events_subscription_id_version_uid_start_date_pk' }),
  check('todo_calendar_events_start_date_check', sql`start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  check('todo_calendar_events_end_date_check', sql`end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
  check('todo_calendar_events_all_day_check', sql`all_day IN (0, 1)`),
])

export const editorStorageEmbeddingConfiguration = sqliteTable('editor_storage_embedding_configuration', {
  singleton: integer().primaryKey(),
  modelId: text('model_id').notNull(),
  dimensions: integer().notNull(),
}, () => [
  check('editor_storage_embedding_configuration_singleton_check', sql`singleton = 1`),
  check('editor_storage_embedding_configuration_dimensions_check', sql`dimensions > 0`),
])

export const topicBlockEmbeddingState = sqliteTable('topic_block_embedding_state', {
  blockRowId: integer('block_row_id').primaryKey().references(() => topicBlocks.rowId, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  contentHash: text('content_hash').notNull(),
})

export const learningOptimizers = sqliteTable('learning_optimizers', {
  optimizerId: text('optimizer_id').primaryKey(),
  name: text().notNull(),
  isGlobal: integer('is_global').notNull(),
  status: text().notNull(),
  currentRevisionId: text('current_revision_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  syncSequence: integer('sync_sequence').default(-1).notNull(),
}, table => [
  uniqueIndex('learning_active_optimizer_name_idx').on(table.name),
  uniqueIndex('learning_global_optimizer_idx').on(table.isGlobal),
  check('learning_optimizers_global_check', sql`is_global IN (0, 1)`),
  check('learning_optimizers_status_check', sql`status IN ('active', 'archived')`),
])

export const learningOptimizerRevisions = sqliteTable('learning_optimizer_revisions', {
  revisionId: text('revision_id').primaryKey(),
  optimizerId: text('optimizer_id').notNull().references(() => learningOptimizers.optimizerId, { onDelete: 'cascade' }),
  configurationJson: text('configuration_json').notNull(),
  fsrsVersion: text('fsrs_version').notNull(),
  createdAt: integer('created_at').notNull(),
  syncSequence: integer('sync_sequence').default(-1).notNull(),
}, table => [
  index('learning_optimizer_revisions_owner_idx').on(table.optimizerId, table.createdAt),
])

export const learningNoteOptimizerAssignments = sqliteTable('learning_note_optimizer_assignments', {
  noteId: text('note_id').primaryKey(),
  optimizerId: text('optimizer_id').notNull().references(() => learningOptimizers.optimizerId),
  updatedAt: integer('updated_at').notNull(),
  syncSequence: integer('sync_sequence').default(-1).notNull(),
}, table => [
  index('learning_note_optimizer_owner_idx').on(table.optimizerId, table.noteId),
])

export const learningCards = sqliteTable('learning_cards', {
  cardId: text('card_id').primaryKey(),
  noteId: text('note_id').notNull(),
  topicId: text('topic_id').notNull(),
  topicOrder: integer('topic_order').notNull(),
  sourceBlockId: text('source_block_id').notNull(),
  sourceOrder: integer('source_order').notNull(),
  kind: text().notNull(),
  direction: text().notNull(),
  active: integer().notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  inactiveAt: integer('inactive_at'),
  syncSequence: integer('sync_sequence').default(-1).notNull(),
}, table => [
  index('learning_cards_sibling_idx').on(table.sourceBlockId, table.active),
  index('learning_cards_topic_idx').on(table.noteId, table.topicId, table.active),
  check('learning_cards_topic_order_check', sql`topic_order >= 0`),
  check('learning_cards_source_order_check', sql`source_order >= 0`),
  check('learning_cards_kind_check', sql`kind IN ('basic', 'cloze', 'list', 'set')`),
  check('learning_cards_direction_check', sql`direction IN ('backward', 'forward')`),
  check('learning_cards_active_check', sql`active IN (0, 1)`),
])

export const learningReadingItems = sqliteTable('learning_reading_items', {
  readingItemId: text('reading_item_id').primaryKey(),
  noteId: text('note_id').notNull(),
  topicId: text('topic_id').notNull(),
  sourceBlockId: text('source_block_id').notNull(),
  highlightId: text('highlight_id').notNull(),
  state: text().notNull(),
  priority: integer().default(0).notNull(),
  nextProcessAt: integer('next_process_at'),
  readPoint: integer('read_point').default(0).notNull(),
  lastProcessedAt: integer('last_processed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  uniqueIndex('learning_reading_items_note_block_highlight_unique').on(table.noteId, table.sourceBlockId, table.highlightId),
  index('learning_reading_items_note_idx').on(table.noteId, table.topicId, table.state),
  index('learning_reading_items_queue_idx').on(table.nextProcessAt, table.priority, table.readingItemId),
  check('learning_reading_items_state_check', sql`state IN ('new', 'learning', 'processed')`),
  check('learning_reading_items_read_point_check', sql`read_point >= 0`),
])

export const learningCardIntroductions = sqliteTable('learning_card_introductions', {
  cardId: text('card_id').primaryKey().references(() => learningCards.cardId, { onDelete: 'cascade' }),
  introducedAt: integer('introduced_at').notNull(),
}, table => [
  index('learning_card_introductions_time_idx').on(table.introducedAt),
])

export const learningTargets = sqliteTable('learning_targets', {
  targetId: text('target_id').primaryKey(),
  cardId: text('card_id').notNull().references(() => learningCards.cardId, { onDelete: 'cascade' }),
  targetKind: text('target_kind').notNull(),
  itemBlockId: text('item_block_id'),
  targetOrder: integer('target_order').notNull(),
  active: integer().notNull(),
  partialActive: integer('partial_active').default(0).notNull(),
  createdAt: integer('created_at').notNull(),
  inactiveAt: integer('inactive_at'),
}, table => [
  uniqueIndex('learning_item_target_idx').on(table.cardId, table.itemBlockId).where(sql`target_kind = 'item'`),
  uniqueIndex('learning_whole_target_idx').on(table.cardId).where(sql`target_kind = 'whole'`),
  check('learning_targets_kind_check', sql`target_kind IN ('whole', 'item')`),
  check('learning_targets_order_check', sql`target_order >= 0`),
  check('learning_targets_active_check', sql`active IN (0, 1)`),
  check('learning_targets_partial_active_check', sql`partial_active IN (0, 1)`),
  check('learning_targets_item_check', sql`(target_kind = 'whole' AND item_block_id IS NULL) OR (target_kind = 'item' AND item_block_id IS NOT NULL)`),
])

export const learningStates = sqliteTable('learning_states', {
  targetId: text('target_id').primaryKey().references(() => learningTargets.targetId, { onDelete: 'cascade' }),
  phase: text().notNull(),
  dueAt: integer('due_at').notNull(),
  stability: real().notNull(),
  difficulty: real().notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  learningSteps: integer('learning_steps').notNull(),
  reps: integer().notNull(),
  lapses: integer().notNull(),
  lastReviewAt: integer('last_review_at'),
  optimizerRevisionId: text('optimizer_revision_id').notNull().references(() => learningOptimizerRevisions.revisionId),
  winningEventId: text('winning_event_id'),
  stateHash: text('state_hash').notNull(),
}, table => [
  index('learning_states_due_idx').on(table.dueAt, table.phase),
  check('learning_states_phase_check', sql`phase IN ('new', 'learning', 'review', 'relearning')`),
  check('learning_states_scheduled_days_check', sql`scheduled_days >= 0`),
  check('learning_states_learning_steps_check', sql`learning_steps >= 0`),
  check('learning_states_reps_check', sql`reps >= 0`),
  check('learning_states_lapses_check', sql`lapses >= 0`),
])

export const learningReviewEvents = sqliteTable('learning_review_events', {
  eventId: text('event_id').primaryKey(),
  targetId: text('target_id').notNull().references(() => learningTargets.targetId, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull(),
  noteId: text('note_id').notNull(),
  eventKind: text('event_kind').notNull(),
  rating: text(),
  occurredAt: integer('occurred_at').notNull(),
  responseMilliseconds: integer('response_milliseconds'),
  scheduledDays: integer('scheduled_days'),
  elapsedDays: integer('elapsed_days'),
  baseEventId: text('base_event_id'),
  undoesEventId: text('undoes_event_id'),
  resetEpoch: text('reset_epoch'),
  resultStateJson: text('result_state_json'),
  deviceId: text('device_id').notNull(),
  deviceSequence: integer('device_sequence').notNull(),
  serverSequence: integer('server_sequence').default(-1).notNull(),
  fsrsVersion: text('fsrs_version').notNull(),
}, table => [
  index('learning_review_event_undoes_idx').on(table.undoesEventId),
  index('learning_review_event_card_time_idx').on(table.cardId, table.occurredAt),
  index('learning_review_event_kind_time_idx').on(table.eventKind, table.occurredAt),
  index('learning_review_event_target_time_idx').on(table.targetId, table.occurredAt, table.eventId),
  uniqueIndex('learning_review_event_device_sequence_idx').on(table.deviceId, table.deviceSequence),
  check('learning_review_events_device_sequence_check', sql`device_sequence > 0`),
  check('learning_review_events_kind_check', sql`event_kind IN ('rating', 'reset', 'undo')`),
  check('learning_review_events_rating_check', sql`rating IS NULL OR rating IN ('again', 'hard', 'good', 'easy')`),
  check('learning_review_events_response_check', sql`response_milliseconds IS NULL OR response_milliseconds >= 0`),
  check('learning_review_events_scheduled_days_check', sql`scheduled_days IS NULL OR scheduled_days >= 0`),
  check('learning_review_events_elapsed_days_check', sql`elapsed_days IS NULL OR elapsed_days >= 0`),
  check('learning_review_events_consistency_check', sql`(event_kind = 'rating' AND rating IS NOT NULL AND undoes_event_id IS NULL) OR (event_kind = 'undo' AND rating IS NULL AND undoes_event_id IS NOT NULL) OR (event_kind = 'reset' AND rating IS NULL AND reset_epoch IS NOT NULL)`),
])

export const learningSiblingBuryEvents = sqliteTable('learning_sibling_bury_events', {
  sourceEventId: text('source_event_id').primaryKey().references(() => learningReviewEvents.eventId, { onDelete: 'cascade' }),
  sourceCardId: text('source_card_id').notNull(),
  noteId: text('note_id').notNull(),
  sourceBlockId: text('source_block_id').notNull(),
  sourceQueue: text('source_queue').notNull(),
  occurredAt: integer('occurred_at').notNull(),
}, table => [
  index('learning_sibling_bury_event_time_idx').on(table.occurredAt),
  index('learning_sibling_bury_event_group_idx').on(table.noteId, table.sourceBlockId, table.occurredAt),
  check('learning_sibling_bury_events_queue_check', sql`source_queue IN ('intraday-learning', 'interday-learning', 'review', 'new')`),
])

export const learningQueueExclusions = sqliteTable('learning_queue_exclusions', {
  cardId: text('card_id').notNull().references(() => learningCards.cardId, { onDelete: 'cascade' }),
  reason: text().notNull(),
  untilAt: integer('until_at').notNull(),
  sourceEventId: text('source_event_id'),
}, table => [
  index('learning_queue_exclusions_until_idx').on(table.untilAt),
  primaryKey({ columns: [table.cardId, table.reason], name: 'learning_queue_exclusions_card_id_reason_pk' }),
  check('learning_queue_exclusions_reason_check', sql`reason IN ('manual_skip', 'partial_parent', 'sibling_bury')`),
])

export const learningSyncState = sqliteTable('learning_sync_state', {
  singleton: integer().primaryKey(),
  deviceId: text('device_id').notNull(),
  nextDeviceSequence: integer('next_device_sequence').notNull(),
  lastServerSequence: integer('last_server_sequence').notNull(),
  schemaGeneration: integer('schema_generation').notNull(),
}, () => [
  check('learning_sync_state_singleton_check', sql`singleton = 1`),
  check('learning_sync_state_next_sequence_check', sql`next_device_sequence > 0`),
  check('learning_sync_state_server_sequence_check', sql`last_server_sequence >= 0`),
  check('learning_sync_state_generation_check', sql`schema_generation > 0`),
])

export const learningSyncOutbox = sqliteTable('learning_sync_outbox', {
  mutationId: text('mutation_id').primaryKey(),
  entityKind: text('entity_kind').notNull(),
  entityId: text('entity_id').notNull(),
  operation: text().notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('learning_sync_outbox_order_idx').on(table.createdAt, table.mutationId),
  check('learning_sync_outbox_entity_kind_check', sql`entity_kind IN ('assignment', 'card', 'optimizer', 'review-event', 'tombstone')`),
  check('learning_sync_outbox_operation_check', sql`operation IN ('upsert', 'delete')`),
])

export const learningSyncReceivedMutations = sqliteTable('learning_sync_received_mutations', {
  mutationId: text('mutation_id').primaryKey(),
  sourceDeviceId: text('source_device_id').notNull(),
  sourceSequence: integer('source_sequence').notNull(),
  receivedAt: integer('received_at').notNull(),
}, () => [
  check('learning_sync_received_mutations_source_sequence_check', sql`source_sequence > 0`),
])

export const learningPurgeTombstones = sqliteTable('learning_purge_tombstones', {
  tombstoneId: text('tombstone_id').primaryKey(),
  scopeKind: text('scope_kind').notNull(),
  scopeId: text('scope_id').notNull(),
  generation: integer().notNull(),
  createdAt: integer('created_at').notNull(),
  serverSequence: integer('server_sequence').default(-1).notNull(),
}, () => [
  check('learning_purge_tombstones_scope_check', sql`scope_kind IN ('card', 'optimizer', 'target')`),
  check('learning_purge_tombstones_generation_check', sql`generation > 0`),
])

export const learningMaintenanceState = sqliteTable('learning_maintenance_state', {
  singleton: integer().primaryKey(),
  phase: text().notNull(),
  archivedOptimizers: integer('archived_optimizers').notNull(),
  inactiveCards: integer('inactive_cards').notNull(),
  reviewEvents: integer('review_events').notNull(),
  targets: integer().notNull(),
  createdAt: integer('created_at').notNull(),
}, () => [
  check('learning_maintenance_state_singleton_check', sql`singleton = 1`),
  check('learning_maintenance_state_phase_check', sql`phase = 'vacuum-pending'`),
  check('learning_maintenance_state_archived_check', sql`archived_optimizers >= 0`),
  check('learning_maintenance_state_inactive_check', sql`inactive_cards >= 0`),
  check('learning_maintenance_state_events_check', sql`review_events >= 0`),
  check('learning_maintenance_state_targets_check', sql`targets >= 0`),
])

export const shelfSyncState = sqliteTable('shelf_sync_state', {
  singleton: integer().primaryKey(),
  actorId: text('actor_id').notNull(),
  lastPhysical: integer('last_physical').notNull(),
  lastLogical: integer('last_logical').notNull(),
}, () => [
  check('shelf_sync_state_singleton_check', sql`singleton = 1`),
  check('shelf_sync_state_physical_check', sql`last_physical >= 0`),
  check('shelf_sync_state_logical_check', sql`last_logical >= 0`),
])

export const shelfSources = sqliteTable('shelf_sources', {
  id: text().primaryKey(),
  kind: text().notNull(),
  url: text().notNull(),
  name: text().notNull(),
  username: text(),
  auth: text().notNull(),
  enabled: integer().notNull(),
  orderKey: text('order_key').notNull(),
  encryptedPassword: blob('encrypted_password'),
  deleted: integer().default(0).notNull(),
  fieldClocksJson: text('field_clocks_json').notNull(),
  addedAt: integer('added_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('shelf_sources_order_idx').on(table.deleted, table.enabled, table.orderKey, table.id),
  check('shelf_sources_kind_check', sql`kind = 'opds'`),
  check('shelf_sources_auth_check', sql`auth IN ('none', 'basic')`),
  check('shelf_sources_enabled_check', sql`enabled IN (0, 1)`),
  check('shelf_sources_deleted_check', sql`deleted IN (0, 1)`),
])

export const shelfSourceOperations = sqliteTable('shelf_source_operations', {
  id: text().primaryKey(),
  actorId: text('actor_id').notNull(),
  sourceId: text('source_id').notNull(),
  clock: text().notNull(),
  fieldsJson: text('fields_json').notNull(),
  pending: integer().notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('shelf_source_operations_pending_idx').on(table.pending, table.clock, table.id),
  check('shelf_source_operations_pending_check', sql`pending IN (0, 1)`),
])

export const shelfPages = sqliteTable('shelf_pages', {
  sourceId: text('source_id').notNull().references(() => shelfSources.id, { onDelete: 'cascade' }),
  url: text().notNull(),
  pageJson: text('page_json').notNull(),
  etag: text(),
  lastModified: text('last_modified'),
  fetchedAt: integer('fetched_at').notNull(),
}, table => [
  primaryKey({ columns: [table.sourceId, table.url], name: 'shelf_pages_source_id_url_pk' }),
])

export const shelfAssets = sqliteTable('shelf_assets', {
  sourceId: text('source_id').notNull(),
  url: text().notNull(),
  bytes: blob().notNull(),
  mimeType: text('mime_type').notNull(),
  etag: text(),
  lastModified: text('last_modified'),
  fetchedAt: integer('fetched_at').notNull(),
}, table => [
  primaryKey({ columns: [table.sourceId, table.url], name: 'shelf_assets_source_id_url_pk' }),
])

export const shelfImageCacheEntries = sqliteTable('shelf_image_cache_entries', {
  sourceId: text('source_id').notNull(),
  url: text().notNull(),
  byteSize: integer('byte_size').notNull(),
  lastAccessedAt: integer('last_accessed_at').notNull(),
}, table => [
  primaryKey({ columns: [table.sourceId, table.url], name: 'shelf_image_cache_entries_source_id_url_pk' }),
  index('shelf_image_cache_lru_idx').on(table.lastAccessedAt, table.sourceId, table.url),
  foreignKey(() => ({
    columns: [table.sourceId, table.url],
    foreignColumns: [shelfAssets.sourceId, shelfAssets.url],
    name: 'shelf_image_cache_entries_asset_fk',
  })).onDelete('cascade'),
  check('shelf_image_cache_entries_byte_size_check', sql`byte_size > 0`),
  check('shelf_image_cache_entries_accessed_check', sql`last_accessed_at >= 0`),
])

/**
 * Complete relational schema passed to Drizzle adapters. Keeping this object in the
 * platform-neutral package lets Electron, tests, and React Native choose their own
 * SQLite driver while sharing identical queries and migrations.
 */
export const editorStorageDrizzleSchema = {
  assetSyncManifests,
  assets,
  bookTopics,
  editorStorageEmbeddingConfiguration,
  journals,
  learningCardIntroductions,
  learningCards,
  learningMaintenanceState,
  learningNoteOptimizerAssignments,
  learningOptimizerRevisions,
  learningOptimizers,
  learningPurgeTombstones,
  learningQueueExclusions,
  learningReadingItems,
  learningReviewEvents,
  learningSiblingBuryEvents,
  learningStates,
  learningSyncOutbox,
  learningSyncReceivedMutations,
  learningSyncState,
  learningTargets,
  noteAssetReferences,
  noteEntries,
  noteFavorites,
  noteOpenHistory,
  noteUpdateReceipts,
  noteUpdates,
  notes,
  todoCalendarEvents,
  todoCalendarSubscriptions,
  todoCalendarVersions,
  topicBlockEmbeddingState,
  topicBlocks,
  topics,
  userDocuments,
  shelfSyncState,
  shelfSources,
  shelfSourceOperations,
  shelfPages,
  shelfAssets,
  shelfImageCacheEntries,
} as const
