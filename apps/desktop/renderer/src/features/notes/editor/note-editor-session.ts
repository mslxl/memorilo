import type { DesktopNote, DesktopNoteExternalUpdate } from '@memorilo/desktop-api'
import type { EditorNote } from '@memorilo/editor'
import type { EditorNoteSessionCache } from '../note-runtime'
import type {
  EditorNoteSessionOpened,
  EditorNoteSessionRuntimeEvent,
  EditorStoredNotePatch,
  EditorTopicResolver,
  TopicValidationError,
} from './note-editor-session-runtime'
import { demoEditorAdapters } from '@memorilo/editor'
import { createLatestOperationSupervisor } from '@memorilo/effect-lifecycle'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { desktopRequests } from '../../../shared/desktop-requests'
import { useOwnedResource } from '../../../shared/lifecycle/owned-resource'
import { loadTodoCalendarSnapshot } from '../../../shared/todo-calendar-cache'
import { useNotePersistence } from '../persistence/note-persistence-hooks'
import { EditorNoteSessionRuntime, toEditorNoteError } from './note-editor-session-runtime'

export type {
  EditorNoteSessionOpened,
  EditorStoredNotePatch,
  TopicValidationError,
} from './note-editor-session-runtime'

export interface EditorNoteSession<TStored extends DesktopNote = DesktopNote> {
  applyExternal: (external: DesktopNoteExternalUpdate) => boolean
  loadError: string | null
  opened: EditorNoteSessionOpened<TStored> | null
  saveError: string | null
  updateStored: (
    expectedNote: EditorNote,
    patch: EditorStoredNotePatch<TStored>,
  ) => boolean
  validationError: TopicValidationError | null
}

interface EditorNoteSessionBaseOptions<TStored extends DesktopNote> {
  cache?: EditorNoteSessionCache
  loadNote: () => Promise<TStored>
  noteId: string
  onExternalUpdate?: (opened: EditorNoteSessionOpened<TStored>) => void
  onSaved?: (opened: EditorNoteSessionOpened<TStored>) => void
}

type EditorNoteSessionTopicOptions<TStored extends DesktopNote>
  = | {
    resolveTopic?: never
    topicId: string
    topicKey?: never
  }
  | {
    resolveTopic: EditorTopicResolver<TStored>
    topicId?: never
    topicKey: string
  }

export type UseEditorNoteSessionOptions<TStored extends DesktopNote>
  = EditorNoteSessionBaseOptions<TStored> & EditorNoteSessionTopicOptions<TStored>

function errorMessage(error: unknown | null): string | null {
  return error === null ? null : toEditorNoteError(error).message
}

interface DesktopEditorTaskContext {
  applyExternal: (external: DesktopNoteExternalUpdate) => boolean
  flush: () => Promise<void>
  noteId: string
  topicId: string
}

export function desktopEditorAdapters(
  networkImagePasteBehavior: 'download' | 'url',
  taskContext?: DesktopEditorTaskContext,
) {
  return {
    ...demoEditorAdapters,
    importNetworkImage: async (source: string) => (await desktopRequests.importNetworkImage({ source })).src,
    networkImagePasteBehavior,
    ...(taskContext === undefined
      ? {}
      : {
          taskActions: {
            completeRecurring: async ({ blockId }: { blockId: string }) => {
              await taskContext.flush()
              const external = await desktopRequests.updateTodoTask({
                blockId,
                noteId: taskContext.noteId,
                status: 'done',
                topicId: taskContext.topicId,
              })
              taskContext.applyExternal(external)
            },
          },
        }),
    taskCalendar: {
      load: loadTodoCalendarSnapshot,
    },
    uploadImage: async ({ file, onProgress }: Parameters<typeof demoEditorAdapters.uploadImage>[0]) => {
      const total = Math.max(file.size, 1)
      onProgress({ loaded: 0, total })
      const result = await desktopRequests.saveImage({
        data: new Uint8Array(await file.arrayBuffer()),
        fileName: file.name,
        mimeType: file.type,
      })
      onProgress({ loaded: total, total })
      return result.src
    },
  }
}

