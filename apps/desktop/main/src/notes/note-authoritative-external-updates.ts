import type { EditorStorage } from '@memorilo/editor-storage'
import type { EditorNote } from '@memorilo/editor/note'
import type { ActiveReadingRegistry } from '../reading/active-reading-registry'
import type { SaveNoteUpdatesInput } from './note-application-contracts'
import type { AuthoritativeNote, NoteAuthoritativeCache } from './note-authoritative-cache'
import { createEditorNote, resolveJournalTopic } from '@memorilo/editor/note'
import { toError } from '@memorilo/effect-lifecycle'
import { Effect } from 'effect'
import { projectNoteAssetReferences } from '../assets/asset-references'
import {
  mergeMutation,
  toStoredEntries,
  toStoredTopic,
  updateHash,
} from './note-authoritative-projection'
import {
  assertProtectedReadingEntriesRemain,
  protectedReadingEntryIds,
} from './note-entry-protection'
import { projectNoteLearningCards, projectNoteReadingItems } from './note-learning-cards'
import { reconcileTodoParentStatusesInNote } from './todo-parent-status'

interface NoteAuthoritativeExternalUpdatesDependencies {
  activeReadings?: ActiveReadingRegistry
  autoCompleteTodoParents: () => boolean
  cache: NoteAuthoritativeCache
  commit: (note: EditorNote) => Promise<AuthoritativeNote>
  onExternalUpdate?: (update: { noteId: string, update: Uint8Array, updatedAt: number }) => void
  open: (noteId: string) => Promise<AuthoritativeNote>
  scheduleIndex: (noteId: string) => void
  storage: EditorStorage
}

export function createNoteAuthoritativeExternalUpdates({
  activeReadings,
  autoCompleteTodoParents,
  cache,
  commit,
  onExternalUpdate,
  open,
  scheduleIndex,
  storage,
}: NoteAuthoritativeExternalUpdatesDependencies): (
  input: SaveNoteUpdatesInput,
) => Effect.Effect<{ updatedAt: number }, Error> {
  return input => Effect.gen(function* () {
    if (input.updates.length === 0)
      return yield* Effect.fail(new TypeError('Note updates must contain at least one update'))
    const opened = yield* Effect.tryPromise({
      catch: toError,
      try: async () => {
        try {
          return { created: false, current: await open(input.noteId) }
        }
        catch (error) {
          const exists = (await storage.notes.listNoteIds()).includes(input.noteId)
          if (exists)
            throw error
          const [initial, ...remaining] = input.updates
          if (initial === undefined)
            throw new TypeError('A new Note requires a complete initial update')
          const note = createEditorNote({ id: input.noteId, snapshot: initial, updates: remaining })
          return { created: true, current: await commit(note) }
        }
      },
    })
    const { current } = opened
    if (opened.created) {
      if (onExternalUpdate) {
        for (const update of input.updates)
          onExternalUpdate({ noteId: current.note.id, update, updatedAt: current.updatedAt })
      }
      scheduleIndex(current.note.id)
      return { updatedAt: current.updatedAt }
    }
    const protectedEntryIds = protectedReadingEntryIds(
      current.note.getEntries(),
      activeReadings?.topicIdsForNote(input.noteId) ?? new Set(),
    )
    const changed = { entriesChanged: false, metadataChanged: false, topicIds: new Set<string>() }

    return yield* Effect.gen(function* () {
      let projectedEntries = yield* Effect.try({
        catch: toError,
        try: () => {
          input.updates.forEach(update => mergeMutation(changed, current.note.importUpdates(update)))
          const entries = current.note.getEntries()
          assertProtectedReadingEntriesRemain(protectedEntryIds, entries)
          return entries
        },
      })
      const importedVersion = current.note.getVersion()
      let autoUpdate: Uint8Array | null = null
      if (autoCompleteTodoParents() && reconcileTodoParentStatusesInNote(current.note)) {
        autoUpdate = current.note.exportUpdates(importedVersion)
        projectedEntries = current.note.getEntries()
        for (const entry of projectedEntries) {
          if (entry.kind === 'topic')
            changed.topicIds.add(entry.id)
        }
      }
      const updates = autoUpdate === null ? input.updates : [...input.updates, autoUpdate]
      yield* Effect.forEach(
        projectedEntries,
        entry => entry.kind === 'topic' ? current.note.validateTopic(entry.id) : Effect.void,
        { discard: true },
      )
      const projection = yield* Effect.try({
        catch: toError,
        try: () => {
          const journalTopic = current.journalDate === null
            ? null
            : resolveJournalTopic(current.note, { expectedNoteTitle: current.journalDate })
          const entries = changed.entriesChanged || journalTopic !== null ? projectedEntries : undefined
          const topicEntries = new Set(projectedEntries
            .filter(entry => entry.kind === 'topic')
            .map(entry => entry.id))
          const topics = (journalTopic === null ? [...changed.topicIds] : [journalTopic.topicId])
            .filter(topicId => topicEntries.has(topicId))
            .map(topicId => toStoredTopic(current.note.getTopicContent(topicId)))
          return {
            assetReferences: projectNoteAssetReferences(current.note),
            entries,
            journalTopic,
            learningCards: entries === undefined && !changed.metadataChanged
              ? projectNoteLearningCards(current.note, changed.topicIds)
              : projectNoteLearningCards(current.note),
            learningReadingItems: projectNoteReadingItems(current.note),
            topics,
          }
        },
      })
      const receipt = yield* Effect.tryPromise({
        catch: toError,
        try: () => storage.notes.saveNoteUpdates({
          allowedMissingAssetFileNames: projection.assetReferences.map(reference => reference.fileName),
          assetReferences: projection.assetReferences,
          ...(projection.entries ? { entries: toStoredEntries(projection.entries) } : {}),
          ...(projection.journalTopic === null ? {} : { journalHasUserContent: current.note.hasUserContent() }),
          learningCards: projection.learningCards,
          learningReadingItems: projection.learningReadingItems,
          noteId: current.note.id,
          ...(changed.metadataChanged || projection.journalTopic !== null ? { title: current.note.getTitle() } : {}),
          topics: projection.topics,
          updates,
        }),
      })
      current.latestSequence = receipt.latestSequence
      current.updatedAt = receipt.updatedAt
      yield* Effect.tryPromise({ catch: toError, try: () => cache.checkpointIfNeeded(current) })
      const acceptedHashes = new Set(receipt.acceptedUpdateHashes)
      if (acceptedHashes.size > 0)
        scheduleIndex(current.note.id)
      if (onExternalUpdate) {
        for (const update of updates) {
          const hash = updateHash(update)
          if (!acceptedHashes.delete(hash))
            continue
          try {
            onExternalUpdate({ noteId: current.note.id, update, updatedAt: current.updatedAt })
          }
          catch (error) {
            console.error(`Failed to broadcast persisted update for Note ${current.note.id}`, error)
          }
        }
      }
      return { updatedAt: current.updatedAt }
    }).pipe(Effect.catchEager((error) => {
      cache.invalidate(input.noteId)
      return Effect.fail(error)
    }))
  })
}
