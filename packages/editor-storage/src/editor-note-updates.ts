import type { DatabaseCommand, EditorStorageDatabase, EditorStorageDrizzleDatabase, StorageOperationRunner } from './database-driver'
import type { EditorNoteRecords } from './editor-note-records'
import type {
  NoteWriteReceipt,
  SaveNoteUpdatesInput,
} from './editor-storage-contracts'
import type {
  ExistingBlockRow,
  ExistingEntryRow,
  ExistingTopicRow,
  JournalMetadataRow,
  NoteUpdateHashRow,
} from './editor-storage-rows'
import type { LearningCardReconciliationPlanner } from './learning/learning-card-reconciliation'
import type { ReadingItemProjection } from './learning/types'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { and, eq, inArray } from 'drizzle-orm'
import { journals, noteEntries, notes, noteUpdateReceipts, noteUpdates, topicBlockEmbeddingState, topicBlocks, topics } from './drizzle-schema'
import { validateAssetFileName } from './editor-asset-repository'
import { planUpdatedNoteProjection } from './editor-note-projection-plan'
import { assertNonEmpty, readJournalDate } from './editor-storage-shared'
import {
  validateAssetReferences,
  validateBinary,
  validateCompleteLearningProjection,
  validateJournalProjection,
  validateProjectionPatch,
} from './editor-storage-validation'
import { topicBlockEmbeddings } from './sqlite-extension-schema'

interface EditorNoteUpdateDependencies {
  database: EditorStorageDatabase
  planLearningCards: LearningCardReconciliationPlanner
  planReadingItems: (noteId: string, items: readonly ReadingItemProjection[]) => Promise<readonly DatabaseCommand[]>
  records: EditorNoteRecords
  runOperation: StorageOperationRunner
}

function updateHash(update: Uint8Array): string {
  return bytesToHex(sha256(update))
}

