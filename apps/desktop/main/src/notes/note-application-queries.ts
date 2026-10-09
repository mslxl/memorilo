import type { EditorStorage, JournalDate } from '@memorilo/editor-storage'
import type {
  GetNoteCardProjectionInput,
  ListJournalDatesInput,
  ListPastJournalsInput,
} from './note-application-contracts'
import type { NoteAuthoritativeRuntime } from './note-authoritative-runtime'
import { projectEditorCards, projectImageOcclusionCards } from '@memorilo/editor/card'
import { projectCardTopicCards } from '@memorilo/editor/note'
import { NoteCardProjectionNotFoundError } from './note-application-contracts'
import {
  projectApplicationNote,
  projectBookTopicReadingContext,
  projectNoteActivity,
  projectNoteSearchHit,
  projectStoredNoteSummary,
} from './note-application-projection'
import { noteRevision } from './note-authoritative-projection'

type AuthoritativeNote = Awaited<ReturnType<NoteAuthoritativeRuntime['open']>>['note']
type TopicDocument = Extract<ReturnType<AuthoritativeNote['getTopicValidationInput']>, { document: unknown }>['document']

function topicDocuments(note: AuthoritativeNote, topicId: string): readonly TopicDocument[] {
  const validation = note.getTopicValidationInput(topicId)
  if ('document' in validation)
    return [validation.document]
  if ('embeddedEditors' in validation)
    return Object.values(validation.embeddedEditors).map(editor => editor.document)
  throw new TypeError(`ImageOcclusionTopic ${topicId} does not have ProseMirror documents`)
}

interface NoteApplicationQueriesDependencies {
  runtime: Pick<NoteAuthoritativeRuntime, 'load' | 'open' | 'run'>
  storage: EditorStorage
  today: () => JournalDate
}

export function createNoteApplicationQueries({ runtime, storage, today }: NoteApplicationQueriesDependencies) {
  const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => runtime.run(operation)
  return {
    getDeleteNoteImpact: (input: Parameters<EditorStorage['notes']['getDeleteNoteImpact']>[0]) => serialize(() => storage.notes.getDeleteNoteImpact(input)),
    getBookTopicReadingContext: (input: { noteId: string, topicId: string }) => serialize(async () => (
      projectBookTopicReadingContext(storage, await runtime.open(input.noteId), input.topicId)
    )),
    getCardProjection: (input: GetNoteCardProjectionInput) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      const entry = current.note.getEntries().find(candidate => candidate.id === input.topicId)
      if (!entry || entry.kind !== 'topic')
        throw new NoteCardProjectionNotFoundError(input.noteId, input.topicId, input.cardId)
      const cards = entry.topicType === 'image-occlusion'
        ? projectImageOcclusionCards(current.note.getImageOcclusionTopic(entry.id).getState())
        : entry.topicType === 'regular'
          ? entry.cardSource === undefined
            ? []
            : (() => {
                const source = entry.cardSource
                return topicDocuments(current.note, input.topicId).flatMap(document => projectCardTopicCards(document, source))
              })()
          : topicDocuments(current.note, input.topicId).flatMap(document => projectEditorCards(document))
      const card = cards
        .find(candidate => candidate.id === input.cardId)
      if (!card)
        throw new NoteCardProjectionNotFoundError(input.noteId, input.topicId, input.cardId)
      return { card, noteTitle: current.note.getTitle(), topicTitle: entry.title, updatedAt: current.updatedAt }
    }),
    getNote: (input: Parameters<EditorStorage['notes']['getNote']>[0]) => serialize(async () => (
      projectApplicationNote(storage, await runtime.open(input.noteId))
    )),
    getNoteTree: (input: { noteId: string }) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      const base = {
        entries: current.note.getEntries(),
        noteId: current.note.id,
        revision: noteRevision(current.note.getVersion()),
        title: current.note.getTitle(),
        updatedAt: current.updatedAt,
      }
      return current.journalDate === null
        ? { ...base, kind: 'regular' as const }
        : { ...base, journalDate: current.journalDate, kind: 'journal' as const }
    }),
    getTopic: (input: { noteId: string, topicId: string }) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      const entry = current.note.getEntries().find(candidate => candidate.id === input.topicId)
      if (!entry || entry.kind !== 'topic')
        throw new Error(`Note ${input.noteId} does not contain Topic ${input.topicId}`)
      const validation = current.note.getTopicValidationInput(input.topicId)
      if (!('document' in validation))
        throw new Error(`Topic ${input.topicId} does not have a single editable document`)
      if (!('mode' in entry))
        throw new Error(`Topic ${input.topicId} does not have a single editor mode`)
      return {
        document: validation.document,
        mode: entry.mode,
        noteId: current.note.id,
        revision: noteRevision(current.note.getVersion()),
        title: entry.title,
        topicId: input.topicId,
        updatedAt: current.updatedAt,
      }
    }),
    getTopicBlock: (input: Parameters<EditorStorage['search']['getTopicBlock']>[0]) => serialize(() => storage.search.getTopicBlock(input)),
    listFavoriteNotes: (input: Parameters<EditorStorage['notes']['listFavoriteNotes']>[0] = {}) => serialize(async () => (
      (await storage.notes.listFavoriteNotes({ ...input, today: today() })).map(projectNoteActivity)
    )),
    listJournalDates: (input: ListJournalDatesInput) => serialize(() => storage.journals.listDates(input)),
    listNotes: (input: Parameters<EditorStorage['notes']['listNotes']>[0] = {}) => serialize(async () => {
      const page = await storage.notes.listNotes({ ...input, today: today() })
      return { ...page, items: page.items.map(projectStoredNoteSummary) }
    }),
    listPastJournals: (input: ListPastJournalsInput = {}) => serialize(async () => {
      const page = await storage.journals.listPast({
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        today: today(),
      })
      return { items: page.items.map(item => ({ ...item, kind: 'journal' as const })), nextCursor: page.nextCursor }
    }),
    listRecentNotes: (input: Parameters<EditorStorage['notes']['listRecentNotes']>[0] = {}) => serialize(async () => (
      (await storage.notes.listRecentNotes({ ...input, today: today() })).map(projectNoteActivity)
    )),
    listTodoTasks: (input: Parameters<EditorStorage['tasks']['list']>[0] = {}) => serialize(() => (
      storage.tasks.list(input)
    )),
    openMostRecentNote: () => serialize(async () => {
      const stored = await storage.notes.openMostRecentNote({ today: today() })
      const journal = await storage.journals.getMetadata({ noteId: stored.id })
      return projectApplicationNote(storage, await runtime.load(stored, undefined, journal?.journalDate ?? null))
    }),
    searchNotes: (input: Parameters<EditorStorage['search']['searchNotes']>[0]) => serialize(async () => (
      (await storage.search.searchNotes({ ...input, today: today() })).map(projectNoteSearchHit)
    )),
    searchTopicBlocks: (input: Parameters<EditorStorage['search']['searchTopicBlocks']>[0]) => serialize(() => (
      storage.search.searchTopicBlocks({ ...input, today: today() })
    )),
  }
}
