import type {
  DesktopNoteExternalUpdate,
} from '@memorilo/desktop-api'
import type {
  EditorImageOcclusionIntegration,
  EditorImageOcclusionTopicDocument,
  EditorNote,
  EditorOpenedTopic,
  OpenImageOcclusionInput,
} from '@memorilo/editor'
import type { ComponentProps } from 'react'
import type { PaletteCommand } from '../../../shared/command-palette'
import type { EditorNoteSessionOpened, TopicValidationError } from './note-editor-session'
import { Editor, EditorMode, projectCardTopicCards, useEditorTopicMode } from '@memorilo/editor'
import { readerAnnotationLabel } from '@memorilo/editor/reader'
import * as stylex from '@stylexjs/stylex'
import { AlignLeft, Copy, ListTree } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'
import { useCommandPaletteCommands } from '../../../shared/command-palette'
import { useDesktopConfiguration } from '../../../shared/configuration'
import { errorMessage } from '../../../shared/error-message'
import { matchesKeyboardShortcut } from '../../../shared/keyboard-shortcut'
import { usePageTitlebar } from '../../../shared/page-titlebar'
import { getPlatform } from '../../../shared/platform'
import { projectVisibleNoteEntries, selectAdjacentVisibleId } from '../note-entry-tree'
import { NoteExportMenu } from '../note-export-menu'
import { NoteInspector } from '../note-inspector'
import { NoteInspectorActions } from '../note-inspector-actions'
import { useNoteInspectorVisibility } from '../note-inspector-state'
import { useFlushNotePersistence } from '../persistence/note-persistence-hooks'
import { desktopEditorAdapters } from './note-editor-session'
import { CardTopicPreview, ReaderSourceHeader } from './note-editor-topic-chrome'
import { noteEditorStyles } from './note-editor.stylex'
import { useNoteEntryContextMenu } from './note-entry-context-menu'
import { WhiteboardEditor } from './whiteboard-editor'

const ImageOcclusionTopicEditor = lazy(async () => {
  const module = await import('./image-occlusion-editor')
  return { default: module.ImageOcclusionEditor }
})

type CopyStatus = 'copied' | 'failed'

interface CopyFeedback {
  diagnostics: string
  status: CopyStatus
}

function isImageOcclusionTopic(
  topic: EditorOpenedTopic,
): topic is EditorImageOcclusionTopicDocument {
  return 'getState' in topic
}

export interface NoteEditorViewProps {
  applyExternal: (external: DesktopNoteExternalUpdate) => boolean
  collapsedEntryIds: ReadonlySet<string>
  exporting: boolean
  favoritePending: boolean
  focusBlockId?: string
  onAddBook: (parentId: string | null) => void
  onAddFolder: (parentId: string | null) => void
  onImportMarkdown: (parentId: string | null) => void
  onAddTopic: (parentId: string | null) => void
  onAddWhiteboard: (parentId: string | null) => void
  onOpenImageOcclusion: (input: OpenImageOcclusionInput) => Promise<void> | void
  onOpenTopic: (topicId: string) => Promise<void>
  onRebindBook: (topicId: string) => void
  onDeleteEntry: (entryId: string) => void
  onExport: (format: 'memo' | 'pdf') => Promise<void>
  onCancelExport: () => void
  onRenameNote: (note: EditorNote, title: string) => Promise<{ error?: string } | void>
  onToggleEntry: (entryId: string) => void
  onToggleFavorite: () => void
  opened: EditorNoteSessionOpened
  saveError: string | null
  validationError: TopicValidationError | null
}

