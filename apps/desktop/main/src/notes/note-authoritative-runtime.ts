import type {
  EditorStorage,
  JournalDate,
  StoredNote,
} from '@memorilo/editor-storage'
import type {
  EditorNote,
  EditorNoteVersion,
} from '@memorilo/editor/note'
import type { Effect } from 'effect'
import type { ActiveReadingRegistry } from '../reading/active-reading-registry'
import type { SaveNoteUpdatesInput } from './note-application-contracts'
import type { AuthoritativeNote } from './note-authoritative-cache'
import { resolveJournalTopic } from '@memorilo/editor/note'
import {
  createOperationSupervisor,
  createResourceScope,
} from '@memorilo/effect-lifecycle'
import { projectNoteAssetReferences } from '../assets/asset-references'
import { createNoteAuthoritativeCache } from './note-authoritative-cache'
import { createNoteAuthoritativeExternalUpdates } from './note-authoritative-external-updates'
import { createNoteAuthoritativeLoading } from './note-authoritative-loading'
import {
  noteRevision,
  toStoredEntries,
  toStoredTopic,
} from './note-authoritative-projection'
import { projectNoteLearningCards, projectNoteReadingItems } from './note-learning-cards'
import { reconcileTodoParentStatusesInNote } from './todo-parent-status'

const checkpointInterval = 32
const noteCacheCapacity = 64

export class NoteApplicationServiceClosedError extends Error {
  override readonly name = 'NoteApplicationServiceClosedError'

  constructor() {
    super('The Note application service is closing')
  }
}

export interface NoteAuthoritativeRuntime {
  applyExternalUpdates: (input: SaveNoteUpdatesInput) => Effect.Effect<{ updatedAt: number }, Error>
  close: () => Promise<void>
  commit: (note: EditorNote) => Promise<AuthoritativeNote>
  invalidate: (noteId: string) => void
  load: (
    stored: StoredNote,
    initialTopicHeading?: string,
    journalDate?: JournalDate | null,
  ) => Promise<AuthoritativeNote>
  open: (noteId: string) => Promise<AuthoritativeNote>
  openJournal: (journalDate: JournalDate) => Promise<{ created: boolean, current: AuthoritativeNote }>
  persistLocalMutation: (
    current: AuthoritativeNote,
    version: readonly EditorNoteVersion[],
    options: PersistLocalMutationOptions,
  ) => Promise<{ noteId: string, revision: string, update: Uint8Array, updatedAt: number }>
  prunePastEmptyJournals: () => Promise<Awaited<ReturnType<EditorStorage['journals']['prunePastEmpty']>>>
  run: <Result>(operation: () => Promise<Result>) => Promise<Result>
  runEffect: <Result, Failure>(operation: Effect.Effect<Result, Failure>) => Promise<Result>
}

interface PersistLocalMutationOptions {
  broadcast?: boolean
  entries?: boolean
  title?: boolean
  topicIds?: readonly string[]
}

interface CreateNoteAuthoritativeRuntimeOptions {
  activeReadings?: ActiveReadingRegistry
  autoCompleteTodoParents?: () => boolean
  defaultNoteLearningEnabled: () => boolean
  onExternalUpdate?: (update: { noteId: string, update: Uint8Array, updatedAt: number }) => void
  storage: EditorStorage
  today: () => JournalDate
}

async function indexNote(storage: EditorStorage, noteId: string): Promise<void> {
  let hasPending: boolean
  do {
    ({ hasPending } = await storage.search.indexPendingEmbeddings({ limit: 256, noteId }))
  } while (hasPending)
}

