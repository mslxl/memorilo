import type { DatabaseCommand, EditorStorageDatabase, EditorStorageDrizzleDatabase } from './database-driver'
import type {
  AssetReferenceProjection,
  CreateInitializedNoteInput,
  NoteWriteReceipt,
  StoredNote,
} from './editor-storage-contracts'
import type { NoteRow, NoteUpdateRow } from './editor-storage-rows'
import { combineLifecycleFailures } from '@memorilo/effect-lifecycle'
import { and, asc, desc, eq, gt, ne, or, sql } from 'drizzle-orm'
import { v7 as createUuidV7 } from 'uuid'
import { assets, journals, noteAssetReferences, notes, noteUpdates } from './drizzle-schema'
import { planInitializedNoteProjection } from './editor-note-projection-plan'
import { DuplicateNoteTitleError } from './editor-storage-contracts'
import { assertNonEmpty } from './editor-storage-shared'
import { validateBinary, validateProjectionPatch } from './editor-storage-validation'

interface PreparedInitializedNote {
  commands: readonly DatabaseCommand[]
  note: StoredNote
}

type NoteKind = 'journal' | 'regular'

/** Owns the SQLite record shape and persistence invariants for Notes. */
export class EditorNoteRecords {
  readonly #database: EditorStorageDatabase
  readonly #orm: EditorStorageDrizzleDatabase

  constructor(database: EditorStorageDatabase) {
    this.#database = database
    this.#orm = database.drizzle
  }

