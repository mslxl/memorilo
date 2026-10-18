import type { DesktopNoteSearchHit } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import type { LucideIcon } from 'lucide-react'
import type { PaletteCommand, ResultAccent } from '../../shared/command-palette'
import { CalendarDays, FilePlus2, FileText, ListTree } from 'lucide-react'

import { formatJournalHeading } from '../../features/journals/journal-model'

export interface PaletteResult {
  accent: ResultAccent
  action: string
  description: string
  disabled?: boolean
  icon: LucideIcon
  id: string
  label: string
  run: () => Promise<void> | void
}

export interface CommandPaletteNavigation {
  openJournal: (
    date: Extract<DesktopNoteSearchHit, { noteKind: 'journal' }>['journalDate'],
  ) => Promise<void>
  openNote: (noteId: string) => Promise<void>
  openTopic: (input: {
    blockId: string | null
    noteId: string
    topicId: string
  }) => Promise<void>
}

export interface CommandPaletteSearchProjection {
  hasQuery: boolean
  results: readonly PaletteResult[]
  searchFailed: boolean
  searchPending: boolean
  selected: PaletteResult | undefined
}

interface ProjectCommandPaletteSearchOptions {
  commands: readonly PaletteCommand[]
  createNote: (title: string) => Promise<void> | void
  createNotePending: boolean
  deferredQuery: string
  hits: readonly DesktopNoteSearchHit[] | undefined
  navigation: CommandPaletteNavigation
  normalizedQuery: string
  searchError: boolean
  searchFetching: boolean
  selectedId: string | null
  t: TFunction
  trimmedQuery: string
}

function matchesQuery(command: PaletteCommand, normalizedQuery: string): boolean {
  // Stable command IDs keep keyboard palette flows usable across localized labels.
  return [command.id, command.label, command.description, command.section, ...command.keywords]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

function searchMatchLabel(hit: DesktopNoteSearchHit, t: TFunction): string {
  if (hit.match === 'title')
    return t(hit.kind === 'note' ? 'noteTitleMatch' : 'topicTitleMatch')
  return t(({
    'node-start': 'nodeStartsWith',
    'content': 'contentMatch',
    'semantic': 'relatedMeaning',
  } as const)[hit.match])
}

function searchResultDescription(hit: DesktopNoteSearchHit, t: TFunction): string {
  const match = searchMatchLabel(hit, t)
  const noteTitle = hit.noteKind === 'journal'
    ? formatJournalHeading(hit.journalDate)
    : hit.noteTitle
  if (hit.kind === 'note')
    return match
  if (hit.match === 'title')
    return `${match} · ${noteTitle}`
  return `${match} · ${hit.preview} · ${noteTitle}`
}

function toSearchResult(
  hit: DesktopNoteSearchHit,
  navigation: CommandPaletteNavigation,
  t: TFunction,
): PaletteResult {
  if (hit.noteKind === 'journal') {
    return {
      accent: 'blue',
      action: t('open'),
      description: searchResultDescription(hit, t),
      icon: CalendarDays,
      id: `${hit.kind}:${hit.noteId}${hit.kind === 'topic' ? `:${hit.topicId}` : ''}`,
      label: formatJournalHeading(hit.journalDate),
      run: () => navigation.openJournal(hit.journalDate),
    }
  }

  if (hit.kind === 'note') {
    return {
      accent: 'blue',
      action: t('open'),
      description: searchResultDescription(hit, t),
      icon: FileText,
      id: `note:${hit.noteId}`,
      label: hit.noteTitle,
      run: () => navigation.openNote(hit.noteId),
    }
  }

  return {
    accent: 'violet',
    action: t('open'),
    description: searchResultDescription(hit, t),
    icon: ListTree,
    id: `topic:${hit.noteId}:${hit.topicId}`,
    label: hit.topicTitle,
    run: () => navigation.openTopic({
      blockId: hit.blockId,
      noteId: hit.noteId,
      topicId: hit.topicId,
    }),
  }
}

export function projectCommandPaletteSearch({
  commands,
  createNote,
  createNotePending,
  deferredQuery,
  hits,
  navigation,
  normalizedQuery,
  searchError,
  searchFetching,
  selectedId,
  t,
  trimmedQuery,
}: ProjectCommandPaletteSearchOptions): CommandPaletteSearchProjection {
  const hasQuery = normalizedQuery.length > 0
  const current = deferredQuery === normalizedQuery
  const matchingCommands = hasQuery
    ? commands.filter(command => matchesQuery(command, normalizedQuery))
    : []
  const noteResults = current
    ? (hits ?? []).map(hit => toSearchResult(hit, navigation, t))
    : []
  const searchPending = hasQuery && (!current || searchFetching)
  const searchFailed = hasQuery && current && searchError
  const hasLiteralNoteResult = current && hits?.some(hit => hit.match !== 'semantic') === true
  const canCreateNote = hasQuery
    && current
    && !searchPending
    && !searchFailed
    && matchingCommands.length === 0
    && !hasLiteralNoteResult
  const createResult: PaletteResult[] = canCreateNote
    ? [{
        accent: 'blue',
        action: t('create'),
        description: t('createNoteDescription'),
        disabled: createNotePending,
        icon: FilePlus2,
        id: 'create-note',
        label: t('createNoteLabel', { query: trimmedQuery }),
        run: () => createNote(trimmedQuery),
      }]
    : []
  const results = [...matchingCommands, ...createResult, ...noteResults]
  const selectedMatch = results.find(result => result.id === selectedId)

  return {
    hasQuery,
    results,
    searchFailed,
    searchPending,
    selected: hasQuery ? selectedMatch ?? results[0] : undefined,
  }
}
