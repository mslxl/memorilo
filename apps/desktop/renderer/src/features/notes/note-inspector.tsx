import type { BookTopicSnapshot, CardTopicSource, EditorNote, NoteEntrySnapshot } from '@memorilo/editor'
import type { MouseEvent as ReactMouseEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Link } from '@tanstack/react-router'
import { BookOpen, Brackets, ChevronRight, CreditCard, FileText, Folder, FolderOpen, Highlighter, Link2, ListChecks, ListOrdered, PenLine, ScanLine, Unlink } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { projectVisibleNoteEntries } from './note-entry-tree'
import { noteInspectorStyles } from './note-inspector.stylex'

const inspectorSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.28,
} as const

const entrySpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.2,
} as const

function bookTopicReadingId(topic: BookTopicSnapshot): string {
  const hint = topic.book.retrievalHints[0]
  if (!hint)
    throw new Error(`BookTopic ${topic.id} is missing its reading locator`)
  return hint.readingId
}

function CardTopicIcon({
  source,
}: {
  source: CardTopicSource
}) {
  const Icon = source.kind === 'cloze'
    ? Brackets
    : source.kind === 'highlight'
      ? Highlighter
      : source.kind === 'list'
        ? ListOrdered
        : source.kind === 'set'
          ? ListChecks
          : CreditCard
  const SyncIcon = source.syncStatus === 'synced' ? Link2 : Unlink
  return (
    <span
      {...stylex.props(noteInspectorStyles.cardTopicIcon)}
      aria-hidden="true"
      data-card-topic-kind={source.kind}
      data-card-topic-sync={source.syncStatus}
    >
      <Icon {...stylex.props(noteInspectorStyles.topicIconGlyph)} size={14} strokeWidth={1.7} />
      <SyncIcon {...stylex.props(noteInspectorStyles.cardTopicSyncIcon)} size={8} strokeWidth={2.1} />
    </span>
  )
}

function EditableEntryLabel({
  entryId,
  label,
  renaming,
  onCancel,
  onCommit,
}: {
  entryId: string
  label: string
  renaming: boolean
  onCancel?: () => void
  onCommit?: (label: string) => void
}) {
  if (!renaming)
    return <span {...stylex.props(noteInspectorStyles.entryLabel)}>{label}</span>
  return (
    <EntryRenameInput
      entryId={entryId}
      label={label}
      onCancel={onCancel}
      onCommit={onCommit}
    />
  )
}

function EntryRenameInput({
  entryId,
  label,
  onCancel,
  onCommit,
}: {
  entryId: string
  label: string
  onCancel?: () => void
  onCommit?: (label: string) => void
}) {
  const [draft, setDraft] = useState(label)
  const commit = () => {
    const next = draft.trim()
    if (next.length === 0) {
      onCancel?.()
      return
    }
    onCommit?.(next)
  }
  return (
    <input
      {...stylex.props(noteInspectorStyles.entryRenameInput)}
      autoFocus
      data-renaming-entry={entryId}
      value={draft}
      onBlur={commit}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel?.()
        }
      }}
    />
  )
}

export function NoteInspector({
  collapsedEntryIds,
  contextMenu,
  currentTopicId,
  entries,
  learningEnabled = true,
  note,
  noteTitle,
  noteId,
  renamingEntryId,
  onCancelRenameEntry,
  onRenameEntry,
  onToggleEntry,
  open,
}: {
  collapsedEntryIds: ReadonlySet<string>
  contextMenu?: {
    onOpenBook: (event: ReactMouseEvent, topicId: string, readingId: string, label?: string) => void
    onOpenContainer: (event: ReactMouseEvent, parentId: string | null, allowFolder: boolean, target?: { entryId: string, label: string }) => void
  }
  currentTopicId: string
  entries: readonly NoteEntrySnapshot[]
  learningEnabled?: boolean
  note: Pick<EditorNote, 'getLearningEnabled' | 'setLearningEnabled'>
  noteTitle?: string
  noteId: string
  renamingEntryId?: string | null
  onCancelRenameEntry?: () => void
  onRenameEntry?: (entryId: string, label: string) => void
  onToggleEntry: (entryId: string) => void
  open: boolean
}) {
  const { t } = useTranslation('editor')
  const shouldReduceMotion = useReducedMotion()
  const inspectorInitial = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, width: 0, x: 18 }
  const inspectorExit = inspectorInitial
  const inspectorAnimate = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, width: 292, x: 0 }
  const inspectorTransition = shouldReduceMotion ? { duration: 0.12 } : inspectorSpring

  return (
    <AnimatePresence initial={false}>
      {open
        ? (
            <motion.aside
              {...stylex.props(noteInspectorStyles.inspector)}
              animate={inspectorAnimate}
              aria-label={t('noteInspector')}
              data-note-inspector=""
              exit={inspectorExit}
              initial={inspectorInitial}
              transition={inspectorTransition}
            >
              <NoteInspectorContent
                collapsedEntryIds={collapsedEntryIds}
                contextMenu={contextMenu}
                currentTopicId={currentTopicId}
                entries={entries}
                learningEnabled={learningEnabled}
                note={note}
                noteTitle={noteTitle}
                noteId={noteId}
                renamingEntryId={renamingEntryId}
                onCancelRenameEntry={onCancelRenameEntry}
                onRenameEntry={onRenameEntry}
                onToggleEntry={onToggleEntry}
              />
            </motion.aside>
          )
        : null}
    </AnimatePresence>
  )
}