export function createNoteAuthoritativeRuntime(
  options: CreateNoteAuthoritativeRuntimeOptions,
): NoteAuthoritativeRuntime {
  const {
    activeReadings,
    autoCompleteTodoParents = () => true,
    defaultNoteLearningEnabled,
    onExternalUpdate,
    storage,
    today,
  } = options
  const cache = createNoteAuthoritativeCache({
    capacity: noteCacheCapacity,
    checkpointInterval,
    storage,
    onCheckpointFailure: (current, error) => {
      console.error(`Failed to checkpoint Note ${current.note.id}; the persisted update log remains authoritative`, error)
    },
  })
  const operations = createOperationSupervisor(
    'Note application service',
    { closedError: () => new NoteApplicationServiceClosedError() },
  )
  const indexing = createOperationSupervisor('Note indexing')
  const finalizer = createResourceScope('Note application service')

  const scheduleIndex = (noteId: string): void => {
    void indexing.run(() => indexNote(storage, noteId))
      .catch(error => console.error(`Failed to index Note ${noteId}`, error))
  }

  const loading = createNoteAuthoritativeLoading({ cache, defaultNoteLearningEnabled, storage })
  const { commit: commitStored, load, open, openJournal: openStoredJournal } = loading

  const broadcastCreatedNote = (current: AuthoritativeNote): void => {
    if (!onExternalUpdate)
      return
    try {
      onExternalUpdate({
        noteId: current.note.id,
        update: current.note.exportUpdates(),
        updatedAt: current.updatedAt,
      })
    }
    catch (error) {
      console.error(`Failed to broadcast created Note ${current.note.id}`, error)
    }
  }

  const commit = async (note: EditorNote): Promise<AuthoritativeNote> => {
    const current = await commitStored(note)
    broadcastCreatedNote(current)
    return current
  }

  const openJournal = async (journalDate: JournalDate) => {
    const opened = await openStoredJournal(journalDate)
    if (opened.created)
      broadcastCreatedNote(opened.current)
    return opened
  }

  const persistLocalMutation = async (
    current: AuthoritativeNote,
    version: readonly EditorNoteVersion[],
    persistOptions: PersistLocalMutationOptions,
  ) => {
    if (autoCompleteTodoParents())
      reconcileTodoParentStatusesInNote(current.note, persistOptions.topicIds)
    const journalTopic = current.journalDate === null
      ? null
      : resolveJournalTopic(current.note, { expectedNoteTitle: current.journalDate })
    const update = current.note.exportUpdates(version)
    const assetReferences = projectNoteAssetReferences(current.note)
    const receipt = await storage.notes.saveNoteUpdates({
      allowedMissingAssetFileNames: assetReferences.map(reference => reference.fileName),
      assetReferences,
      ...(persistOptions.entries || journalTopic !== null ? { entries: toStoredEntries(current.note.getEntries()) } : {}),
      ...(journalTopic === null ? {} : { journalHasUserContent: current.note.hasUserContent() }),
      ...((persistOptions.entries || journalTopic !== null)
        ? { learningCards: projectNoteLearningCards(current.note), learningReadingItems: projectNoteReadingItems(current.note) }
        : persistOptions.topicIds === undefined
          ? {}
          : { learningCards: projectNoteLearningCards(current.note, persistOptions.topicIds), learningReadingItems: projectNoteReadingItems(current.note) }),
      noteId: current.note.id,
      ...(persistOptions.title || journalTopic !== null ? { title: current.note.getTitle() } : {}),
      topics: (journalTopic === null ? persistOptions.topicIds ?? [] : [journalTopic.topicId])
        .map(topicId => toStoredTopic(current.note.getTopicContent(topicId))),
      updates: [update],
    })
    current.latestSequence = receipt.latestSequence
    current.updatedAt = receipt.updatedAt
    await cache.checkpointIfNeeded(current)
    if (receipt.acceptedUpdateHashes.length > 0)
      scheduleIndex(current.note.id)
    if (persistOptions.broadcast && receipt.acceptedUpdateHashes.length > 0 && onExternalUpdate) {
      try {
        onExternalUpdate({ noteId: current.note.id, update, updatedAt: current.updatedAt })
      }
      catch (error) {
        console.error(`Failed to broadcast persisted update for Note ${current.note.id}`, error)
      }
    }
    return {
      noteId: current.note.id,
      revision: noteRevision(current.note.getVersion()),
      update,
      updatedAt: current.updatedAt,
    }
  }

  const applyExternalUpdates = createNoteAuthoritativeExternalUpdates({
    activeReadings,
    autoCompleteTodoParents,
    cache,
    commit: commitStored,
    onExternalUpdate,
    open,
    scheduleIndex,
    storage,
  })

  const prunePastEmptyJournals = async () => {
    const result = await storage.journals.prunePastEmpty({ before: today() })
    result.deletedNoteIds.forEach(noteId => cache.invalidate(noteId))
    return result
  }

  finalizer.own({ close: () => operations.close(), name: 'Note operations' })
  finalizer.own({
    close: async () => {
      await cache.flush()
      await cache.clear()
    },
    name: 'Note cache',
  })
  finalizer.own({ close: () => indexing.close(), name: 'Note indexing' })
  finalizer.own({
    close: async () => {
      await prunePastEmptyJournals()
    },
    name: 'past Journal pruning',
  })
  finalizer.commit()

  const close = finalizer.close

  return {
    applyExternalUpdates,
    close,
    commit,
    invalidate: noteId => cache.invalidate(noteId),
    load,
    open,
    openJournal,
    persistLocalMutation,
    prunePastEmptyJournals,
    run: operation => operations.run(operation),
    runEffect: operation => operations.runEffect(operation),
  }
}
