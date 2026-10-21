import type { DesktopRegularNote, JournalDate } from '@memorilo/desktop-api'
import type { ImageOcclusionSnapshot, OpenImageOcclusionInput } from '@memorilo/editor'
import type { ShelfReadingFormat } from '@memorilo/shelf'
import type { MarkdownImportValues } from '../markdown-import-dialog'
import type { BookPickerTarget, EntryActionTarget, EntryCreationTarget, ShelfBookOption } from './note-editor-dialogs'
import { EditorMode } from '@memorilo/editor'
import * as stylex from '@stylexjs/stylex'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'

import { desktopRequests } from '../../../shared/desktop-requests'
import { MarkdownImportDialog } from '../markdown-import-dialog'
import { runNoteExport } from '../note-transfer-operation'
import { noteQueryKeys } from '../query-keys'
import { BookTopicPickerDialog, EntryCreationDialog, EntryDeleteDialog } from './note-editor-dialogs'
import { useEditorNoteSession } from './note-editor-session'
import { NoteEditorView } from './note-editor-view'
import { useNoteMetadata } from './note-metadata'
import { noteSharedStyles } from './note-shared.stylex'

async function snapshotImage(image: ImageOcclusionSnapshot): Promise<ImageOcclusionSnapshot> {
  const source = new URL(image.src)
  if (source.protocol === 'blob:')
    throw new Error('The image is still uploading')
  if (source.protocol !== 'http:' && source.protocol !== 'https:')
    return image
  const imported = await desktopRequests.importNetworkImage({ source: source.toString() })
  return { ...image, src: imported.src }
}

