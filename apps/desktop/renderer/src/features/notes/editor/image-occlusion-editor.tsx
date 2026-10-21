import type {
  EditorImageOcclusionTopicDocument,
  OcclusionShape,
} from '@memorilo/editor'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  containOcclusionBoundsShape,
  minimumOcclusionShapeSize,
  shouldRegroupImageOcclusionShapes,
  transformOcclusionBrushShape,
  translateOcclusionBrushShape,
} from '@memorilo/editor'
import * as stylex from '@stylexjs/stylex'
import {
  Circle,
  Combine,
  Copy,
  LoaderCircle,
  MousePointer2,
  PenTool,
  Redo2,
  Square,
  Trash2,
  Undo2,
  Unlink,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva'
import {
  clamp,
  normalizedPoint,
  shapeNodes,
  shapeWithOffset,
  viewportFor,
} from './image-occlusion-canvas'
import {
  useElementSize,
  useImage,
  useImageOcclusionState,
  useOcclusionHistory,
} from './image-occlusion-editor-state'
import { imageOcclusionEditorStyles as styles } from './image-occlusion-editor.stylex'

type Tool = 'brush' | 'ellipse' | 'rectangle' | 'select'

export function ImageOcclusionEditor({
  onRename,
  title,
  topic,
}: {
  onRename: (title: string) => void
  title: string
  topic: EditorImageOcclusionTopicDocument
}) {
  const { t } = useTranslation('editor')
  const state = useImageOcclusionState(topic)
  const history = useOcclusionHistory(topic, state)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [draft, setDraft] = useState<OcclusionShape | null>(null)
  const [titleDraftState, setTitleDraftState] = useState(() => ({ source: title, value: title }))
  const titleDraft = titleDraftState.source === title ? titleDraftState.value : title
  const setTitleDraft = useCallback((value: string) => {
    setTitleDraftState({ source: title, value })
  }, [title])
  const shellRef = useRef<HTMLDivElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const shapeRefs = useRef(new Map<string, Konva.Node>())
  const drawingStart = useRef<{ x: number, y: number } | null>(null)
  const size = useElementSize(shellRef)
  const loaded = useImage(state.image.src)
  const viewport = useMemo(
    () => viewportFor(size.width, size.height, state.image.width, state.image.height),
    [size.height, size.width, state.image.height, state.image.width],
  )
  const shapeIds = useMemo(() => new Set(state.shapes.map(shape => shape.id)), [state.shapes])
  const selectedShapeIds = useMemo(
    () => selectedIds.filter(id => shapeIds.has(id)),
    [selectedIds, shapeIds],
  )
  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer)
      return
    const transformableIds = selectedShapeIds.length === 1 ? selectedShapeIds : []
    transformer.nodes(transformableIds.flatMap((id) => {
      const node = shapeRefs.current.get(id)
      return node ? [node] : []
    }))
    transformer.getLayer()?.batchDraw()
  }, [selectedShapeIds, state.shapes, viewport])

  const replaceShape = useCallback((shapeId: string, next: OcclusionShape) => {
    history.write({
      ...state,
      shapes: state.shapes.map(shape => shape.id === shapeId ? next : shape),
    })
  }, [history, state])

  const handleSelect = useCallback((shapeId: string, event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    event.cancelBubble = true
    if (tool !== 'select')
      return
    const additive = 'evt' in event && 'shiftKey' in event.evt && event.evt.shiftKey === true
    setSelectedIds((current) => {
      const validCurrent = current.filter(id => shapeIds.has(id))
      return additive
        ? validCurrent.includes(shapeId) ? validCurrent.filter(id => id !== shapeId) : [...validCurrent, shapeId]
        : [shapeId]
    })
  }, [shapeIds, tool])

  const handleDragEnd = useCallback((shape: OcclusionShape, event: KonvaEventObject<DragEvent>) => {
    const node = event.target
    if (shape.kind === 'brush') {
      const dx = node.x() / viewport.imageWidth
      const dy = node.y() / viewport.imageHeight
      node.position({ x: 0, y: 0 })
      replaceShape(shape.id, translateOcclusionBrushShape(shape, dx, dy))
      return
    }
    const width = shape.width
    const height = shape.height
    const x = shape.kind === 'ellipse'
      ? (node.x() - viewport.imageX) / viewport.imageWidth - width / 2
      : (node.x() - viewport.imageX) / viewport.imageWidth
    const y = shape.kind === 'ellipse'
      ? (node.y() - viewport.imageY) / viewport.imageHeight - height / 2
      : (node.y() - viewport.imageY) / viewport.imageHeight
    replaceShape(shape.id, containOcclusionBoundsShape({ ...shape, x, y }))
  }, [replaceShape, viewport])

  const handleTransformEnd = useCallback((shape: OcclusionShape, event: KonvaEventObject<Event>) => {
    const node = event.target
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scale({ x: 1, y: 1 })
    if (shape.kind === 'brush') {
      const dx = node.x() / viewport.imageWidth
      const dy = node.y() / viewport.imageHeight
      node.position({ x: 0, y: 0 })
      replaceShape(shape.id, transformOcclusionBrushShape(shape, scaleX, scaleY, dx, dy))
      return
    }
    const width = clamp(shape.width * Math.abs(scaleX), minimumOcclusionShapeSize)
    const height = clamp(shape.height * Math.abs(scaleY), minimumOcclusionShapeSize)
    const x = shape.kind === 'ellipse'
      ? (node.x() - viewport.imageX) / viewport.imageWidth - width / 2
      : (node.x() - viewport.imageX) / viewport.imageWidth
    const y = shape.kind === 'ellipse'
      ? (node.y() - viewport.imageY) / viewport.imageHeight - height / 2
      : (node.y() - viewport.imageY) / viewport.imageHeight
    replaceShape(shape.id, containOcclusionBoundsShape({ ...shape, height, width, x, y }))
  }, [replaceShape, viewport])

  const pointer = useCallback((stage: Konva.Stage, requireInside = false) => {
    const value = stage.getPointerPosition()
    return value ? normalizedPoint(viewport, value, requireInside) : null
  }, [viewport])

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (tool === 'select') {
      if (event.target === event.target.getStage())
        setSelectedIds([])
      return
    }
    const stage = event.target.getStage()
    if (!stage)
      return
    const point = pointer(stage, true)
    if (!point)
      return
    drawingStart.current = point
    const id = crypto.randomUUID()
    if (tool === 'brush') {
      setDraft({
        groupId: id,
        id,
        kind: 'brush',
        points: [point.x, point.y, point.x, point.y],
        strokeWidth: 0.025,
      })
      return
    }
    setDraft({
      groupId: id,
      height: minimumOcclusionShapeSize,
      id,
      kind: tool,
      width: minimumOcclusionShapeSize,
      x: point.x,
      y: point.y,
    })
  }, [pointer, tool])

  const handlePointerMove = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!draft || !drawingStart.current)
      return
    const stage = event.target.getStage()
    if (!stage)
      return
    const point = pointer(stage)
    if (!point)
      return
    if (draft.kind === 'brush') {
      setDraft({ ...draft, points: [...draft.points, point.x, point.y] })
      return
    }
    const start = drawingStart.current
    setDraft({
      ...draft,
      height: Math.max(minimumOcclusionShapeSize, Math.abs(point.y - start.y)),
      width: Math.max(minimumOcclusionShapeSize, Math.abs(point.x - start.x)),
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
    })
  }, [draft, pointer])

  const handlePointerUp = useCallback(() => {
    drawingStart.current = null
    if (!draft)
      return
    const next = draft.kind === 'brush'
      ? draft.points.length >= 4 ? draft : null
      : containOcclusionBoundsShape(draft)
    setDraft(null)
    if (!next)
      return
    history.write({ ...state, shapes: [...state.shapes, next] })
    setSelectedIds([next.id])
  }, [draft, history, state])

  const deleteSelection = useCallback(() => {
    const selected = new Set(selectedShapeIds)
    history.write({ ...state, shapes: state.shapes.filter(shape => !selected.has(shape.id)) })
    setSelectedIds([])
  }, [history, selectedShapeIds, state])

  const copySelection = useCallback(() => {
    const selected = new Set(selectedShapeIds)
    const groupIds = new Map<string, string>()
    const copies = state.shapes.flatMap((shape) => {
      if (!selected.has(shape.id))
        return []
      const groupId = groupIds.get(shape.groupId) ?? crypto.randomUUID()
      groupIds.set(shape.groupId, groupId)
      return [{ ...shapeWithOffset(shape, 0.02), groupId, id: crypto.randomUUID() }]
    })
    if (copies.length === 0)
      return
    history.write({ ...state, shapes: [...state.shapes, ...copies] })
    setSelectedIds(copies.map(shape => shape.id))
  }, [history, selectedShapeIds, state])

  const groupSelection = useCallback(() => {
    if (!shouldRegroupImageOcclusionShapes(state.shapes, selectedShapeIds))
      return
    const selected = new Set(selectedShapeIds)
    const groupId = crypto.randomUUID()
    history.write({
      ...state,
      shapes: state.shapes.map(shape => selected.has(shape.id) ? { ...shape, groupId } : shape),
    })
  }, [history, selectedShapeIds, state])

  const ungroupSelection = useCallback(() => {
    const selected = new Set(selectedShapeIds)
    history.write({
      ...state,
      shapes: state.shapes.map(shape => selected.has(shape.id)
        ? { ...shape, groupId: crypto.randomUUID() }
        : shape),
    })
  }, [history, selectedShapeIds, state])

  const selectedGroupIds = new Set(state.shapes.filter(shape => selectedShapeIds.includes(shape.id)).map(shape => shape.groupId))
  const canGroup = shouldRegroupImageOcclusionShapes(state.shapes, selectedShapeIds)
  const canUngroup = selectedShapeIds.length > 0 && [...selectedGroupIds].some(groupId => (
    state.shapes.filter(shape => shape.groupId === groupId).length > 1
  ))
  const displayedShapes = draft ? [...state.shapes, draft] : state.shapes

  return (
    <div {...stylex.props(styles.root)} data-topic-type="image-occlusion">
      <header {...stylex.props(styles.toolbar)}>
        <input
          {...stylex.props(styles.titleInput)}
          aria-label={t('imageOcclusion.title')}
          data-image-occlusion-field="title"
          value={titleDraft}
          onBlur={() => {
            if (titleDraft !== title)
              onRename(titleDraft)
          }}
          onChange={event => setTitleDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              event.currentTarget.blur()
          }}
        />
        <span {...stylex.props(styles.separator)} />
        <div {...stylex.props(styles.controlGroup)} role="toolbar" aria-label={t('imageOcclusion.tools')}>
          {([
            ['select', MousePointer2],
            ['rectangle', Square],
            ['ellipse', Circle],
            ['brush', PenTool],
          ] as const).map(([id, Icon]) => (
            <button
              key={id}
              {...stylex.props(styles.iconButton, tool === id && styles.iconButtonActive)}
              aria-label={t(`imageOcclusion.tool.${id}`)}
              aria-pressed={tool === id}
              data-image-occlusion-tool={id}
              title={t(`imageOcclusion.tool.${id}`)}
              type="button"
              onClick={() => setTool(id)}
            >
              <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ))}
        </div>
        <div {...stylex.props(styles.controlGroup)} role="group" aria-label={t('imageOcclusion.cardMode')}>
          {(['hide-all', 'hide-one'] as const).map(mode => (
            <button
              key={mode}
              {...stylex.props(styles.modeButton, state.mode === mode && styles.modeButtonActive)}
              aria-pressed={state.mode === mode}
              data-image-occlusion-mode={mode}
              type="button"
              onClick={() => history.write({ ...state, mode })}
            >
              {t(`imageOcclusion.mode.${mode}`)}
            </button>
          ))}
        </div>
        <span {...stylex.props(styles.separator)} />
        <div {...stylex.props(styles.controlGroup)} role="toolbar" aria-label={t('imageOcclusion.editSelection')}>
          <button {...stylex.props(styles.iconButton)} aria-label={t('imageOcclusion.copy')} data-image-occlusion-action="copy" disabled={selectedShapeIds.length === 0} title={t('imageOcclusion.copy')} type="button" onClick={copySelection}>
            <Copy aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          <button {...stylex.props(styles.iconButton)} aria-label={t('imageOcclusion.group')} data-image-occlusion-action="group" disabled={!canGroup} title={t('imageOcclusion.group')} type="button" onClick={groupSelection}>
            <Combine aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          <button {...stylex.props(styles.iconButton)} aria-label={t('imageOcclusion.ungroup')} data-image-occlusion-action="ungroup" disabled={!canUngroup} title={t('imageOcclusion.ungroup')} type="button" onClick={ungroupSelection}>
            <Unlink aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          <button {...stylex.props(styles.iconButton)} aria-label={t('imageOcclusion.delete')} data-image-occlusion-action="delete" disabled={selectedShapeIds.length === 0} title={t('imageOcclusion.delete')} type="button" onClick={deleteSelection}>
            <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
        </div>
        <div {...stylex.props(styles.controlGroup)} role="toolbar" aria-label={t('imageOcclusion.history')}>
          <button {...stylex.props(styles.iconButton)} aria-label={t('imageOcclusion.undo')} disabled={!history.canUndo} title={t('imageOcclusion.undo')} type="button" onClick={history.undo}>
            <Undo2 aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          <button {...stylex.props(styles.iconButton)} aria-label={t('imageOcclusion.redo')} disabled={!history.canRedo} title={t('imageOcclusion.redo')} type="button" onClick={history.redo}>
            <Redo2 aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <div ref={shellRef} {...stylex.props(styles.canvasShell, tool !== 'select' && styles.canvasDraw)}>
        {loaded.image
          ? (
              <Stage
                height={viewport.height}
                width={viewport.width}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onTouchEnd={handlePointerUp}
                onTouchMove={handlePointerMove}
                onTouchStart={handlePointerDown}
              >
                <Layer>
                  <Rect fill="#d9dce2" height={viewport.height} listening={false} width={viewport.width} />
                  <KonvaImage
                    height={viewport.imageHeight}
                    image={loaded.image}
                    listening={false}
                    width={viewport.imageWidth}
                    x={viewport.imageX}
                    y={viewport.imageY}
                  />
                  {displayedShapes.map(shape => shapeNodes(
                    shape,
                    viewport,
                    selectedShapeIds.includes(shape.id),
                    tool === 'select' && draft === null,
                    node => node ? shapeRefs.current.set(shape.id, node) : shapeRefs.current.delete(shape.id),
                    event => handleSelect(shape.id, event),
                    event => handleDragEnd(shape, event),
                    event => handleTransformEnd(shape, event),
                  ))}
                  <Transformer
                    ref={transformerRef}
                    anchorCornerRadius={2}
                    anchorFill="#ffffff"
                    anchorSize={8}
                    anchorStroke="#2563eb"
                    borderStroke="#2563eb"
                    enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                    flipEnabled={false}
                    ignoreStroke
                    rotateEnabled={false}
                  />
                </Layer>
              </Stage>
            )
          : (
              <div {...stylex.props(styles.status)} role={loaded.error ? 'alert' : 'status'}>
                {loaded.error
                  ? t('imageOcclusion.imageLoadFailed')
                  : <LoaderCircle {...stylex.props(styles.spinner)} aria-hidden="true" size={18} />}
              </div>
            )}
      </div>
    </div>
  )
}
