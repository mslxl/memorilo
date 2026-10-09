import type { EditorStorage, JournalDate, StoredNote } from '@memorilo/editor-storage'
import type { EditorNote } from '@memorilo/editor/note'
import type { AuthoritativeNote, NoteAuthoritativeCache } from './note-authoritative-cache'
import { createEditorNote, createJournalNote, resolveJournalTopic } from '@memorilo/editor/note'
import { projectNoteAssetReferences } from '../assets/asset-references'
import { toStoredEntries, toStoredTopic } from './note-authoritative-projection'
import { projectNoteLearningCards, projectNoteReadingItems, repairNoteLearningCards } from './note-learning-cards'

interface NoteAuthoritativeLoadingDependencies {
  cache: NoteAuthoritativeCache
  defaultNoteLearningEnabled: () => boolean
  storage: EditorStorage
}

export interface NoteAuthoritativeLoading {
  commit: (note: EditorNote) => Promise<AuthoritativeNote>
  load: (
    stored: StoredNote,
    initialTopicHeading?: string,
    journalDate?: JournalDate | null,
  ) => Promise<AuthoritativeNote>
  open: (noteId: string) => Promise<AuthoritativeNote>
  openJournal: (journalDate: JournalDate) => Promise<{ created: boolean, current: AuthoritativeNote }>
}

export function createNoteAuthoritativeLoading({ cache, defaultNoteLearningEnabled, storage }: NoteAuthoritativeLoadingDependencies): NoteAuthoritativeLoading {
  const restore = async (
    stored: StoredNote,
    initialTopicHeading?: string,
    journalDate: JournalDate | null = null,
  ): Promise<AuthoritativeNote> => {
    const note = createEditorNote({
      id: stored.id,
      ...(initialTopicHeading === undefined ? {} : { initialTopicHeading }),
      learningEnabled: defaultNoteLearningEnabled(),
      snapshot: stored.snapshot,
      title: stored.title,
      updates: stored.updates.map(update => update.update),
    })
    const identity = note.getIdentity()
    const aggregateJournalDate = identity.kind === 'journal' ? identity.journalDate : null
    if (aggregateJournalDate !== journalDate) {
      throw new Error(
        `Stored Note ${stored.id} Journal projection does not match its aggregate identity`,
      )
    }
    let checkpointSequence = stored.checkpointSequence
    let latestSequence = stored.latestSequence
    let updatedAt = stored.updatedAt
    if (stored.snapshot === null) {
      if (stored.updates.length === 0) {
        const entries = note.getEntries()
        const journalTopic = journalDate === null
          ? null
          : resolveJournalTopic(note, { expectedNoteTitle: journalDate })
        const initialized = await storage.notes.saveNoteUpdates({
          entries: toStoredEntries(entries),
          ...(journalTopic === null ? {} : { journalHasUserContent: note.hasUserContent() }),
          learningCards: projectNoteLearningCards(note),
          learningReadingItems: projectNoteReadingItems(note),
          noteId: note.id,
          title: note.getTitle(),
          topics: entries
            .filter(entry => entry.kind === 'topic')
            .map(entry => toStoredTopic(note.getTopicContent(entry.id))),
          updates: [note.exportUpdates()],
        })
        latestSequence = initialized.latestSequence
        updatedAt = initialized.updatedAt
      }
      const checkpoint = await storage.notes.checkpointNote({
        noteId: stored.id,
        snapshot: note.exportSnapshot(),
        throughSequence: latestSequence,
      })
      checkpointSequence = latestSequence
      updatedAt = checkpoint.updatedAt
    }
    const assetReferences = projectNoteAssetReferences(note)
    await storage.notes.reconcileNoteAssetReferences({
      allowedMissingAssetFileNames: assetReferences.map(reference => reference.fileName),
      expectedLatestSequence: latestSequence,
      noteId: note.id,
      references: assetReferences,
    })
    await repairNoteLearningCards(storage, note)
    if (journalDate !== null)
      resolveJournalTopic(note, { expectedNoteTitle: journalDate })
    return { checkpointSequence, createdAt: stored.createdAt, journalDate, latestSequence, note, updatedAt }
  }

  const load = (
    stored: StoredNote,
    initialTopicHeading?: string,
    journalDate: JournalDate | null = null,
  ): Promise<AuthoritativeNote> => cache.load(stored, () => restore(stored, initialTopicHeading, journalDate))

  const commit = async (note: EditorNote): Promise<AuthoritativeNote> => {
    const entries = note.getEntries()
    const identity = note.getIdentity()
    const input = {
      entries: entries.map(entry => structuredClone(entry)),
      learningCards: projectNoteLearningCards(note),
      learningReadingItems: projectNoteReadingItems(note),
      snapshot: note.exportSnapshot(),
      topics: entries
        .filter(entry => entry.kind === 'topic')
        .map(entry => structuredClone(note.getTopicContent(entry.id))),
    }
    const stored = identity.kind === 'journal'
      ? (await storage.journals.getOrCreate({
          ...input,
          hasUserContent: note.hasUserContent(),
          journalDate: identity.journalDate,
        })).note
      : await storage.notes.createInitializedNote({
          ...input,
          id: note.id,
          title: note.getTitle(),
        })
    return cache.touch({
      checkpointSequence: stored.checkpointSequence,
      createdAt: stored.createdAt,
      journalDate: identity.kind === 'journal' ? identity.journalDate : null,
      latestSequence: stored.latestSequence,
      note,
      updatedAt: stored.updatedAt,
    })
  }

  const openJournal = async (journalDate: JournalDate): Promise<{
    created: boolean
    current: AuthoritativeNote
  }> => {
    const note = createJournalNote(journalDate, defaultNoteLearningEnabled())
    const entries = note.getEntries()
    const stored = await storage.journals.getOrCreate({
      entries: entries.map(entry => structuredClone(entry)),
      hasUserContent: note.hasUserContent(),
      journalDate,
      learningCards: projectNoteLearningCards(note),
      learningReadingItems: projectNoteReadingItems(note),
      snapshot: note.exportSnapshot(),
      topics: entries
        .filter(entry => entry.kind === 'topic')
        .map(entry => structuredClone(note.getTopicContent(entry.id))),
    })
    if (stored.status === 'created') {
      return {
        created: true,
        current: await cache.touch({
          checkpointSequence: stored.note.checkpointSequence,
          createdAt: stored.note.createdAt,
          journalDate: stored.journalDate,
          latestSequence: stored.note.latestSequence,
          note,
          updatedAt: stored.note.updatedAt,
        }),
      }
    }
    return { created: false, current: await load(stored.note, undefined, stored.journalDate) }
  }

  const open = async (noteId: string): Promise<AuthoritativeNote> => {
    const cached = cache.get(noteId)
    if (cached)
      return cache.touch(cached)
    const [stored, journal] = await Promise.all([
      storage.notes.getNote({ noteId }),
      storage.journals.getMetadata({ noteId }),
    ])
    return load(stored, undefined, journal?.journalDate ?? null)
  }

  return { commit, load, open, openJournal }
}