export function NoteEditor({
  collapsedEntryIds,
  focusBlockId,
  noteId,
  onOpenJournal,
  onOpenTopic,
  onToggleEntry,
  topicId,
}: {
  collapsedEntryIds: ReadonlySet<string>
  focusBlockId?: string
  noteId: string
  onOpenJournal: (journalDate: JournalDate) => Promise<void>
  onOpenTopic: (topicId: string) => Promise<void>
  onToggleEntry: (entryId: string) => void
  topicId: string
}) {
  const { t } = useTranslation(['editor', 'pages'])
  const queryClient = useQueryClient()
  const [bookPickerTarget, setBookPickerTarget] = useState<BookPickerTarget | undefined>(undefined)
  const [entryCreationTarget, setEntryCreationTarget] = useState<EntryCreationTarget | undefined>(undefined)
  const [entryDeleteTarget, setEntryDeleteTarget] = useState<EntryActionTarget | undefined>(undefined)
  const [exporting, setExporting] = useState(false)
  const [transferOperationId, setTransferOperationId] = useState<string | null>(null)
  const [markdownImport, setMarkdownImport] = useState<{ fileName: string, parentId: string | null, source: string } | null>(null)
  const markdownImportParentId = useRef<string | null>(null)
  const markdownFileInputRef = useRef<HTMLInputElement>(null)
  const loadNote = useCallback(async (): Promise<DesktopRegularNote> => {
    const stored = await desktopRequests.getNote({ noteId })
    if (stored.kind === 'journal') {
      await onOpenJournal(stored.journalDate)
      throw new Error(`Journal ${stored.journalDate} must open in the Journal feed`)
    }
    return stored
  }, [noteId, onOpenJournal])
  const handleExternalUpdate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: noteQueryKeys.lists })
  }, [queryClient])
  const handleExport = useCallback(async (format: 'memo' | 'pdf') => {
    if (exporting) {
      return
    }
    setExporting(true)
    try {
      const result = await runNoteExport(format, noteId, undefined, undefined, setTransferOperationId)
      if (result.phase === 'saved') {
        if (result.result.diagnostics.length > 0)
          toast.warning(`${result.result.path}\n${result.result.diagnostics.map(diagnostic => diagnostic.message).join('\n')}`, { autoClose: 10_000 })
        else
          toast.success(result.result.path, { autoClose: 5_000 })
      }
      else if (result.phase === 'failed') {
        throw new Error(result.error.message)
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setTransferOperationId(null)
      setExporting(false)
    }
  }, [exporting, noteId])
  const cancelExport = useCallback(() => {
    if (transferOperationId === null)
      return
    void desktopRequests.cancelNoteTransfer(transferOperationId).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }, [transferOperationId])
  const session = useEditorNoteSession<DesktopRegularNote>({
    loadNote,
    noteId,
    onExternalUpdate: handleExternalUpdate,
    topicId,
  })
  const { loadError, opened, saveError, updateStored, validationError } = session
  const metadata = useNoteMetadata(opened, updateStored)
  const openedNoteId = opened?.note.id
  const openedTopicId = opened?.topic.topicId

  useEffect(() => {
    if (!openedNoteId || !openedTopicId)
      return
    const recording = desktopRequests.recordNoteOpened({
      noteId: openedNoteId,
      topicId: openedTopicId,
    }).then(() => queryClient.invalidateQueries({ queryKey: noteQueryKeys.recent }))
    void recording.then(undefined, error => console.error('Failed to record opened Note', error))
  }, [openedNoteId, openedTopicId, queryClient])

  const handleCreateBookTopic = useCallback(async (
    option: ShelfBookOption,
    format: ShelfReadingFormat,
    parentId: string | null,
  ) => {
    if (!opened)
      throw new Error('The Note is no longer open')
    const prepared = await desktopRequests.prepareShelfReading({
      format,
      publicationId: option.publication.id,
      retention: 'library',
      sourceId: option.source.id,
    })
    opened.note.createBookTopic({
      book: prepared.book,
      mode: EditorMode.Document,
      parentId,
      title: option.publication.title,
    })
    setBookPickerTarget(undefined)
    toast.success(t('bookTopicCreated', { ns: 'editor' }), { autoClose: 5_000 })
  }, [opened, t])

  const handleCreateEntry = useCallback((target: EntryCreationTarget, label: string) => {
    if (!opened)
      throw new Error('The Note is no longer open')
    if (target.kind === 'folder')
      opened.note.createFolder({ name: label, parentId: target.parentId })
    else if (target.kind === 'whiteboard')
      opened.note.createWhiteboardTopic({ parentId: target.parentId, title: label })
    else
      opened.note.createTopic({ mode: EditorMode.Document, parentId: target.parentId, title: label })
    setEntryCreationTarget(undefined)
  }, [opened])

  const handleImportMarkdown = useCallback((parentId: string | null) => {
    markdownImportParentId.current = parentId
    markdownFileInputRef.current?.click()
  }, [])
  const findEntryActionTarget = useCallback((entryId: string): EntryActionTarget => {
    if (!opened)
      throw new Error('The Note is no longer open')
    const entry = opened.entries.find(candidate => candidate.id === entryId)
    if (!entry)
      throw new Error(`Note entry ${entryId} was not found`)
    return {
      entryId,
      kind: entry.kind === 'folder' ? 'folder' : 'topic',
      label: entry.kind === 'folder' ? entry.name : entry.title,
    }
  }, [opened])
  const requestDeleteEntry = useCallback((entryId: string) => {
    setEntryDeleteTarget(findEntryActionTarget(entryId))
  }, [findEntryActionTarget])
  const deleteEntry = useCallback(() => {
    if (!opened || !entryDeleteTarget)
      throw new Error('The Note is no longer open')
    const descendants = new Set<string>([entryDeleteTarget.entryId])
    let changed = true
    while (changed) {
      changed = false
      for (const entry of opened.entries) {
        if (entry.parentId !== null && descendants.has(entry.parentId) && !descendants.has(entry.id)) {
          descendants.add(entry.id)
          changed = true
        }
      }
    }
    const nextTopic = opened.entries.find(entry => entry.kind === 'topic' && !descendants.has(entry.id))
    if (!nextTopic)
      throw new Error(t('cannotDeleteLastTopic'))
    opened.note.deleteEntry({ entryId: entryDeleteTarget.entryId, strategy: 'delete-subtree' })
    setEntryDeleteTarget(undefined)
    if (descendants.has(opened.topic.topicId))
      void onOpenTopic(nextTopic.id)
  }, [entryDeleteTarget, onOpenTopic, opened, t])
  const confirmMarkdownImport = useCallback(async (values: MarkdownImportValues) => {
    if (!opened || !markdownImport)
      throw new Error('The Note is no longer open')
    const topicId = opened.note.createTopic({
      initialContent: values.document as Parameters<typeof opened.note.createTopic>[0]['initialContent'],
      mode: EditorMode.Document,
      parentId: markdownImport.parentId,
      title: values.topicTitle,
    })
    setMarkdownImport(null)
    if (values.diagnostics.length > 0)
      toast.warning(values.diagnostics.map(diagnostic => `L${diagnostic.line}: ${diagnostic.message}`).join('\n'), { autoClose: 10_000 })
    await onOpenTopic(topicId)
  }, [markdownImport, onOpenTopic, opened])

  const handleOpenImageOcclusion = useCallback(async ({ image, imageId }: OpenImageOcclusionInput) => {
    if (!opened)
      throw new Error('The Note is no longer open')
    const sourceTopicId = opened.topic.topicId
    const source = { imageId, kind: 'topic-image' as const, topicId: sourceTopicId }
    const existing = opened.note.findImageOcclusionTopic(source)
    if (existing) {
      await onOpenTopic(existing.topicId)
      return
    }
    const topicId = await opened.note.createImageOcclusionTopic({
      snapshot: async (resolved) => {
        if (resolved.kind !== 'topic-image')
          throw new TypeError('Expected a Topic image source')
        return snapshotImage({ ...image, src: resolved.src })
      },
      source,
      title: t('imageOcclusion.defaultTitle', { ns: 'editor' }),
    })
    await onOpenTopic(topicId)
  }, [onOpenTopic, opened, t])

  const handleRebindBookTopic = useCallback(async (
    option: ShelfBookOption,
    format: ShelfReadingFormat,
    topicId: string,
  ) => {
    if (!opened)
      throw new Error('The Note is no longer open')
    const bookTopic = opened.note.getBookTopic(topicId)
    const currentBook = bookTopic.getBook()
    if (format !== currentBook.file.format)
      throw new Error(`BookTopic format must remain ${currentBook.file.format}`)
    const prepared = await desktopRequests.prepareShelfReading({
      format,
      publicationId: option.publication.id,
      retention: 'library',
      sourceId: option.source.id,
    })
    bookTopic.rebind(prepared.book)
    setBookPickerTarget(undefined)
    toast.warning(t('bookTopicRebound', { ns: 'editor' }))
  }, [opened, t])

  if (loadError) {
    return (
      <main {...stylex.props(noteSharedStyles.statusPage)}>
        <p {...stylex.props(noteSharedStyles.statusMessage, noteSharedStyles.errorMessage)} role="alert">
          {t('failedToOpenNote', { message: loadError })}
        </p>
      </main>
    )
  }
  if (!opened) {
    return (
      <main {...stylex.props(noteSharedStyles.statusPage)}>
        <p {...stylex.props(noteSharedStyles.statusMessage)} role="status">{t('openingNote')}</p>
      </main>
    )
  }

  return (
    <>
      <NoteEditorView
        applyExternal={session.applyExternal}
        collapsedEntryIds={collapsedEntryIds}
        favoritePending={metadata.favoritePending}
        exporting={exporting}
        onCancelExport={cancelExport}
        focusBlockId={focusBlockId}
        onAddBook={parentId => setBookPickerTarget({ kind: 'create', parentId })}
        onAddFolder={parentId => setEntryCreationTarget({ kind: 'folder', parentId })}
        onImportMarkdown={handleImportMarkdown}
        onAddTopic={parentId => setEntryCreationTarget({ kind: 'topic', parentId })}
        onAddWhiteboard={parentId => setEntryCreationTarget({ kind: 'whiteboard', parentId })}
        onOpenImageOcclusion={handleOpenImageOcclusion}
        onOpenTopic={onOpenTopic}
        onRebindBook={(topicId) => {
          const format = opened.note.getBookTopic(topicId).getBook().file.format
          setBookPickerTarget({ format, kind: 'rebind', topicId })
        }}
        onDeleteEntry={requestDeleteEntry}
        onExport={handleExport}
        onRenameNote={metadata.renameNote}
        onToggleEntry={onToggleEntry}
        onToggleFavorite={metadata.toggleFavorite}
        opened={opened}
        saveError={saveError}
        validationError={validationError}
      />
      {bookPickerTarget !== undefined
        ? (
            <BookTopicPickerDialog
              mode={bookPickerTarget.kind}
              requiredFormat={bookPickerTarget.kind === 'rebind' ? bookPickerTarget.format : undefined}
              onClose={() => setBookPickerTarget(undefined)}
              onCreate={(option, format) => bookPickerTarget.kind === 'create'
                ? handleCreateBookTopic(option, format, bookPickerTarget.parentId)
                : handleRebindBookTopic(option, format, bookPickerTarget.topicId)}
            />
          )
        : null}
      {entryCreationTarget !== undefined
        ? (
            <EntryCreationDialog
              kind={entryCreationTarget.kind}
              onClose={() => setEntryCreationTarget(undefined)}
              onCreate={label => handleCreateEntry(entryCreationTarget, label)}
            />
          )
        : null}
      {entryDeleteTarget !== undefined
        ? <EntryDeleteDialog target={entryDeleteTarget} onClose={() => setEntryDeleteTarget(undefined)} onDelete={deleteEntry} />
        : null}
      <input
        ref={markdownFileInputRef}
        accept=".md,.markdown,text/markdown"
        hidden
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file)
            return
          const parentId = markdownImportParentId.current
          void file.text().then(source => setMarkdownImport({ fileName: file.name, parentId, source }))
        }}
      />
      {markdownImport
        ? <MarkdownImportDialog fileName={markdownImport.fileName} onClose={() => setMarkdownImport(null)} onConfirm={confirmMarkdownImport} source={markdownImport.source} target="topic" />
        : null}
    </>
  )
}
