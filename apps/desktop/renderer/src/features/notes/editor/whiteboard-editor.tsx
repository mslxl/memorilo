import type {
  AppState,
  BinaryFiles,
  ExcalidrawElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw'
import type { DesktopShortcutConfiguration } from '@memorilo/desktop-config'
import type {
  EditorAdapters,
  EditorEmbeddedDocument,
  EditorWhiteboardTopicDocument,
} from '@memorilo/editor'
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, newEmbeddableElement, ROUNDNESS, useHandleLibrary } from '@excalidraw/excalidraw'
import { Editor, EditorMode, whiteboardSceneSignature } from '@memorilo/editor'
import * as stylex from '@stylexjs/stylex'
import { NotebookPen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPlatform } from '../../../shared/platform'
import { whiteboardEditorStyles } from './whiteboard-editor.stylex'
import { whiteboardLibraryPersistenceAdapter } from './whiteboard-library-storage'
import './whiteboard-editor.global'
import '@excalidraw/excalidraw/index.css'

const editorEmbedKind = 'topic-editor'
const editorEmbedWidth = 560
const editorEmbedHeight = 400

interface WhiteboardEditorEmbedData {
  editorId: string
  kind: typeof editorEmbedKind
}

function editorEmbedData(element: ExcalidrawElement): WhiteboardEditorEmbedData | null {
  const memoriloEmbed = element.customData?.memoriloEmbed
  if (memoriloEmbed === null || typeof memoriloEmbed !== 'object' || Array.isArray(memoriloEmbed))
    return null
  const { editorId, kind } = memoriloEmbed as Record<string, unknown>
  if (kind !== editorEmbedKind || typeof editorId !== 'string' || editorId.length === 0)
    return null
  return { editorId, kind }
}

function isEditorEmbed(element: ExcalidrawElement): element is ExcalidrawEmbeddableElement {
  return element.type === 'embeddable' && editorEmbedData(element) !== null
}

function withoutEditorEmbedLinks(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  return elements.map(element => isEditorEmbed(element) && element.link !== null
    ? { ...element, link: null }
    : element)
}

function EmbeddedWhiteboardEditor({ adapters, learningEnabled, shortcuts, topic }: {
  adapters: EditorAdapters
  learningEnabled: boolean
  shortcuts: DesktopShortcutConfiguration
  topic: EditorEmbeddedDocument
}) {
  return (
    <article {...stylex.props(whiteboardEditorStyles.editorEmbed)} data-memorilo-whiteboard-editor="">
      <Editor adapters={adapters} layout="embedded" learningEnabled={learningEnabled} mode={EditorMode.Document} platform={getPlatform()} shortcuts={shortcuts} topic={topic} />
    </article>
  )
}