export function NoteInspectorContent({
  collapsedEntryIds,
  contextMenu,
  currentTopicId,
  entries,
  learningEnabled = true,
  note,
  noteTitle,
  noteId,
  renamingEntryId,
  onCancelRenameEntry,
  onRenameEntry,
  onToggleEntry,
  showTitle = true,
}: {
  collapsedEntryIds: ReadonlySet<string>
  contextMenu?: {
    onOpenBook: (event: ReactMouseEvent, topicId: string, readingId: string, label?: string) => void
    onOpenContainer: (event: ReactMouseEvent, parentId: string | null, allowFolder: boolean, target?: { entryId: string, label: string }) => void
  }
  currentTopicId: string
  entries: readonly NoteEntrySnapshot[]
  learningEnabled?: boolean
  note: Pick<EditorNote, 'getLearningEnabled' | 'setLearningEnabled'>
  noteTitle?: string
  noteId: string
  renamingEntryId?: string | null
  onCancelRenameEntry?: () => void
  onRenameEntry?: (entryId: string, label: string) => void
  onToggleEntry: (entryId: string) => void
  showTitle?: boolean
}) {
  const { t } = useTranslation('editor')
  const shouldReduceMotion = useReducedMotion()
  const visibleEntries = useMemo(
    () => projectVisibleNoteEntries(entries, collapsedEntryIds)
      .filter(({ entry }) => learningEnabled || entry.kind !== 'topic' || entry.topicType !== 'image-occlusion'),
    [collapsedEntryIds, entries, learningEnabled],
  )
  const topicCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === 'topic' && (learningEnabled || entry.topicType !== 'image-occlusion') ? 1 : 0), 0),
    [entries, learningEnabled],
  )
  const entryTransition = shouldReduceMotion ? { duration: 0.12 } : entrySpring
  const noteLearningEnabled = note.getLearningEnabled()

  return (
    <>
      {showTitle
        ? (
            <header
              {...stylex.props(noteInspectorStyles.inspectorTitlebar)}
              onContextMenu={contextMenu === undefined
                ? undefined
                : event => contextMenu.onOpenContainer(event, null, true)}
            >
              <div {...stylex.props(noteInspectorStyles.inspectorTitleGroup)}>
                <h1 {...stylex.props(noteInspectorStyles.inspectorTitle)}>{t('noteStructure')}</h1>
                <span {...stylex.props(noteInspectorStyles.inspectorCount)}>{topicCount}</span>
              </div>
            </header>
          )
        : null}
      {learningEnabled
        ? (
            <div {...stylex.props(noteInspectorStyles.learningRow)}>
              <span {...stylex.props(noteInspectorStyles.learningLabel)}>{t('learningEnabled')}</span>
              <button
                {...stylex.props(
                  noteInspectorStyles.learningSwitch,
                  noteLearningEnabled && noteInspectorStyles.learningSwitchOn,
                )}
                aria-checked={noteLearningEnabled}
                aria-label={t('toggleLearning')}
                role="switch"
                title={t('toggleLearning')}
                type="button"
                onClick={() => note.setLearningEnabled(!noteLearningEnabled)}
              >
                <span
                  {...stylex.props(
                    noteInspectorStyles.learningSwitchThumb,
                    noteLearningEnabled && noteInspectorStyles.learningSwitchThumbOn,
                  )}
                />
              </button>
            </div>
          )
        : null}
      <div {...stylex.props(noteInspectorStyles.inspectorContent)}>
        <section {...stylex.props(noteInspectorStyles.inspectorSection)} aria-label={t('noteStructure')}>
          <div {...stylex.props(noteInspectorStyles.topicTree)} role="list">
            <AnimatePresence initial={false}>
              {visibleEntries.map(({ depth, entry, hasChildren }) => {
                const collapsed = collapsedEntryIds.has(entry.id)
                const label = entry.kind === 'folder'
                  ? entry.name
                  : entry.title || (depth === 0 && noteTitle ? noteTitle : t('untitledTopic'))
                const current = entry.kind === 'topic' && entry.id === currentTopicId
                const renaming = renamingEntryId === entry.id
                const cardSource = entry.kind === 'topic' && entry.topicType === 'regular'
                  ? entry.cardSource
                  : undefined
                const topicContextMenu = contextMenu !== undefined && entry.kind === 'topic'
                  ? entry.topicType === 'book'
                    ? (event: ReactMouseEvent) => contextMenu.onOpenBook(
                        event,
                        entry.id,
                        bookTopicReadingId(entry),
                        label,
                      )
                    : (event: ReactMouseEvent) => contextMenu.onOpenContainer(event, entry.id, true, { entryId: entry.id, label })
                  : undefined

                return (
                  <motion.div
                    key={entry.id}
                    {...stylex.props(
                      noteInspectorStyles.entryRow(depth),
                      current && noteInspectorStyles.entryRowCurrent,
                    )}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -3 }}
                    initial={{ opacity: 0, y: shouldReduceMotion ? 0 : -3 }}
                    layout={shouldReduceMotion ? false : 'position'}
                    data-note-entry-id={entry.id}
                    data-note-entry-kind={entry.kind}
                    data-note-entry-topic-type={entry.kind === 'topic' ? entry.topicType : undefined}
                    role="listitem"
                    transition={entryTransition}
                  >
                    {entry.kind === 'folder'
                      ? renaming
                        ? (
                            <div {...stylex.props(noteInspectorStyles.folderEntryButton)} title={label}>
                              <motion.span
                                {...stylex.props(noteInspectorStyles.entryDisclosure)}
                                animate={{ rotate: hasChildren && !collapsed ? 90 : 0 }}
                                transition={entryTransition}
                              >
                                {hasChildren
                                  ? <ChevronRight aria-hidden="true" size={12} strokeWidth={1.9} />
                                  : null}
                              </motion.span>
                              {hasChildren && !collapsed
                                ? <FolderOpen {...stylex.props(noteInspectorStyles.folderIcon)} aria-hidden="true" size={15} strokeWidth={1.7} />
                                : <Folder {...stylex.props(noteInspectorStyles.folderIcon)} aria-hidden="true" size={15} strokeWidth={1.7} />}
                              <EditableEntryLabel
                                entryId={entry.id}
                                label={label}
                                renaming
                                onCancel={onCancelRenameEntry}
                                onCommit={nextLabel => onRenameEntry?.(entry.id, nextLabel)}
                              />
                            </div>
                          )
                        : (
                            <button
                              {...stylex.props(noteInspectorStyles.folderEntryButton)}
                              aria-expanded={hasChildren ? !collapsed : undefined}
                              disabled={!hasChildren}
                              title={label}
                              type="button"
                              onClick={() => onToggleEntry(entry.id)}
                              onContextMenu={contextMenu === undefined
                                ? undefined
                                : event => contextMenu.onOpenContainer(event, entry.id, true, { entryId: entry.id, label })}
                            >
                              <motion.span
                                {...stylex.props(noteInspectorStyles.entryDisclosure)}
                                animate={{ rotate: hasChildren && !collapsed ? 90 : 0 }}
                                transition={entryTransition}
                              >
                                {hasChildren
                                  ? <ChevronRight aria-hidden="true" size={12} strokeWidth={1.9} />
                                  : null}
                              </motion.span>
                              {hasChildren && !collapsed
                                ? <FolderOpen {...stylex.props(noteInspectorStyles.folderIcon)} aria-hidden="true" size={15} strokeWidth={1.7} />
                                : <Folder {...stylex.props(noteInspectorStyles.folderIcon)} aria-hidden="true" size={15} strokeWidth={1.7} />}
                              <EditableEntryLabel
                                entryId={entry.id}
                                label={label}
                                renaming={false}
                                onCancel={onCancelRenameEntry}
                                onCommit={nextLabel => onRenameEntry?.(entry.id, nextLabel)}
                              />
                            </button>
                          )
                      : (
                          <div {...stylex.props(noteInspectorStyles.topicEntry)} onContextMenu={topicContextMenu}>
                            {hasChildren
                              ? (
                                  <button
                                    {...stylex.props(noteInspectorStyles.entryDisclosureButton)}
                                    aria-label={t('collapsedExpand', { action: collapsed ? t('expand') : t('collapse'), label })}
                                    aria-expanded={!collapsed}
                                    type="button"
                                    onClick={() => onToggleEntry(entry.id)}
                                  >
                                    <motion.span
                                      {...stylex.props(noteInspectorStyles.entryDisclosure)}
                                      animate={{ rotate: collapsed ? 0 : 90 }}
                                      transition={entryTransition}
                                    >
                                      <ChevronRight aria-hidden="true" size={12} strokeWidth={1.9} />
                                    </motion.span>
                                  </button>
                                )
                              : <span {...stylex.props(noteInspectorStyles.entryDisclosurePlaceholder)} />}
                            {cardSource
                              ? <CardTopicIcon source={cardSource} />
                              : entry.topicType === 'book'
                                ? (
                                    <BookOpen
                                      {...stylex.props(
                                        noteInspectorStyles.topicIcon,
                                        current && noteInspectorStyles.topicIconCurrent,
                                      )}
                                      aria-hidden="true"
                                      size={14}
                                      strokeWidth={1.7}
                                    />
                                  )
                                : entry.topicType === 'image-occlusion'
                                  ? (
                                      <ScanLine
                                        {...stylex.props(
                                          noteInspectorStyles.topicIcon,
                                          current && noteInspectorStyles.topicIconCurrent,
                                        )}
                                        aria-hidden="true"
                                        size={14}
                                        strokeWidth={1.7}
                                      />
                                    )
                                  : entry.topicType === 'whiteboard'
                                    ? (
                                        <PenLine
                                          {...stylex.props(
                                            noteInspectorStyles.topicIcon,
                                            current && noteInspectorStyles.topicIconCurrent,
                                          )}
                                          aria-hidden="true"
                                          size={14}
                                          strokeWidth={1.7}
                                        />
                                      )
                                    : (
                                        <FileText
                                          {...stylex.props(
                                            noteInspectorStyles.topicIcon,
                                            current && noteInspectorStyles.topicIconCurrent,
                                          )}
                                          aria-hidden="true"
                                          size={14}
                                          strokeWidth={1.7}
                                        />
                                      )}
                            {entry.topicType === 'book'
                              ? renaming
                                ? (
                                    <span {...stylex.props(noteInspectorStyles.topicLink, current && noteInspectorStyles.topicLinkCurrent)}>
                                      <EditableEntryLabel
                                        entryId={entry.id}
                                        label={label}
                                        renaming
                                        onCancel={onCancelRenameEntry}
                                        onCommit={nextLabel => onRenameEntry?.(entry.id, nextLabel)}
                                      />
                                    </span>
                                  )
                                : (
                                    <Link
                                      {...stylex.props(
                                        noteInspectorStyles.topicLink,
                                        current && noteInspectorStyles.topicLinkCurrent,
                                      )}
                                      aria-current={current ? 'page' : undefined}
                                      params={{ readingId: bookTopicReadingId(entry) }}
                                      preload="intent"
                                      search={{ noteId, topicId: entry.id }}
                                      title={label}
                                      to="/reader/$readingId"
                                    >
                                      <EditableEntryLabel
                                        entryId={entry.id}
                                        label={label}
                                        renaming={false}
                                        onCancel={onCancelRenameEntry}
                                        onCommit={nextLabel => onRenameEntry?.(entry.id, nextLabel)}
                                      />
                                    </Link>
                                  )
                              : renaming
                                ? (
                                    <span {...stylex.props(noteInspectorStyles.topicLink, current && noteInspectorStyles.topicLinkCurrent)}>
                                      <EditableEntryLabel
                                        entryId={entry.id}
                                        label={label}
                                        renaming
                                        onCancel={onCancelRenameEntry}
                                        onCommit={nextLabel => onRenameEntry?.(entry.id, nextLabel)}
                                      />
                                    </span>
                                  )
                                : (
                                    <Link
                                      {...stylex.props(
                                        noteInspectorStyles.topicLink,
                                        current && noteInspectorStyles.topicLinkCurrent,
                                      )}
                                      aria-current={current ? 'page' : undefined}
                                      params={{ noteId, topicId: entry.id }}
                                      preload="intent"
                                      search={{}}
                                      title={label}
                                      to="/note/$noteId/$topicId"
                                    >
                                      <EditableEntryLabel
                                        entryId={entry.id}
                                        label={label}
                                        renaming={false}
                                        onCancel={onCancelRenameEntry}
                                        onCommit={nextLabel => onRenameEntry?.(entry.id, nextLabel)}
                                      />
                                    </Link>
                                  )}
                          </div>
                        )}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </>
  )
}
