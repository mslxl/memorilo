import type { ReadingItem } from '@memorilo/editor-storage'
import type { EditorNote } from '@memorilo/editor/note'
import { Editor, EditorMode } from '@memorilo/editor'
import { Button } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { ChevronDown, ChevronRight, FileText, Folder, PanelRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDesktopConfiguration } from '../../../shared/configuration'
import { desktopRequests } from '../../../shared/desktop-requests'
import { errorMessage } from '../../../shared/error-message'
import { getPlatform } from '../../../shared/platform'
import { desktopEditorAdapters, useEditorNoteSession } from '../../notes/editor/note-editor-session'
import { projectVisibleNoteEntries } from '../../notes/note-entry-tree'
import { useFlushNotePersistence } from '../../notes/persistence/note-persistence-hooks'
import { learningReviewSourceStyles as styles } from './learning-review-source.stylex'

export function LearningReadingWorkspace({ item, onNext }: {
  item: ReadingItem
  onNext: () => Promise<void>
}) {
  const { t } = useTranslation('learning')
  const configuration = useDesktopConfiguration()
  const flush = useFlushNotePersistence()
  const [activeTopicId, setActiveTopicId] = useState(item.topicId)
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<ReadonlySet<string>>(() => new Set())
  const [structureOpen, setStructureOpen] = useState(true)
  const structureTriggerRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [cardCreated, setCardCreated] = useState(false)
  const semanticActionInFlightRef = useRef(false)
  const loadNote = useCallback(() => desktopRequests.getNote({ noteId: item.noteId }), [item.noteId])
  const processReadingAction = useCallback(async (action: 'cloze' | 'extract'): Promise<void> => {
    // The rail can temporarily show another Topic, but semantic actions only
    // advance the Reading Item whose source Topic is being learned.
    if (activeTopicId !== item.topicId)
      return
    if (semanticActionInFlightRef.current)
      return
    semanticActionInFlightRef.current = true
    setPending(true)
    try {
      await flush()
      await desktopRequests.learning.processReadingItem({
        action,
        readingItemId: item.readingItemId,
      })
      setError(null)
    }
    catch (cause) {
      setError(t('readingActionFailed', { message: errorMessage(cause) }))
    }
    finally {
      semanticActionInFlightRef.current = false
      setPending(false)
    }
  }, [activeTopicId, flush, item.readingItemId, item.topicId, t])
  const resolveTopic = useCallback((note: EditorNote) => {
    const entry = note.getEntries().find(candidate => candidate.kind === 'topic' && candidate.id === activeTopicId)
    if (!entry || entry.kind !== 'topic')
      throw new Error(`Note ${note.id} does not contain Learning Topic ${activeTopicId}`)
    if (entry.topicType !== 'regular' && entry.topicType !== 'book')
      throw new Error(`Learning Topic ${activeTopicId} is not editable in this workspace`)
    return note.getTopic(entry.id)
  }, [activeTopicId])
  const source = useEditorNoteSession({ loadNote, noteId: item.noteId, resolveTopic, topicKey: activeTopicId })
  const editorAdapters = useMemo(() => desktopEditorAdapters(configuration.networkImagePasteBehavior), [configuration.networkImagePasteBehavior])
  useEffect(() => {
    if (!structureOpen)
      structureTriggerRef.current?.focus()
  }, [structureOpen])
  if (source.loadError)
    return <div {...stylex.props(styles.sourceStatus, styles.sourceError)} role="alert">{t('loadSourceFailed', { message: source.loadError })}</div>
  if (!source.opened)
    return <div {...stylex.props(styles.sourceStatus)} role="status">{t('loadingSource')}</div>
  if (!('documentId' in source.opened.topic))
    throw new Error(`Learning Topic ${activeTopicId} does not contain editor content`)

  const visibleEntries = projectVisibleNoteEntries(source.opened.entries, collapsedEntryIds)
  const switchTopic = async (topicId: string): Promise<void> => {
    try {
      await flush()
      setError(null)
      setActiveTopicId(topicId)
    }
    catch (cause) {
      setError(errorMessage(cause))
    }
  }
  const next = async (): Promise<void> => {
    setPending(true)
    try {
      await flush()
      await onNext()
      setError(null)
    }
    catch (cause) {
      setError(errorMessage(cause))
    }
    finally {
      setPending(false)
    }
  }

  const makeCard = async (): Promise<void> => {
    setPending(true)
    try {
      await flush()
      const update = await desktopRequests.generateCardTopic({
        highlightId: item.highlightId,
        noteId: item.noteId,
        sourceTopicId: item.topicId,
      })
      source.applyExternal(update)
      setCardCreated(true)
      setError(null)
    }
    catch (cause) {
      setError(t('cardGenerationFailed', { message: errorMessage(cause) }))
    }
    finally {
      setPending(false)
    }
  }

  return (
    <main {...stylex.props(styles.readingPage)} aria-label={t('incrementalLearning')} data-page="learning-reading-workspace">
      <div {...stylex.props(styles.workspace)}>
        <div {...stylex.props(styles.readingCanvas)}>
          <Editor
            adapters={editorAdapters}
            mode={EditorMode.Outline}
            platform={getPlatform()}
            outline={{ defaultFocus: { blockId: item.sourceBlockId }, focus: { blockId: item.sourceBlockId } }}
            onSemanticAction={action => void processReadingAction(action)}
            topic={source.opened.topic}
          />
          {source.saveError ? <div {...stylex.props(styles.navigationError)} role="alert">{t('saveLearningSourceFailed', { message: source.saveError })}</div> : null}
          {error ? <div {...stylex.props(styles.navigationError)} role="alert">{error}</div> : null}
          <div {...stylex.props(styles.readingActions)}>
            <Button data-learning-action="make-card" data-learning-state={cardCreated ? 'created' : 'available'} disabled={pending || cardCreated} variant="plain" onClick={() => void makeCard()}>{cardCreated ? t('cardCreated') : t('makeCard')}</Button>
            <Button data-learning-action="next" disabled={pending} variant="plain" onClick={() => void next()}>{t('nextReadingItem')}</Button>
          </div>
        </div>
        <button
          ref={structureTriggerRef}
          {...stylex.props(styles.structureToggle)}
          aria-controls="learning-note-structure"
          aria-expanded={structureOpen}
          type="button"
          onClick={() => setStructureOpen(open => !open)}
        >
          <PanelRight size={14} />
          {structureOpen ? t('closeNoteStructure') : t('openNoteStructure')}
        </button>
        <aside
          {...stylex.props(styles.structure, styles.structureMobile, !structureOpen && styles.structureClosed)}
          aria-label={t('noteStructure')}
          id="learning-note-structure"
        >
          <div {...stylex.props(styles.structureHeader)}>{t('noteStructure')}</div>
          <div {...stylex.props(styles.structureTree)}>
            {visibleEntries.map(({ depth, entry, hasChildren }) => (
              <div key={entry.id} {...stylex.props(styles.structureRow)} style={{ paddingLeft: 8 + depth * 14 }}>
                {entry.kind === 'folder'
                  ? (
                      <button
                        {...stylex.props(styles.disclosure)}
                        type="button"
                        onClick={() => setCollapsedEntryIds((current) => {
                          const nextIds = new Set(current)
                          if (nextIds.has(entry.id))
                            nextIds.delete(entry.id)
                          else nextIds.add(entry.id)
                          return nextIds
                        })}
                      >
                        {hasChildren && collapsedEntryIds.has(entry.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <Folder size={14} />
                        <span>{entry.name}</span>
                      </button>
                    )
                  : (
                      <button
                        {...stylex.props(styles.topicButton, entry.id === activeTopicId && styles.topicButtonActive)}
                        aria-label={entry.topicType !== 'regular' && entry.topicType !== 'book'
                          ? `${entry.title} — ${t('unsupportedLearningTopic')}`
                          : entry.title}
                        disabled={entry.topicType !== 'regular' && entry.topicType !== 'book'}
                        title={entry.topicType !== 'regular' && entry.topicType !== 'book' ? t('unsupportedLearningTopic') : undefined}
                        type="button"
                        onClick={() => void switchTopic(entry.id)}
                      >
                        <FileText size={14} />
                        <span {...stylex.props(styles.topicLabel)}>{entry.title}</span>
                        {entry.id === item.topicId ? <span {...stylex.props(styles.sourceMarker)} aria-label={t('learningSource')} data-learning-source-marker="" /> : null}
                      </button>
                    )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  )
}