export function WhiteboardEditor({ adapters, inspectorVisible, learningEnabled, shortcuts, topic }: {
  adapters: EditorAdapters
  inspectorVisible: boolean
  learningEnabled: boolean
  shortcuts: DesktopShortcutConfiguration
  topic: EditorWhiteboardTopicDocument
}) {
  const { t } = useTranslation('editor')
  const sceneRef = useRef(topic.getScene())
  const [, forceRender] = useState(0)
  useEffect(() => topic.subscribe(() => {
    const next = topic.getScene()
    if (whiteboardSceneSignature(next) === whiteboardSceneSignature(sceneRef.current))
      return
    sceneRef.current = next
    forceRender(value => value + 1)
  }), [topic])
  const scene = sceneRef.current
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [excalidrawAPI, setExcalidrawAPIState] = useState<ExcalidrawImperativeAPI | null>(null)
  const setExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
    setExcalidrawAPIState(api)
  }, [])
  useHandleLibrary({
    adapter: whiteboardLibraryPersistenceAdapter,
    excalidrawAPI,
  })
  const lastSceneSignatureRef = useRef(whiteboardSceneSignature(scene))
  const pendingSceneRef = useRef<Parameters<EditorWhiteboardTopicDocument['setScene']>[0] | null>(null)
  const pointerInteractionRef = useRef(false)
  const sceneWriteScheduledRef = useRef(false)
  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    const elements = scene.elements
    const appState = scene.appState
    const files = scene.files
    if (!Array.isArray(elements))
      throw new Error(`WhiteboardTopic ${topic.topicId} scene elements must be an array`)
    if (appState !== undefined && (appState === null || typeof appState !== 'object' || Array.isArray(appState)))
      throw new Error(`WhiteboardTopic ${topic.topicId} scene appState must be an object`)
    if (files !== undefined && (files === null || typeof files !== 'object' || Array.isArray(files)))
      throw new Error(`WhiteboardTopic ${topic.topicId} scene files must be an object`)
    return {
      elements: withoutEditorEmbedLinks(elements as ExcalidrawElement[]),
      appState: {
        ...(appState === undefined ? {} : appState as AppState),
        currentItemFontFamily: FONT_FAMILY.Helvetica,
        currentItemRoughness: 0,
      },
      ...(files === undefined ? {} : { files: files as BinaryFiles }),
    }
  }, [scene, topic.topicId])

  const flushPendingScene = useCallback(() => {
    const pendingScene = pendingSceneRef.current
    if (!pendingScene)
      return
    pendingSceneRef.current = null
    topic.setScene(pendingScene)
  }, [topic])

  const scheduleSceneWrite = useCallback(() => {
    if (pointerInteractionRef.current || sceneWriteScheduledRef.current)
      return
    sceneWriteScheduledRef.current = true
    queueMicrotask(() => {
      sceneWriteScheduledRef.current = false
      if (pointerInteractionRef.current)
        return
      flushPendingScene()
    })
  }, [flushPendingScene])

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    const nextScene = {
      appState: structuredClone({
        gridSize: appState.gridSize,
        gridStep: appState.gridStep,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        viewBackgroundColor: appState.viewBackgroundColor,
        zoom: appState.zoom,
      }),
      elements: structuredClone(withoutEditorEmbedLinks(elements)),
      files: structuredClone(files),
    }
    const signature = whiteboardSceneSignature(nextScene)
    if (signature === lastSceneSignatureRef.current)
      return
    lastSceneSignatureRef.current = signature
    pendingSceneRef.current = nextScene
    scheduleSceneWrite()
  }, [scheduleSceneWrite])

  const handlePointerDown = useCallback(() => {
    pointerInteractionRef.current = true
  }, [])

  const handlePointerUp = useCallback(() => {
    pointerInteractionRef.current = false
    scheduleSceneWrite()
  }, [scheduleSceneWrite])

  const insertEditor = useCallback(() => {
    const api = apiRef.current
    if (!api)
      throw new Error(`WhiteboardTopic ${topic.topicId} Excalidraw API is not ready`)
    const appState = api.getAppState()
    const zoom = appState.zoom.value
    if (zoom <= 0)
      throw new Error(`WhiteboardTopic ${topic.topicId} has an invalid canvas zoom`)
    const x = -appState.scrollX + (appState.width / zoom - editorEmbedWidth) / 2
    const y = -appState.scrollY + (appState.height / zoom - editorEmbedHeight) / 2
    const editorId = topic.createEmbeddedEditor({ mode: EditorMode.Document })
    const element = newEmbeddableElement({
      backgroundColor: '#ffffff',
      customData: { memoriloEmbed: { editorId, kind: editorEmbedKind } },
      fillStyle: 'solid',
      height: editorEmbedHeight,
      link: null,
      roughness: 0,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
      strokeColor: '#c9ced6',
      strokeStyle: 'solid',
      strokeWidth: 1,
      type: 'embeddable',
      width: editorEmbedWidth,
      x,
      y,
    })
    api.updateScene({
      appState: { selectedElementIds: { [element.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      elements: [...api.getSceneElementsIncludingDeleted(), element],
    })
    api.scrollToContent(element, { animate: false, fitToContent: true, maxZoom: 1, viewportZoomFactor: 0.8 })
  }, [topic])

  const renderEmbeddable = useCallback((element: ExcalidrawEmbeddableElement) => {
    const embed = editorEmbedData(element)
    return embed
      ? <EmbeddedWhiteboardEditor adapters={adapters} learningEnabled={learningEnabled} shortcuts={shortcuts} topic={topic.getEmbeddedEditor(embed.editorId)} />
      : null
  }, [adapters, learningEnabled, shortcuts, topic])

  const renderToolbarUI = useCallback(() => (
    <button
      {...stylex.props(whiteboardEditorStyles.insertEditorButton)}
      aria-label={t('insertWhiteboardEditor')}
      data-whiteboard-action="insert-editor"
      title={t('insertWhiteboardEditor')}
      type="button"
      onClick={insertEditor}
    >
      <NotebookPen aria-hidden="true" size={17} strokeWidth={1.8} />
    </button>
  ), [insertEditor, t])

  const handleDuplicate = useCallback((
    nextElements: readonly ExcalidrawElement[],
    previousElements: readonly ExcalidrawElement[],
  ) => {
    const previousIds = new Set(previousElements.map(element => element.id))
    return nextElements.map((element) => {
      if (previousIds.has(element.id) || !isEditorEmbed(element))
        return element
      const embed = editorEmbedData(element)
      if (!embed)
        throw new Error(`Whiteboard embed ${element.id} is missing its Embedded Editor identity`)
      const editorId = topic.duplicateEmbeddedEditor(embed.editorId)
      return {
        ...element,
        customData: {
          ...element.customData,
          memoriloEmbed: { editorId, kind: editorEmbedKind },
        },
        link: null,
      }
    })
  }, [topic])

  const isEmbeddableLinkEnabled = useCallback(
    (element: ExcalidrawEmbeddableElement) => !isEditorEmbed(element),
    [],
  )

  useEffect(() => {
    const signature = whiteboardSceneSignature(scene)
    if (signature === lastSceneSignatureRef.current)
      return
    lastSceneSignatureRef.current = signature
    const elements = scene.elements
    if (!Array.isArray(elements))
      throw new Error(`WhiteboardTopic ${topic.topicId} scene elements must be an array`)
    const appState = scene.appState
    if (appState !== undefined && (appState === null || typeof appState !== 'object' || Array.isArray(appState)))
      throw new Error(`WhiteboardTopic ${topic.topicId} scene appState must be an object`)
    apiRef.current?.updateScene({
      elements: withoutEditorEmbedLinks(elements as ExcalidrawElement[]),
      ...(appState === undefined ? {} : { appState: appState as AppState }),
    })
  }, [scene, topic.topicId])

  return (
    <div
      {...stylex.props(whiteboardEditorStyles.root)}
      data-note-inspector-visible={inspectorVisible}
      data-topic-type="whiteboard"
    >
      <Excalidraw
        excalidrawAPI={setExcalidrawAPI}
        initialData={initialData}
        onChange={handleChange}
        onDuplicate={handleDuplicate}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        isEmbeddableLinkEnabled={isEmbeddableLinkEnabled}
        renderEmbeddable={renderEmbeddable}
        renderToolbarUI={renderToolbarUI}
      />
    </div>
  )
}