export function saveNoteUpdates(
  dependencies: EditorNoteUpdateDependencies,
  input: SaveNoteUpdatesInput,
): Promise<NoteWriteReceipt> {
  assertNonEmpty(input.noteId, 'Note id')
  if (input.title !== undefined)
    assertNonEmpty(input.title, 'Note title')
  if (input.updates.length === 0)
    throw new TypeError('Note updates must contain at least one update')
  if (input.journalHasUserContent !== undefined && typeof input.journalHasUserContent !== 'boolean')
    throw new TypeError('Journal content state must be a boolean')
  input.updates.forEach((update, index) => validateBinary(update, `Note update ${index}`))
  validateProjectionPatch(input.entries, input.topics)
  if (input.entries !== undefined && input.learningCards !== undefined)
    validateCompleteLearningProjection(input.entries, input.learningCards)
  if (input.assetReferences !== undefined)
    validateAssetReferences(input.assetReferences)
  input.allowedMissingAssetFileNames?.forEach(validateAssetFileName)
  const saved = structuredClone(input)
  const orm: EditorStorageDrizzleDatabase = dependencies.database.drizzle

  return dependencies.runOperation(async () => {
    const note = await dependencies.records.requireRow(saved.noteId)
    const journal = orm.select({
      note_id: notes.id,
      journal_date: journals.journalDate,
      has_user_content: journals.hasUserContent,
    }).from(journals).innerJoin(notes, eq(notes.rowId, journals.noteRowId)).where(eq(journals.noteRowId, note.row_id)).get() as JournalMetadataRow | undefined
    if (journal) {
      const journalDate = readJournalDate(journal.journal_date, `Stored Journal date for Note ${saved.noteId}`)
      if (note.title !== journalDate)
        throw new Error(`Journal ${journalDate} has a non-canonical stored Note title`)
      if (saved.title !== journalDate)
        throw new TypeError(`Journal ${journalDate} title is immutable`)
      if (saved.journalHasUserContent === undefined)
        throw new TypeError('Journal saves must include their semantic content state')
      validateJournalProjection(saved.entries, saved.topics)
    }
    else if (saved.journalHasUserContent !== undefined) {
      throw new TypeError(`Regular Note ${saved.noteId} cannot persist Journal content state`)
    }
    if (!journal && saved.title !== undefined && saved.title !== note.title)
      await dependencies.records.assertTitleAvailable(saved.title, note.id)

    const updatesByHash = new Map(saved.updates.map(update => [updateHash(update), update]))
    const received = orm.select({ update_hash: noteUpdateReceipts.updateHash })
      .from(noteUpdateReceipts)
      .where(eq(noteUpdateReceipts.noteRowId, note.row_id))
      .all() as NoteUpdateHashRow[]
    const receivedHashes = new Set(received.map(row => row.update_hash))
    const newUpdates = [...updatesByHash]
      .filter(([hash]) => !receivedHashes.has(hash))
      .map(([hash, update]) => ({ hash, update }))
    if (newUpdates.length === 0) {
      const commands: DatabaseCommand[] = []
      if (journal) {
        commands.push({
          drizzle: database => database.update(journals)
            .set({ hasUserContent: saved.journalHasUserContent === true ? 1 : 0 })
            .where(eq(journals.noteRowId, note.row_id))
            .run(),
        })
      }
      if (saved.learningCards !== undefined) {
        commands.push(...await dependencies.planLearningCards({
          noteId: saved.noteId,
          replaceMissingTopics: saved.entries !== undefined,
          topics: saved.learningCards,
        }))
      }
      if (saved.learningReadingItems !== undefined)
        commands.push(...await dependencies.planReadingItems(saved.noteId, saved.learningReadingItems))
      if (commands.length > 0)
        await dependencies.database.batch(commands)
      return { acceptedUpdateHashes: [], latestSequence: note.latest_sequence, updatedAt: note.updated_at }
    }

    const projection = planUpdatedNoteProjection(
      note.row_id,
      saved.entries,
      saved.topics,
    )

    const existingEntries = saved.entries
      ? orm.select({ entry_id: noteEntries.entryId }).from(noteEntries).where(eq(noteEntries.noteRowId, note.row_id)).all() as ExistingEntryRow[]
      : []
    const existingTopics = saved.entries
      ? orm.select({ topic_id: topics.topicId }).from(topics).where(eq(topics.noteRowId, note.row_id)).all() as ExistingTopicRow[]
      : []
    const existingBlocks = saved.topics.length === 0
      ? []
      : orm.select({
        row_id: topicBlocks.rowId,
        topic_id: topicBlocks.topicId,
        block_id: topicBlocks.blockId,
        content_hash: topicBlocks.contentHash,
      }).from(topicBlocks).where(and(
        eq(topicBlocks.noteRowId, note.row_id),
        inArray(topicBlocks.topicId, saved.topics.map(topic => topic.topicId)),
      )).all() as ExistingBlockRow[]

    const commands: DatabaseCommand[] = []
    for (const existing of existingBlocks) {
      const next = projection.blocks.get(`${existing.topic_id}\0${existing.block_id}`)
      if (!next || next.hash !== existing.content_hash) {
        commands.push(
          {
            drizzle: database => database.delete(topicBlockEmbeddings)
              .where(eq(topicBlockEmbeddings.blockRowId, existing.row_id))
              .run(),
          },
          {
            drizzle: database => database.delete(topicBlockEmbeddingState)
              .where(eq(topicBlockEmbeddingState.blockRowId, existing.row_id))
              .run(),
          },
        )
      }
    }

    const now = Date.now()
    const latestSequence = note.latest_sequence + newUpdates.length
    if (saved.assetReferences !== undefined) {
      commands.push(...await dependencies.records.replaceAssetReferenceCommands(
        note.row_id,
        saved.assetReferences,
        saved.allowedMissingAssetFileNames,
      ))
    }
    commands.push({
      drizzle: database => database.update(notes).set({
        latestSequence,
        title: saved.title ?? note.title,
        updatedAt: now,
      }).where(eq(notes.rowId, note.row_id)).run(),
    })
    if (journal) {
      commands.push({
        drizzle: database => database.update(journals)
          .set({ hasUserContent: saved.journalHasUserContent === true ? 1 : 0 })
          .where(eq(journals.noteRowId, note.row_id))
          .run(),
      })
    }
    newUpdates.forEach(({ hash, update }, index) => {
      const sequence = note.latest_sequence + index + 1
      commands.push({
        drizzle: database => database.insert(noteUpdates).values({
          createdAt: now,
          noteRowId: note.row_id,
          sequence,
          updateBlob: update,
          updateHash: hash,
        }).run(),
      })
      commands.push({
        drizzle: database => database.insert(noteUpdateReceipts).values({
          createdAt: now,
          noteRowId: note.row_id,
          sequence,
          updateHash: hash,
        }).run(),
      })
    })
    commands.push(...projection.commands)
    if (saved.learningCards !== undefined) {
      commands.push(...await dependencies.planLearningCards({
        noteId: saved.noteId,
        replaceMissingTopics: saved.entries !== undefined,
        topics: saved.learningCards,
      }))
    }
    if (saved.learningReadingItems !== undefined)
      commands.push(...await dependencies.planReadingItems(saved.noteId, saved.learningReadingItems))

    for (const existing of existingBlocks) {
      if (!projection.blocks.has(`${existing.topic_id}\0${existing.block_id}`)) {
        commands.push({
          drizzle: database => database.delete(topicBlocks).where(and(
            eq(topicBlocks.noteRowId, note.row_id),
            eq(topicBlocks.topicId, existing.topic_id),
            eq(topicBlocks.blockId, existing.block_id),
          )).run(),
        })
      }
    }
    for (const existing of existingTopics) {
      if (!projection.topicIds.has(existing.topic_id)) {
        commands.push({
          drizzle: database => database.delete(topics).where(and(
            eq(topics.noteRowId, note.row_id),
            eq(topics.topicId, existing.topic_id),
          )).run(),
        })
      }
    }
    for (const existing of existingEntries) {
      if (!projection.entryIds.has(existing.entry_id)) {
        commands.push({
          drizzle: database => database.delete(noteEntries).where(and(
            eq(noteEntries.noteRowId, note.row_id),
            eq(noteEntries.entryId, existing.entry_id),
          )).run(),
        })
      }
    }

    try {
      await dependencies.database.batch(commands)
    }
    catch (error) {
      if (!journal && saved.title !== undefined && saved.title !== note.title)
        return dependencies.records.rethrowTitleConflict(error, saved.title, note.id)
      throw error
    }
    return { acceptedUpdateHashes: newUpdates.map(update => update.hash), latestSequence, updatedAt: now }
  })
}
