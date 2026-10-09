import type { DatabaseCommand, EditorStorageDrizzleDatabase } from './database-driver'
import type {
  NoteEntryProjection,
  TopicContentProjection,
  TopicProjection,
} from './editor-storage-contracts'
import { and, eq } from 'drizzle-orm'
import {
  bookTopics,
  noteEntries,
  notes,
  topics as storedTopics,
  topicBlocks,
} from './drizzle-schema'
import { contentHash } from './editor-storage-validation'

type NoteProjectionTarget
  = | { noteId: string }
    | { noteRowId: number }

interface NoteProjectionPlan {
  blocks: ReadonlyMap<string, { hash: string }>
  commands: readonly DatabaseCommand[]
  entryIds: ReadonlySet<string>
  topicIds: ReadonlySet<string>
}

type ProjectionWriteMode = 'insert' | 'upsert'

function blockKey(topicId: string, blockId: string): string {
  return `${topicId}\0${blockId}`
}

function resolveNoteRowId(
  database: EditorStorageDrizzleDatabase,
  target: NoteProjectionTarget,
): number {
  if ('noteRowId' in target)
    return target.noteRowId
  const note = database.select({ rowId: notes.rowId }).from(notes).where(eq(notes.id, target.noteId)).get()
  if (!note)
    throw new Error(`Unknown Note: ${target.noteId}`)
  return note.rowId
}

/**
 * Plans the normalized Note projection for both initial creation and updates.
 * Callers own transaction ordering; this module owns the shared SQLite shape.
 */
function planNoteProjection(
  target: NoteProjectionTarget,
  entries: readonly NoteEntryProjection[] | undefined,
  topics: readonly TopicContentProjection[],
  mode: ProjectionWriteMode,
): NoteProjectionPlan {
  const commands: DatabaseCommand[] = []
  const entryIds = new Set((entries ?? []).map(entry => entry.id))
  const topicEntries = new Map((entries ?? [])
    .filter((entry): entry is TopicProjection => entry.kind === 'topic')
    .map(entry => [entry.id, entry]))
  const topicIds = new Set(topicEntries.keys())
  const blocks = new Map<string, { hash: string }>()

  for (const entry of entries ?? []) {
    commands.push({
      drizzle: (database) => {
        const noteRowId = resolveNoteRowId(database, target)
        const values = {
          entryId: entry.id,
          kind: entry.kind,
          label: entry.kind === 'folder' ? entry.name : entry.title,
          noteRowId,
          ordinal: entry.ordinal,
          parentEntryId: entry.parentId,
        }
        const insert = database.insert(noteEntries).values(values)
        if (mode === 'upsert')
          insert.onConflictDoUpdate({ set: values, target: [noteEntries.noteRowId, noteEntries.entryId] }).run()
        else
          insert.run()
      },
    })
  }

  for (const entry of topicEntries.values()) {
    commands.push({
      drizzle: (database) => {
        const noteRowId = resolveNoteRowId(database, target)
        const values = {
          cardSourceJson: entry.topicType === 'regular' && entry.cardSource !== undefined ? JSON.stringify(entry.cardSource) : null,
          editorMode: entry.topicType === 'book' || entry.topicType === 'regular' ? entry.mode : null,
          noteRowId,
          title: entry.title,
          topicId: entry.id,
          topicType: entry.topicType,
        }
        const insert = database.insert(storedTopics).values(values)
        if (mode === 'upsert')
          insert.onConflictDoUpdate({ set: values, target: [storedTopics.noteRowId, storedTopics.topicId] }).run()
        else
          insert.run()
      },
    })
  }

  if (mode === 'upsert' && entries !== undefined) {
    commands.push({
      drizzle: database => database.delete(bookTopics)
        .where(eq(bookTopics.noteRowId, resolveNoteRowId(database, target)))
        .run(),
    })
  }
  for (const entry of topicEntries.values()) {
    if (entry.topicType !== 'book')
      continue
    commands.push({
      drizzle: database => database.insert(bookTopics).values({
        authorsJson: JSON.stringify(entry.book.book.authors),
        byteLength: entry.book.file.byteLength,
        contentHash: entry.book.file.sha256,
        format: entry.book.file.format,
        noteRowId: resolveNoteRowId(database, target),
        originalName: entry.book.file.originalName,
        publicationTitle: entry.book.book.title,
        retrievalHintsJson: JSON.stringify(entry.book.retrievalHints),
        topicId: entry.id,
      }).run(),
    })
  }

  if (mode === 'upsert') {
    for (const topic of topics) {
      commands.push(
        {
          drizzle: database => database.update(storedTopics).set({ title: topic.title }).where(and(
            eq(storedTopics.noteRowId, resolveNoteRowId(database, target)),
            eq(storedTopics.topicId, topic.topicId),
          )).run(),
        },
        {
          drizzle: database => database.update(noteEntries).set({ label: topic.title }).where(and(
            eq(noteEntries.noteRowId, resolveNoteRowId(database, target)),
            eq(noteEntries.entryId, topic.topicId),
          )).run(),
        },
      )
    }
  }

  for (const topic of topics) {
    for (const block of topic.blocks) {
      const hash = contentHash(block.text)
      blocks.set(blockKey(topic.topicId, block.id), { hash })
      commands.push({
        drizzle: (database) => {
          const values = {
            attributesJson: JSON.stringify(block.attributes),
            blockId: block.id,
            contentHash: hash,
            kind: block.kind,
            noteRowId: resolveNoteRowId(database, target),
            ordinal: block.ordinal,
            parentBlockId: block.parentId,
            text: block.text,
            topicId: topic.topicId,
          }
          const insert = database.insert(topicBlocks).values(values)
          if (mode === 'upsert')
            insert.onConflictDoUpdate({ set: values, target: [topicBlocks.noteRowId, topicBlocks.topicId, topicBlocks.blockId] }).run()
          else
            insert.run()
        },
      })
    }
  }

  return { blocks, commands, entryIds, topicIds }
}

export function planInitializedNoteProjection(
  noteId: string,
  entries: readonly NoteEntryProjection[],
  topics: readonly TopicContentProjection[],
): NoteProjectionPlan {
  return planNoteProjection({ noteId }, entries, topics, 'insert')
}

export function planUpdatedNoteProjection(
  noteRowId: number,
  entries: readonly NoteEntryProjection[] | undefined,
  topics: readonly TopicContentProjection[],
): NoteProjectionPlan {
  return planNoteProjection({ noteRowId }, entries, topics, 'upsert')
}