  async assertTitleAvailable(title: string, excludedNoteId?: string): Promise<void> {
    const duplicate = this.#orm.select({ id: notes.id }).from(notes).where(and(
      eq(notes.kind, 'regular'),
      sql`lower(${notes.title}) = lower(${title})`,
      excludedNoteId === undefined ? undefined : ne(notes.id, excludedNoteId),
    )).limit(1).get()
    if (duplicate)
      throw new DuplicateNoteTitleError(title)
  }

  async checkpoint(
    noteId: string,
    snapshot: Uint8Array,
    throughSequence: number,
  ): Promise<NoteWriteReceipt> {
    const note = await this.requireRow(noteId)
    if (throughSequence < note.checkpoint_sequence || throughSequence > note.latest_sequence) {
      throw new RangeError(
        `Note checkpoint sequence ${throughSequence} is outside ${note.checkpoint_sequence}..${note.latest_sequence}`,
      )
    }

    await this.#database.batch([
      {
        drizzle: database => database.update(notes).set({
          checkpointSequence: throughSequence,
          checkpointSnapshot: snapshot,
        }).where(eq(notes.rowId, note.row_id)).run(),
      },
      {
        drizzle: database => database.delete(noteUpdates).where(and(
          eq(noteUpdates.noteRowId, note.row_id),
          sql`${noteUpdates.sequence} <= ${throughSequence}`,
        )).run(),
      },
    ])
    return { acceptedUpdateHashes: [], latestSequence: note.latest_sequence, updatedAt: note.updated_at }
  }

  async create(title: string): Promise<StoredNote> {
    await this.assertTitleAvailable(title)
    const now = Date.now()
    const id = createUuidV7()
    try {
      this.#orm.insert(notes).values({ id, title, kind: 'regular', checkpointSnapshot: null, checkpointSequence: 0, latestSequence: 0, createdAt: now, updatedAt: now }).run()
    }
    catch (error) {
      return this.rethrowTitleConflict(error, title)
    }
    return {
      checkpointSequence: 0,
      createdAt: now,
      id,
      latestSequence: 0,
      snapshot: null,
      title,
      updatedAt: now,
      updates: [],
    }
  }

  async findJournal(journalDate: string): Promise<StoredNote | undefined> {
    // Keep the journal lookup observable at the adapter boundary: callers use
    // this read to coordinate an atomic create, and lifecycle adapters may
    // instrument or retry it before the typed query executes.
    await this.#database.beforeDrizzleRead?.('SELECT note.row_id FROM journals AS journal')
    const row = this.#orm.select({
      row_id: notes.rowId,
      id: notes.id,
      title: notes.title,
      checkpoint_snapshot: notes.checkpointSnapshot,
      checkpoint_sequence: notes.checkpointSequence,
      latest_sequence: notes.latestSequence,
      created_at: notes.createdAt,
      updated_at: notes.updatedAt,
    }).from(journals).innerJoin(notes, eq(notes.rowId, journals.noteRowId)).where(eq(journals.journalDate, journalDate)).get() as NoteRow | undefined
    if (!row)
      return undefined
    if (row.title !== journalDate)
      throw new Error(`Journal ${journalDate} has a non-canonical stored Note title`)
    return this.hydrate(row)
  }

  async openMostRecent(today: string | null): Promise<StoredNote> {
    const row = this.#orm.select({
      row_id: notes.rowId,
      id: notes.id,
      title: notes.title,
      checkpoint_snapshot: notes.checkpointSnapshot,
      checkpoint_sequence: notes.checkpointSequence,
      latest_sequence: notes.latestSequence,
      created_at: notes.createdAt,
      updated_at: notes.updatedAt,
    }).from(notes).leftJoin(journals, eq(journals.noteRowId, notes.rowId)).where(or(eq(notes.kind, 'regular'), and(eq(notes.kind, 'journal'), today === null ? sql`1 = 1` : ne(journals.journalDate, today)))).orderBy(desc(notes.updatedAt), desc(notes.id)).limit(1).get() as NoteRow | undefined
    return row ? this.hydrate(row) : this.create('Untitled')
  }

  prepareInitialized(
    input: CreateInitializedNoteInput,
    now: number,
    kind: NoteKind = 'regular',
  ): PreparedInitializedNote {
    assertNonEmpty(input.id, 'Note id')
    assertNonEmpty(input.title, 'Note title')
    validateBinary(input.snapshot, 'Note snapshot')
    validateProjectionPatch(input.entries, input.topics)

    const entryTopicIds = new Set(input.entries.flatMap(entry => entry.kind === 'topic' ? [entry.id] : []))
    const projectedTopicIds = new Set(input.topics.map(topic => topic.topicId))
    if (entryTopicIds.size !== projectedTopicIds.size
      || [...entryTopicIds].some(topicId => !projectedTopicIds.has(topicId))) {
      throw new Error('An initialized Note must project content for every Topic entry')
    }

    const projection = planInitializedNoteProjection(
      input.id,
      input.entries,
      input.topics,
    )
    const commands: DatabaseCommand[] = [
      {
        drizzle: database => database.insert(notes).values({
          checkpointSequence: 0,
          checkpointSnapshot: input.snapshot,
          createdAt: now,
          id: input.id,
          kind,
          latestSequence: 0,
          title: input.title,
          updatedAt: now,
        }).run(),
      },
      ...projection.commands,
    ]

    return {
      commands,
      note: {
        checkpointSequence: 0,
        createdAt: now,
        id: input.id,
        latestSequence: 0,
        snapshot: new Uint8Array(input.snapshot),
        title: input.title,
        updatedAt: now,
        updates: [],
      },
    }
  }

  async reconcileAssetReferences(
    noteId: string,
    expectedLatestSequence: number,
    references: readonly AssetReferenceProjection[],
    allowedMissingAssetFileNames: readonly string[] = [],
  ): Promise<boolean> {
    const note = this.#orm.select({ latest_sequence: notes.latestSequence, row_id: notes.rowId }).from(notes).where(eq(notes.id, noteId)).get()
    if (!note)
      throw new Error(`Unknown Note: ${noteId}`)
    if (note.latest_sequence !== expectedLatestSequence)
      return false

    await this.#database.batch(await this.replaceAssetReferenceCommands(
      note.row_id,
      references,
      allowedMissingAssetFileNames,
    ))
    return true
  }

  async replaceAssetReferenceCommands(
    noteRowId: number,
    references: readonly AssetReferenceProjection[],
    allowedMissingAssetFileNames: readonly string[] = [],
  ): Promise<readonly DatabaseCommand[]> {
    const allowedMissing = new Set(allowedMissingAssetFileNames)
    const availableReferences: AssetReferenceProjection[] = []
    for (const reference of references) {
      const asset = this.#orm.select({ deletion_claimed_at: assets.deletionClaimedAt }).from(assets).where(eq(assets.fileName, reference.fileName)).get()
      if (!asset) {
        if (allowedMissing.has(reference.fileName))
          continue
        throw new Error(`Unknown Asset: ${reference.fileName}`)
      }
      if (asset.deletion_claimed_at !== null)
        throw new Error(`Asset is being reclaimed: ${reference.fileName}`)
      availableReferences.push(reference)
    }

    return [
      {
        drizzle: database => database.delete(noteAssetReferences)
          .where(eq(noteAssetReferences.noteRowId, noteRowId))
          .run(),
      },
      ...availableReferences.map(reference => ({
        drizzle: (database: EditorStorageDrizzleDatabase) => database.insert(noteAssetReferences).values({
          assetFileName: reference.fileName,
          noteRowId,
          referenceCount: reference.count,
        }).run(),
      })),
    ]
  }

  async rethrowTitleConflict(
    error: unknown,
    title: string,
    excludedNoteId?: string,
  ): Promise<never> {
    try {
      await this.assertTitleAvailable(title, excludedNoteId)
    }
    catch (classificationError) {
      if (classificationError instanceof DuplicateNoteTitleError)
        throw classificationError
      throw combineLifecycleFailures(
        [error, classificationError],
        `Failed to classify the write failure for Note title "${title}"`,
      )
    }
    throw error
  }

  async require(noteId: string): Promise<StoredNote> {
    return this.hydrate(await this.requireRow(noteId))
  }

  async requireRow(noteId: string): Promise<NoteRow> {
    const row = this.#orm.select({
      row_id: notes.rowId,
      id: notes.id,
      title: notes.title,
      checkpoint_snapshot: notes.checkpointSnapshot,
      checkpoint_sequence: notes.checkpointSequence,
      latest_sequence: notes.latestSequence,
      created_at: notes.createdAt,
      updated_at: notes.updatedAt,
    }).from(notes).where(eq(notes.id, noteId)).get() as NoteRow | undefined
    if (!row)
      throw new Error(`Unknown Note: ${noteId}`)
    return row
  }

  private async hydrate(row: NoteRow): Promise<StoredNote> {
    const updates = row.latest_sequence === row.checkpoint_sequence
      ? []
      : this.#orm.select({ sequence: noteUpdates.sequence, update_blob: noteUpdates.updateBlob })
        .from(noteUpdates)
        .where(and(eq(noteUpdates.noteRowId, row.row_id), gt(noteUpdates.sequence, row.checkpoint_sequence)))
        .orderBy(asc(noteUpdates.sequence))
        .all() as NoteUpdateRow[]

    return {
      checkpointSequence: row.checkpoint_sequence,
      createdAt: row.created_at,
      id: row.id,
      latestSequence: row.latest_sequence,
      snapshot: row.checkpoint_snapshot === null ? null : new Uint8Array(row.checkpoint_snapshot),
      title: row.title,
      updatedAt: row.updated_at,
      updates: updates.map(update => ({
        sequence: update.sequence,
        update: new Uint8Array(update.update_blob),
      })),
    }
  }
}
