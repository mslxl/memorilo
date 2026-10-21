CREATE TABLE `assets` (
	`file_name` text PRIMARY KEY NOT NULL,
	`original_file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`unreferenced_at` integer,
	`deletion_claimed_at` integer,
	CONSTRAINT "assets_byte_size_check" CHECK(byte_size > 0)
);
--> statement-breakpoint
CREATE TABLE `book_topics` (
	`note_row_id` integer NOT NULL,
	`topic_id` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`byte_length` integer NOT NULL,
	`original_name` text NOT NULL,
	`publication_title` text NOT NULL,
	`authors_json` text NOT NULL,
	`retrieval_hints_json` text NOT NULL,
	PRIMARY KEY(`note_row_id`, `topic_id`),
	FOREIGN KEY (`note_row_id`,`topic_id`) REFERENCES `topics`(`note_row_id`,`topic_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "book_topics_format_check" CHECK(format IN ('cbr', 'cbz', 'epub', 'pdf', 'txt')),
	CONSTRAINT "book_topics_hash_check" CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "book_topics_byte_length_check" CHECK(byte_length > 0)
);
--> statement-breakpoint
CREATE INDEX `book_topics_file_idx` ON `book_topics` (`format`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `book_topics_file_unique` ON `book_topics` (`note_row_id`,`format`,`content_hash`);--> statement-breakpoint
CREATE TABLE `editor_storage_embedding_configuration` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`dimensions` integer NOT NULL,
	CONSTRAINT "editor_storage_embedding_configuration_singleton_check" CHECK(singleton = 1),
	CONSTRAINT "editor_storage_embedding_configuration_dimensions_check" CHECK(dimensions > 0)
);
--> statement-breakpoint
CREATE TABLE `journals` (
	`note_row_id` integer PRIMARY KEY NOT NULL,
	`journal_date` text NOT NULL,
	`has_user_content` integer NOT NULL,
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "journals_date_check" CHECK(journal_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "journals_content_check" CHECK(has_user_content IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `journals_feed_idx` ON `journals` (`has_user_content`,`journal_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `journals_date_unique` ON `journals` (`journal_date`);--> statement-breakpoint
CREATE TABLE `learning_card_introductions` (
	`card_id` text PRIMARY KEY NOT NULL,
	`introduced_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `learning_cards`(`card_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_card_introductions_time_idx` ON `learning_card_introductions` (`introduced_at`);--> statement-breakpoint
CREATE TABLE `learning_cards` (
	`card_id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`topic_order` integer NOT NULL,
	`source_block_id` text NOT NULL,
	`source_order` integer NOT NULL,
	`kind` text NOT NULL,
	`direction` text NOT NULL,
	`active` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`inactive_at` integer,
	`sync_sequence` integer DEFAULT -1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_cards_sibling_idx` ON `learning_cards` (`source_block_id`,`active`);--> statement-breakpoint
CREATE INDEX `learning_cards_topic_idx` ON `learning_cards` (`note_id`,`topic_id`,`active`);--> statement-breakpoint
CREATE TABLE `learning_maintenance_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`phase` text NOT NULL,
	`archived_optimizers` integer NOT NULL,
	`inactive_cards` integer NOT NULL,
	`review_events` integer NOT NULL,
	`targets` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_note_optimizer_assignments` (
	`note_id` text PRIMARY KEY NOT NULL,
	`optimizer_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_sequence` integer DEFAULT -1 NOT NULL,
	FOREIGN KEY (`optimizer_id`) REFERENCES `learning_optimizers`(`optimizer_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `learning_note_optimizer_owner_idx` ON `learning_note_optimizer_assignments` (`optimizer_id`,`note_id`);--> statement-breakpoint
CREATE TABLE `learning_optimizer_revisions` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`optimizer_id` text NOT NULL,
	`configuration_json` text NOT NULL,
	`fsrs_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`sync_sequence` integer DEFAULT -1 NOT NULL,
	FOREIGN KEY (`optimizer_id`) REFERENCES `learning_optimizers`(`optimizer_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_optimizer_revisions_owner_idx` ON `learning_optimizer_revisions` (`optimizer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `learning_optimizers` (
	`optimizer_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_global` integer NOT NULL,
	`status` text NOT NULL,
	`current_revision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_sequence` integer DEFAULT -1 NOT NULL,
	CONSTRAINT "learning_optimizers_global_check" CHECK(is_global IN (0, 1)),
	CONSTRAINT "learning_optimizers_status_check" CHECK(status IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_active_optimizer_name_idx` ON `learning_optimizers` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_global_optimizer_idx` ON `learning_optimizers` (`is_global`);--> statement-breakpoint
CREATE TABLE `learning_purge_tombstones` (
	`tombstone_id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`generation` integer NOT NULL,
	`created_at` integer NOT NULL,
	`server_sequence` integer DEFAULT -1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_queue_exclusions` (
	`card_id` text NOT NULL,
	`reason` text NOT NULL,
	`until_at` integer NOT NULL,
	`source_event_id` text,
	PRIMARY KEY(`card_id`, `reason`),
	FOREIGN KEY (`card_id`) REFERENCES `learning_cards`(`card_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_queue_exclusions_reason_check" CHECK(reason IN ('manual_skip', 'partial_parent', 'sibling_bury'))
);
--> statement-breakpoint
CREATE INDEX `learning_queue_exclusions_until_idx` ON `learning_queue_exclusions` (`until_at`);--> statement-breakpoint
CREATE TABLE `learning_reading_items` (
	`reading_item_id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`source_block_id` text NOT NULL,
	`highlight_id` text NOT NULL,
	`state` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`next_process_at` integer,
	`read_point` integer DEFAULT 0 NOT NULL,
	`last_processed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "learning_reading_items_state_check" CHECK(state IN ('new', 'learning', 'processed')),
	CONSTRAINT "learning_reading_items_read_point_check" CHECK(read_point >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_reading_items_note_block_highlight_unique` ON `learning_reading_items` (`note_id`,`source_block_id`,`highlight_id`);--> statement-breakpoint
CREATE INDEX `learning_reading_items_note_idx` ON `learning_reading_items` (`note_id`,`topic_id`,`state`);--> statement-breakpoint
CREATE INDEX `learning_reading_items_queue_idx` ON `learning_reading_items` (`next_process_at`,`priority`,`reading_item_id`);--> statement-breakpoint
CREATE TABLE `learning_review_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`card_id` text NOT NULL,
	`note_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`rating` text,
	`occurred_at` integer NOT NULL,
	`response_milliseconds` integer,
	`scheduled_days` integer,
	`elapsed_days` integer,
	`base_event_id` text,
	`undoes_event_id` text,
	`reset_epoch` text,
	`result_state_json` text,
	`device_id` text NOT NULL,
	`device_sequence` integer NOT NULL,
	`server_sequence` integer DEFAULT -1 NOT NULL,
	`fsrs_version` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `learning_targets`(`target_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_review_events_device_sequence_check" CHECK(device_sequence > 0)
);
--> statement-breakpoint
CREATE INDEX `learning_review_event_undoes_idx` ON `learning_review_events` (`undoes_event_id`);--> statement-breakpoint
CREATE INDEX `learning_review_event_card_time_idx` ON `learning_review_events` (`card_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `learning_review_event_kind_time_idx` ON `learning_review_events` (`event_kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `learning_review_event_target_time_idx` ON `learning_review_events` (`target_id`,`occurred_at`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_review_event_device_sequence_idx` ON `learning_review_events` (`device_id`,`device_sequence`);--> statement-breakpoint
CREATE TABLE `learning_sibling_bury_events` (
	`source_event_id` text PRIMARY KEY NOT NULL,
	`source_card_id` text NOT NULL,
	`note_id` text NOT NULL,
	`source_block_id` text NOT NULL,
	`source_queue` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`source_event_id`) REFERENCES `learning_review_events`(`event_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_sibling_bury_event_time_idx` ON `learning_sibling_bury_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `learning_sibling_bury_event_group_idx` ON `learning_sibling_bury_events` (`note_id`,`source_block_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `learning_states` (
	`target_id` text PRIMARY KEY NOT NULL,
	`phase` text NOT NULL,
	`due_at` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`last_review_at` integer,
	`optimizer_revision_id` text NOT NULL,
	`winning_event_id` text,
	`state_hash` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `learning_targets`(`target_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`optimizer_revision_id`) REFERENCES `learning_optimizer_revisions`(`revision_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "learning_states_phase_check" CHECK(phase IN ('new', 'learning', 'review', 'relearning')),
	CONSTRAINT "learning_states_scheduled_days_check" CHECK(scheduled_days >= 0),
	CONSTRAINT "learning_states_learning_steps_check" CHECK(learning_steps >= 0),
	CONSTRAINT "learning_states_reps_check" CHECK(reps >= 0),
	CONSTRAINT "learning_states_lapses_check" CHECK(lapses >= 0)
);
--> statement-breakpoint
CREATE INDEX `learning_states_due_idx` ON `learning_states` (`due_at`,`phase`);--> statement-breakpoint
CREATE TABLE `learning_sync_outbox` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_sync_outbox_order_idx` ON `learning_sync_outbox` (`created_at`,`mutation_id`);--> statement-breakpoint
CREATE TABLE `learning_sync_received_mutations` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`source_device_id` text NOT NULL,
	`source_sequence` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_sync_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`next_device_sequence` integer NOT NULL,
	`last_server_sequence` integer NOT NULL,
	`schema_generation` integer NOT NULL,
	CONSTRAINT "learning_sync_state_singleton_check" CHECK(singleton = 1),
	CONSTRAINT "learning_sync_state_next_sequence_check" CHECK(next_device_sequence > 0),
	CONSTRAINT "learning_sync_state_server_sequence_check" CHECK(last_server_sequence >= 0),
	CONSTRAINT "learning_sync_state_generation_check" CHECK(schema_generation > 0)
);
--> statement-breakpoint
CREATE TABLE `learning_targets` (
	`target_id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`item_block_id` text,
	`target_order` integer NOT NULL,
	`active` integer NOT NULL,
	`partial_active` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`inactive_at` integer,
	FOREIGN KEY (`card_id`) REFERENCES `learning_cards`(`card_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_targets_kind_check" CHECK(target_kind IN ('whole', 'item')),
	CONSTRAINT "learning_targets_order_check" CHECK(target_order >= 0),
	CONSTRAINT "learning_targets_active_check" CHECK(active IN (0, 1)),
	CONSTRAINT "learning_targets_partial_active_check" CHECK(partial_active IN (0, 1)),
	CONSTRAINT "learning_targets_item_check" CHECK((target_kind = 'whole' AND item_block_id IS NULL) OR (target_kind = 'item' AND item_block_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_item_target_idx` ON `learning_targets` (`card_id`,`item_block_id`) WHERE target_kind = 'item';--> statement-breakpoint
CREATE UNIQUE INDEX `learning_whole_target_idx` ON `learning_targets` (`card_id`) WHERE target_kind = 'whole';--> statement-breakpoint
CREATE TABLE `note_asset_references` (
	`note_row_id` integer NOT NULL,
	`asset_file_name` text NOT NULL,
	`reference_count` integer NOT NULL,
	PRIMARY KEY(`note_row_id`, `asset_file_name`),
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_file_name`) REFERENCES `assets`(`file_name`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "note_asset_references_count_check" CHECK(reference_count > 0)
);
--> statement-breakpoint
CREATE INDEX `note_asset_references_asset_idx` ON `note_asset_references` (`asset_file_name`);--> statement-breakpoint
CREATE TABLE `note_entries` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_row_id` integer NOT NULL,
	`entry_id` text NOT NULL,
	`parent_entry_id` text,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_entries_ordinal_check" CHECK(ordinal >= 0),
	CONSTRAINT "note_entries_kind_check" CHECK(kind IN ('folder', 'topic'))
);
--> statement-breakpoint
CREATE INDEX `note_entries_parent_order_idx` ON `note_entries` (`note_row_id`,`parent_entry_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_entries_note_entry_unique` ON `note_entries` (`note_row_id`,`entry_id`);--> statement-breakpoint
CREATE TABLE `note_favorites` (
	`note_row_id` integer PRIMARY KEY NOT NULL,
	`favorited_at` integer NOT NULL,
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_favorites_order_idx` ON `note_favorites` (`favorited_at`,`note_row_id`);--> statement-breakpoint
CREATE TABLE `note_open_history` (
	`note_row_id` integer PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_row_id`,`topic_id`) REFERENCES `topics`(`note_row_id`,`topic_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_open_history_order_idx` ON `note_open_history` (`opened_at`,`note_row_id`);--> statement-breakpoint
CREATE TABLE `note_update_receipts` (
	`note_row_id` integer NOT NULL,
	`update_hash` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`note_row_id`, `update_hash`),
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_update_receipts_sequence_check" CHECK(sequence > 0)
);
--> statement-breakpoint
CREATE TABLE `note_updates` (
	`note_row_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`update_hash` text NOT NULL,
	`update_blob` blob NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`note_row_id`, `sequence`),
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_updates_sequence_check" CHECK(sequence > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_updates_hash_unique` ON `note_updates` (`note_row_id`,`update_hash`);--> statement-breakpoint
CREATE TABLE `notes` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'regular' NOT NULL,
	`checkpoint_snapshot` blob,
	`checkpoint_sequence` integer DEFAULT 0 NOT NULL,
	`latest_sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "notes_kind_check" CHECK(kind IN ('regular', 'journal')),
	CONSTRAINT "notes_checkpoint_sequence_check" CHECK(checkpoint_sequence >= 0),
	CONSTRAINT "notes_latest_sequence_check" CHECK(latest_sequence >= checkpoint_sequence)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_id_unique` ON `notes` (`id`);--> statement-breakpoint
CREATE TABLE `todo_calendar_events` (
	`subscription_id` text NOT NULL,
	`version` text NOT NULL,
	`uid` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`start_at` text,
	`end_at` text,
	`all_day` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`subscription_id`, `version`, `uid`, `start_date`),
	FOREIGN KEY (`subscription_id`,`version`) REFERENCES `todo_calendar_versions`(`subscription_id`,`version`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "todo_calendar_events_start_date_check" CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "todo_calendar_events_end_date_check" CHECK(end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "todo_calendar_events_all_day_check" CHECK(all_day IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `todo_calendar_events_date_idx` ON `todo_calendar_events` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `todo_calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`enabled` integer NOT NULL,
	`version` text,
	`fetched_at` integer,
	`etag` text,
	`last_modified` text,
	CONSTRAINT "todo_calendar_subscriptions_id_check" CHECK(length(trim(id)) > 0),
	CONSTRAINT "todo_calendar_subscriptions_url_check" CHECK(length(trim(url)) > 0),
	CONSTRAINT "todo_calendar_subscriptions_enabled_check" CHECK(enabled IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `todo_calendar_versions` (
	`subscription_id` text NOT NULL,
	`version` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`raw_ics` text NOT NULL,
	PRIMARY KEY(`subscription_id`, `version`),
	FOREIGN KEY (`subscription_id`) REFERENCES `todo_calendar_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topic_block_embedding_state` (
	`block_row_id` integer PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`block_row_id`) REFERENCES `topic_blocks`(`row_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topic_blocks` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_row_id` integer NOT NULL,
	`topic_id` text NOT NULL,
	`block_id` text NOT NULL,
	`parent_block_id` text,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`attributes_json` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_row_id`,`topic_id`) REFERENCES `topics`(`note_row_id`,`topic_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "topic_blocks_ordinal_check" CHECK(ordinal >= 0)
);
--> statement-breakpoint
CREATE INDEX `topic_blocks_task_status_idx` ON `topic_blocks` (`row_id`);--> statement-breakpoint
CREATE INDEX `topic_blocks_task_feed_idx` ON `topic_blocks` (`row_id`);--> statement-breakpoint
CREATE INDEX `topic_blocks_parent_order_idx` ON `topic_blocks` (`note_row_id`,`topic_id`,`parent_block_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `topic_blocks_identity_unique` ON `topic_blocks` (`note_row_id`,`topic_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_row_id` integer NOT NULL,
	`topic_id` text NOT NULL,
	`topic_type` text NOT NULL,
	`editor_mode` integer,
	`card_source_json` text,
	`title` text NOT NULL,
	FOREIGN KEY (`note_row_id`) REFERENCES `notes`(`row_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "topics_type_check" CHECK(topic_type IN ('regular', 'book', 'image-occlusion', 'whiteboard')),
	CONSTRAINT "topics_editor_mode_check" CHECK(editor_mode IS NULL OR editor_mode IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_note_topic_unique` ON `topics` (`note_row_id`,`topic_id`);--> statement-breakpoint
CREATE TABLE `user_documents` (
	`document_id` text PRIMARY KEY NOT NULL,
	`snapshot` blob NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "user_documents_id_check" CHECK(length(trim(document_id)) > 0),
	CONSTRAINT "user_documents_snapshot_check" CHECK(length(snapshot) > 0)
);