export function NoteEditorView({
  applyExternal,
  collapsedEntryIds,
  exporting,
  favoritePending,
  focusBlockId,
  onAddBook,
  onAddFolder,
  onImportMarkdown,
  onAddTopic,
  onAddWhiteboard,
  onOpenImageOcclusion,
  onOpenTopic,
  onRebindBook,
  onDeleteEntry,
  onExport,
  onCancelExport,
  onRenameNote,
  onToggleEntry,
  onToggleFavorite,
  opened,
  saveError,
  validationError,
}: NoteEditorViewProps) {
  const { t } = useTranslation('editor')
  const { t: tCommon } = useTranslation('common')
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null)
  const [renamingEntryId, setRenamingEntryId] = useState<string | null>(null)
  const [inspectorVisible, setInspectorVisible] = useNoteInspectorVisibility()
  const configuration = useDesktopConfiguration()
  const flushNotePersistence = useFlushNotePersistence()
  const editorAdapters = useMemo(
    () => desktopEditorAdapters(configuration.networkImagePasteBehavior, {
      applyExternal,
      flush: flushNotePersistence,
      noteId: opened.note.id,
      topicId: opened.topic.topicId,
    }),
    [applyExternal, configuration.networkImagePasteBehavior, flushNotePersistence, opened.note.id, opened.topic.topicId],
  )
  const currentEntry = opened.entries.find(entry => entry.id === opened.topic.topicId)
  if (!currentEntry || currentEntry.kind !== 'topic')
    throw new Error(`Note ${opened.note.id} does not contain open Topic ${opened.topic.topicId}`)

  const imageOcclusionTopic = isImageOcclusionTopic(opened.topic) ? opened.topic : null
  const editorTopic = 'documentId' in opened.topic ? opened.topic : null
  const whiteboardTopic = 'getScene' in opened.topic ? opened.topic : null
  if ((currentEntry.topicType === 'image-occlusion') !== (imageOcclusionTopic !== null))
    throw new Error(`Topic ${currentEntry.id} document does not match type ${currentEntry.topicType}`)
  if ((currentEntry.topicType === 'whiteboard') !== (whiteboardTopic !== null))
    throw new Error(`Topic ${currentEntry.id} document does not match type ${currentEntry.topicType}`)

  const mode = useEditorTopicMode(editorTopic)
  const cardSource = currentEntry.topicType === 'regular' ? currentEntry.cardSource : undefined
  const cardTopicCards = useMemo(() => {
    if (cardSource === undefined)
      return []
    const validation = opened.note.getTopicValidationInput(currentEntry.id)
    if (!('document' in validation))
      throw new Error(`Card Topic ${currentEntry.id} does not contain one editable document`)
    return projectCardTopicCards(validation.document, cardSource)
  }, [cardSource, currentEntry.id, opened.note])
  const readerReference = currentEntry.topicType === 'regular'
    ? currentEntry.readerReference ?? null
    : null
  const sourceBookTopic = readerReference?.annotationId === undefined
    ? null
    : opened.entries.find(entry => entry.kind === 'topic'
      && entry.topicType === 'book'
      && entry.id === readerReference.bookTopicId) ?? null
  const sourceReadingId = sourceBookTopic?.kind === 'topic' && sourceBookTopic.topicType === 'book'
    ? sourceBookTopic.book.retrievalHints[0]?.readingId
    : undefined
  const readerSourceNavigation = readerReference?.annotationId !== undefined && sourceReadingId !== undefined
    ? {
        annotationId: readerReference.annotationId,
        bookTopicId: readerReference.bookTopicId,
        readingId: sourceReadingId,
      }
    : null
  const imageOcclusionState = imageOcclusionTopic?.getState() ?? null
  const imageOcclusionReaderSource = imageOcclusionState?.source.kind === 'reader-region'
    ? imageOcclusionState.source
    : null
  const imageOcclusionSourceBookTopic = imageOcclusionReaderSource === null
    ? null
    : opened.entries.find(entry => entry.kind === 'topic'
      && entry.topicType === 'book'
      && entry.id === imageOcclusionReaderSource.topicId) ?? null
  const imageOcclusionSourceAnnotation = imageOcclusionReaderSource === null
    || imageOcclusionSourceBookTopic?.kind !== 'topic'
    || imageOcclusionSourceBookTopic.topicType !== 'book'
    ? null
    : opened.note.getBookTopic(imageOcclusionSourceBookTopic.id).getReadingState().annotations.find(
      annotation => annotation.id === imageOcclusionReaderSource.annotationId,
    ) ?? null
  const imageOcclusionSourceReadingId = imageOcclusionSourceAnnotation === null
    || imageOcclusionSourceBookTopic?.kind !== 'topic'
    || imageOcclusionSourceBookTopic.topicType !== 'book'
    ? undefined
    : imageOcclusionSourceBookTopic.book.retrievalHints[0]?.readingId
  const imageOcclusionSource = imageOcclusionState === null || imageOcclusionReaderSource === null
    ? null
    : {
        imageSrc: imageOcclusionState.image.src,
        kind: 'region' as const,
        location: imageOcclusionSourceAnnotation === null
          ? t('imageOcclusion.readerRegionSource')
          : readerAnnotationLabel(imageOcclusionSourceAnnotation, tCommon),
      }
  const imageOcclusionSourceNavigation = imageOcclusionSourceAnnotation === null
    || imageOcclusionSourceReadingId === undefined
    || imageOcclusionReaderSource === null
    ? null
    : {
        annotationId: imageOcclusionSourceAnnotation.id,
        bookTopicId: imageOcclusionReaderSource.topicId,
        readingId: imageOcclusionSourceReadingId,
      }
  const toggleInspector = useCallback(() => setInspectorVisible(visible => !visible), [setInspectorVisible])
  const visibleTopicIds = useMemo(
    () => projectVisibleNoteEntries(opened.entries, collapsedEntryIds)
      .filter(({ entry }) => entry.kind === 'topic'
        && (configuration.learning.enabled || entry.topicType !== 'image-occlusion'))
      .map(({ entry }) => entry.id),
    [collapsedEntryIds, configuration.learning.enabled, opened.entries],
  )
  useEffect(() => {
    if (!inspectorVisible || visibleTopicIds.length === 0)
      return
    const isFormControlTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement))
        return false
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isFormControlTarget(event.target))
        return
      const direction = matchesKeyboardShortcut(event, configuration.shortcuts.previousNoteStructureEntry)
        ? -1
        : matchesKeyboardShortcut(event, configuration.shortcuts.nextNoteStructureEntry) ? 1 : null
      if (direction === null)
        return
      event.preventDefault()
      event.stopPropagation()
      const nextTopicId = selectAdjacentVisibleId(visibleTopicIds, opened.topic.topicId, direction)
      if (!nextTopicId || nextTopicId === opened.topic.topicId)
        return
      void onOpenTopic(nextTopicId)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [configuration.shortcuts.nextNoteStructureEntry, configuration.shortcuts.previousNoteStructureEntry, inspectorVisible, onOpenTopic, opened.topic.topicId, visibleTopicIds])
  const entryContextMenu = useNoteEntryContextMenu({
    onAddBook,
    onAddFolder,
    onImportMarkdown,
    onAddTopic,
    onAddWhiteboard,
    onRebindBook,
    onRenameEntry: entryId => setRenamingEntryId(entryId),
    onDeleteEntry,
  })
  const showDocumentMode = useCallback(() => editorTopic?.setMode(EditorMode.Document), [editorTopic])
  const showOutlineMode = useCallback(() => editorTopic?.setMode(EditorMode.Outline), [editorTopic])
  const modeCommands = useMemo<readonly PaletteCommand[]>(() => editorTopic === null
    ? []
    : mode === EditorMode.Document
      ? [{
          accent: 'violet',
          action: t('switchMode'),
          description: t('switchToOutlineDescription'),
          icon: ListTree,
          id: 'editor-mode-outline',
          keywords: t('switchToOutlineKeywords') as unknown as readonly string[],
          label: t('switchToOutlineMode'),
          run: showOutlineMode,
          section: t('editorSection') as PaletteCommand['section'],
        }]
      : [{
          accent: 'blue',
          action: t('switchMode'),
          description: t('switchToDocumentDescription'),
          icon: AlignLeft,
          id: 'editor-mode-document',
          keywords: t('switchToDocumentKeywords') as unknown as readonly string[],
          label: t('switchToDocumentMode'),
          run: showDocumentMode,
          section: t('editorSection') as PaletteCommand['section'],
        }], [editorTopic, mode, showDocumentMode, showOutlineMode, t])
  useCommandPaletteCommands(modeCommands)

  const regularTopicImageOcclusion = useMemo<EditorImageOcclusionIntegration | undefined>(() => {
    if (!configuration.learning.enabled || currentEntry.topicType !== 'regular' || editorTopic === null)
      return undefined
    const sourceTopicId = editorTopic.topicId
    return {
      getState: (imageId) => {
        const topic = opened.note.findImageOcclusionTopic({
          imageId,
          kind: 'topic-image',
          topicId: sourceTopicId,
        })
        return topic ? topic.getState() : null
      },
      open: onOpenImageOcclusion,
      subscribe: editorTopic.subscribe,
    }
  }, [configuration.learning.enabled, currentEntry.topicType, editorTopic, onOpenImageOcclusion, opened.note])
  const renameNote = useCallback((title: string) => onRenameNote(opened.note, title), [onRenameNote, opened.note])
  const reconcileCardTopics = useCallback((document: Parameters<NonNullable<ComponentProps<typeof Editor>['onDocumentChange']>>[0]) => {
    const result = opened.note.reconcileCardTopics({ document, topicId: opened.topic.topicId })
    if (result.detachedTopicId === null)
      return
    const detachedTopicId = result.detachedTopicId
    const toastId = toast.warning(
      <span>
        {t('cardTopicDetached')}
        {' '}
        <button
          type="button"
          onClick={() => {
            try {
              opened.note.resyncCardTopic(detachedTopicId)
              toast.dismiss(toastId)
            }
            catch (error) {
              toast.error(t('cardTopicResyncFailed', {
                message: errorMessage(error),
              }))
            }
          }}
        >
          {t('undoCardTopicDetach')}
        </button>
      </span>,
      { autoClose: 8_000 },
    )
  }, [opened.note, opened.topic.topicId, t])
  const renameImageOcclusionTopic = useCallback(
    (title: string) => opened.note.renameEntry(opened.topic.topicId, title),
    [opened.note, opened.topic.topicId],
  )
  const copyValidationDiagnostics = useCallback(async () => {
    if (!validationError)
      return
    try {
      if (typeof navigator.clipboard?.writeText !== 'function')
        throw new Error('The Clipboard API is unavailable')
      await navigator.clipboard.writeText(validationError.diagnostics)
      setCopyFeedback({ diagnostics: validationError.diagnostics, status: 'copied' })
    }
    catch (error) {
      console.error('Failed to copy Topic validation diagnostics', error)
      setCopyFeedback({ diagnostics: validationError.diagnostics, status: 'failed' })
    }
  }, [validationError])
  const copyStatus = copyFeedback !== null && copyFeedback.diagnostics === validationError?.diagnostics
    ? copyFeedback.status
    : null
  const titlebar = useMemo(() => ({
    ...(whiteboardTopic === null ? { onRenameTitle: renameNote } : {}),
    sidebarAction: (
      <NoteInspectorActions
        favorite={opened.stored.favorite}
        favoritePending={favoritePending}
        inspectorVisible={inspectorVisible}
        onToggleFavorite={onToggleFavorite}
        onToggleInspector={toggleInspector}
      />
    ),
    trailing: <NoteExportMenu exporting={exporting} onCancelExport={onCancelExport} onExport={format => void onExport(format)} />,
    title: opened.stored.title,
    titleVisibility: whiteboardTopic === null ? 'always' as const : 'hidden' as const,
  }), [
    favoritePending,
    exporting,
    inspectorVisible,
    onToggleFavorite,
    onExport,
    onCancelExport,
    opened.stored.favorite,
    opened.stored.title,
    renameNote,
    toggleInspector,
    whiteboardTopic,
  ])
  usePageTitlebar(titlebar)

  return (
    <main {...stylex.props(noteEditorStyles.page)}>
      <section
        {...stylex.props(
          noteEditorStyles.workspace,
          whiteboardTopic !== null && noteEditorStyles.fullBleedWorkspace,
        )}
        aria-label={opened.stored.title}
      >
        {saveError || validationError
          ? (
              <div {...stylex.props(noteEditorStyles.alertStack)}>
                {validationError
                  ? (
                      <div {...stylex.props(noteEditorStyles.validationError)}>
                        <span {...stylex.props(noteEditorStyles.validationErrorMessage)} aria-live="assertive" role="alert">
                          {validationError.message}
                        </span>
                        <div {...stylex.props(noteEditorStyles.validationErrorActions)}>
                          <button
                            {...stylex.props(noteEditorStyles.copyDiagnosticsButton)}
                            aria-label={t('copyDiagnosticsLabel')}
                            title={t('copyDiagnosticsLabel')}
                            type="button"
                            onClick={copyValidationDiagnostics}
                          >
                            <Copy aria-hidden="true" size={14} strokeWidth={1.9} />
                            <span>{t('copyDiagnostics')}</span>
                          </button>
                          <span {...stylex.props(noteEditorStyles.copyDiagnosticsStatus)} aria-live="polite" role="status">
                            {copyStatus === 'copied' ? t('copied', { ns: 'common' }) : copyStatus === 'failed' ? t('copyFailed', { ns: 'common' }) : ''}
                          </span>
                        </div>
                      </div>
                    )
                  : null}
                {saveError
                  ? (
                      <div {...stylex.props(noteEditorStyles.saveError)} aria-live="polite" role="status">
                        {t('failedToSaveNote', { message: saveError })}
                      </div>
                    )
                  : null}
              </div>
            )
          : null}
        {readerReference
          ? (
              <ReaderSourceHeader
                navigation={readerSourceNavigation}
                noteId={opened.note.id}
                source={readerReference.source}
                onRemove={() => opened.note.setTopicReaderReference(opened.topic.topicId, null)}
              />
            )
          : imageOcclusionSource === null
            ? null
            : (
                <ReaderSourceHeader
                  navigation={imageOcclusionSourceNavigation}
                  noteId={opened.note.id}
                  source={imageOcclusionSource}
                />
              )}
        {configuration.learning.enabled && imageOcclusionTopic !== null
          ? (
              <Suspense fallback={<div {...stylex.props(noteEditorStyles.topicLoading)} role="status">{t('loadingEditor')}</div>}>
                <ImageOcclusionTopicEditor
                  onRename={renameImageOcclusionTopic}
                  title={currentEntry.title}
                  topic={imageOcclusionTopic}
                />
              </Suspense>
            )
          : editorTopic !== null
            ? (
                <>
                  {configuration.learning.enabled && cardSource !== undefined
                    ? <CardTopicPreview cards={cardTopicCards} />
                    : null}
                  <Editor
                    adapters={editorAdapters}
                    cardPreviewDisabled={currentEntry.topicType === 'regular'}
                    cardTopic={cardSource !== undefined}
                    focus={focusBlockId === undefined ? undefined : { blockId: focusBlockId }}
                    imageOcclusion={regularTopicImageOcclusion}
                    learningEnabled={configuration.learning.enabled}
                    platform={getPlatform()}
                    shortcuts={configuration.shortcuts}
                    onDocumentChange={reconcileCardTopics}
                    outline={{ outdentBehavior: configuration.outdentBehavior }}
                    topic={editorTopic}
                  />
                </>
              )
            : whiteboardTopic !== null
              ? (
                  <WhiteboardEditor
                    adapters={editorAdapters}
                    inspectorVisible={inspectorVisible}
                    learningEnabled={configuration.learning.enabled}
                    shortcuts={configuration.shortcuts}
                    topic={whiteboardTopic}
                  />
                )
              : null}
      </section>
      <NoteInspector
        collapsedEntryIds={collapsedEntryIds}
        contextMenu={{
          onOpenBook: entryContextMenu.openBook,
          onOpenContainer: entryContextMenu.openContainer,
        }}
        currentTopicId={opened.topic.topicId}
        entries={opened.entries}
        learningEnabled={configuration.learning.enabled}
        note={opened.note}
        noteTitle={opened.stored.title}
        noteId={opened.note.id}
        renamingEntryId={renamingEntryId}
        onToggleEntry={onToggleEntry}
        onCancelRenameEntry={() => setRenamingEntryId(null)}
        onRenameEntry={(entryId, label) => {
          try {
            opened.note.renameEntry(entryId, label)
            setRenamingEntryId(null)
          }
          catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        open={inspectorVisible}
      />
      {entryContextMenu.menu}
    </main>
  )
}