export function useEditorNoteSession<TStored extends DesktopNote>({
  cache,
  loadNote,
  noteId,
  onExternalUpdate,
  onSaved,
  resolveTopic,
  topicId,
  topicKey,
}: UseEditorNoteSessionOptions<TStored>): EditorNoteSession<TStored> {
  const { t } = useTranslation('editor')
  const [opened, setOpened] = useState<EditorNoteSessionOpened<TStored> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<TopicValidationError | null>(null)
  const openingConfiguration = useRef({
    name: 'Editor Note session opening',
    options: {
      concurrency: 'parallel' as const,
      shutdown: 'interrupt' as const,
    },
  }).current
  const opening = useOwnedResource(
    'Editor Note session opening supervisor',
    openingConfiguration,
    current => createLatestOperationSupervisor<'open'>(current.name, current.options),
  )
  const persistence = useNotePersistence(noteId)
  const {
    enqueue,
    error: persistenceError,
    getPendingChanges,
    replacePending,
    subscribeReceipts,
  } = persistence
  const runtimeRef = useRef<EditorNoteSessionRuntime<TStored> | null>(null)
  const onExternalUpdateRef = useRef(onExternalUpdate)
  const onSavedRef = useRef(onSaved)
  const resolveTopicRef = useRef(resolveTopic)
  const handleRuntimeEventRef = useRef<(event: EditorNoteSessionRuntimeEvent<TStored>) => void>(() => undefined)
  onExternalUpdateRef.current = onExternalUpdate
  onSavedRef.current = onSaved
  resolveTopicRef.current = resolveTopic

  const resolveTopicDocument = useCallback<EditorTopicResolver<TStored>>((note, stored) => {
    if (topicId !== undefined) {
      const topic = note.getEntries().find(entry => entry.kind === 'topic' && entry.id === topicId)
      if (!topic || topic.kind !== 'topic')
        throw new Error(`Note ${note.id} does not contain Topic ${topicId}`)
      return topic.topicType === 'image-occlusion'
        ? note.getImageOcclusionTopic(topic.id)
        : topic.topicType === 'whiteboard'
          ? note.getWhiteboardTopic(topic.id)
          : note.getTopic(topic.id)
    }
    const currentResolver = resolveTopicRef.current
    if (!currentResolver)
      throw new Error(`No Topic resolver was provided for Note ${note.id}`)
    return currentResolver(note, stored)
  }, [topicId])

  handleRuntimeEventRef.current = (event) => {
    if (event.type === 'restore-failed') {
      console.error(`Failed to restore the latest valid snapshot for Note ${noteId}`, event.error)
      setValidationError({
        diagnostics: event.diagnostics,
        message: t('restoreFailedMessage', { topicId: event.targetId }),
      })
      return
    }

    setOpened(event.opened)
    setValidationError(event.source === 'restored'
      ? { diagnostics: event.diagnostics ?? '', message: t('invalidStructureReverted') }
      : null)
    if (event.source === 'external')
      onExternalUpdateRef.current?.(event.opened)
    else if (event.source === 'saved')
      onSavedRef.current?.(event.opened)
  }

  useEffect(() => subscribeReceipts((savedNoteId, receipt) => {
    runtimeRef.current?.applyReceipt(savedNoteId, receipt)
  }), [subscribeReceipts])

  useEffect(() => window.desktop.subscribeNoteUpdates((external) => {
    try {
      runtimeRef.current?.applyExternal(external)
    }
    catch (error) {
      console.error(`Failed to apply external update for Note ${external.noteId}`, error)
    }
  }), [])

  const resetViewState = useCallback(() => {
    setOpened(null)
    setLoadError(null)
    setValidationError(null)
  }, [])

  useEffect(() => {
    if (!opening)
      return
    let ownedRuntime: EditorNoteSessionRuntime<TStored> | undefined
    let resetPending = true
    queueMicrotask(() => {
      if (resetPending)
        resetViewState()
    })

    void opening.run('open', async ({ signal }) => {
      const stored = await loadNote()
      signal.throwIfAborted()
      let runtime: EditorNoteSessionRuntime<TStored> | undefined
      try {
        runtime = new EditorNoteSessionRuntime({
          cache,
          noteId,
          onEvent: event => handleRuntimeEventRef.current(event),
          persistence: {
            enqueue,
            getPendingChanges,
            replacePending,
          },
          preferredTopicId: topicId,
          resolveTopic: resolveTopicDocument,
        })
        const nextOpened = runtime.open(stored)
        signal.throwIfAborted()

        runtimeRef.current?.close()
        runtimeRef.current = runtime
        ownedRuntime = runtime
        setOpened(nextOpened)
        setLoadError(null)
        setValidationError(null)
      }
      catch (error) {
        runtime?.close()
        throw error
      }
    }).then(undefined, (error) => {
      setLoadError(toEditorNoteError(error).message)
    })

    return () => {
      resetPending = false
      opening.invalidate('open')
      if (ownedRuntime && runtimeRef.current === ownedRuntime) {
        runtimeRef.current = null
        ownedRuntime.close()
      }
    }
  }, [
    cache,
    enqueue,
    getPendingChanges,
    loadNote,
    noteId,
    opening,
    replacePending,
    resetViewState,
    resolveTopicDocument,
    topicId,
    topicKey,
  ])

  const updateStored = useCallback((
    expectedNote: EditorNote,
    patch: EditorStoredNotePatch<TStored>,
  ): boolean => runtimeRef.current?.updateStored(expectedNote, patch) ?? false, [])
  const applyExternal = useCallback(
    (external: DesktopNoteExternalUpdate): boolean => runtimeRef.current?.applyExternal(external) ?? false,
    [],
  )

  return {
    applyExternal,
    loadError,
    opened,
    saveError: errorMessage(persistenceError),
    updateStored,
    validationError,
  }
}
