'use client'

import type { ReactNodeViewProps } from 'prosekit/react'
import type { SyntheticEvent } from 'react'
import type {
  EditorImageOcclusionIntegration,
  ImageOcclusionState,
  OcclusionShape,
} from '../../image-occlusion/image-occlusion-model'
import type { MemoriloImageAttrs } from '../../schema/image-schema'
import * as stylex from '@stylexjs/stylex'
import { ImageOff, LoaderCircle, ScanLine } from 'lucide-react'
import { UploadTask } from 'prosekit/extensions/file'
import { NodeSelection } from 'prosekit/pm/state'
import { ResizableHandle, ResizableRoot } from 'prosekit/react/resizable'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  imageOcclusionBoundsStrokeWidth,
  imageOcclusionBrushStrokeWidth,
  imageOcclusionPreviewColor,
  imageOcclusionStateSignature,
  scaleOcclusionBrushPoints,
} from '../../image-occlusion/image-occlusion-model'

import { imageViewStyles } from './image-view.stylex'

const subscribeToNothing = () => () => undefined

function useImageOcclusionPreview(
  integration: EditorImageOcclusionIntegration | undefined,
  imageId: string | null | undefined,
): ImageOcclusionState | null {
  const cached = useRef<{ signature: string | null, state: ImageOcclusionState | null } | null>(null)
  const getSnapshot = useCallback(() => {
    const state = integration && imageId ? integration.getState(imageId) : null
    const signature = state ? imageOcclusionStateSignature(state) : null
    if (cached.current?.signature === signature)
      return cached.current.state
    cached.current = { signature, state }
    return state
  }, [imageId, integration])
  const subscribe = useCallback(
    (listener: () => void) => integration ? integration.subscribe(listener) : subscribeToNothing(),
    [integration],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function previewShape(shape: OcclusionShape, width: number, height: number) {
  const strokeWidth = imageOcclusionBoundsStrokeWidth(width, height)
  if (shape.kind === 'rectangle') {
    return (
      <rect
        key={shape.id}
        fill={imageOcclusionPreviewColor}
        height={shape.height * height}
        stroke={imageOcclusionPreviewColor}
        strokeWidth={strokeWidth}
        width={shape.width * width}
        x={shape.x * width}
        y={shape.y * height}
      />
    )
  }
  if (shape.kind === 'ellipse') {
    return (
      <ellipse
        key={shape.id}
        cx={(shape.x + shape.width / 2) * width}
        cy={(shape.y + shape.height / 2) * height}
        fill={imageOcclusionPreviewColor}
        rx={shape.width * width / 2}
        ry={shape.height * height / 2}
        stroke={imageOcclusionPreviewColor}
        strokeWidth={strokeWidth}
      />
    )
  }
  if (shape.kind !== 'brush')
    throw new TypeError(`Unsupported OcclusionShape kind: ${String(shape.kind)}`)
  const points = scaleOcclusionBrushPoints(shape, width, height).reduce<string[]>((values, value, index) => {
    if (index % 2 === 0)
      values.push(String(value))
    else
      values[values.length - 1] = `${values[values.length - 1]},${value}`
    return values
  }, []).join(' ')
  return (
    <polyline
      key={shape.id}
      fill="none"
      points={points}
      stroke={imageOcclusionPreviewColor}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={imageOcclusionBrushStrokeWidth(shape, width, height)}
    />
  )
}

function ImageOcclusionPreview({ state }: { state: ImageOcclusionState }) {
  return (
    <svg
      {...stylex.props(imageViewStyles.occlusionPreview)}
      aria-hidden="true"
      data-image-occlusion-preview=""
      preserveAspectRatio="none"
      viewBox={`0 0 ${state.image.width} ${state.image.height}`}
    >
      {state.shapes.map(shape => previewShape(shape, state.image.width, state.image.height))}
    </svg>
  )
}

export default function ImageView(props: ReactNodeViewProps & {
  imageOcclusion?: EditorImageOcclusionIntegration
}) {
  const attrs = props.node.attrs as MemoriloImageAttrs
  const url = attrs.src || ''
  const uploading = url.startsWith('blob:')
  const { t } = useTranslation('editor')
  const imageOcclusionPreview = useImageOcclusionPreview(props.imageOcclusion, attrs.imageId)

  const [aspectRatio, setAspectRatio] = useState<number | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [naturalSize, setNaturalSize] = useState<{ height: number, width: number } | null>(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!uploading)
      return

    const uploadTask = UploadTask.get<string>(url)
    if (!uploadTask)
      return

    let canceled = false

    uploadTask.finished.catch((error) => {
      if (canceled)
        return
      setError(String(error))
    })
    const unsubscribeProgress = uploadTask.subscribeProgress(({ loaded, total }) => {
      if (canceled)
        return
      setProgress(total ? loaded / total : 0)
    })

    return () => {
      canceled = true
      unsubscribeProgress()
    }
  }, [url, uploading])

  const handleImageLoad = (event: SyntheticEvent) => {
    const img = event.target as HTMLImageElement
    const { naturalWidth, naturalHeight } = img
    const ratio = naturalWidth / naturalHeight
    if (ratio && Number.isFinite(ratio)) {
      setAspectRatio(ratio)
    }
    if (naturalWidth > 0 && naturalHeight > 0)
      setNaturalSize({ height: naturalHeight, width: naturalWidth })
    if (naturalWidth && naturalHeight && (!attrs.width || !attrs.height)) {
      props.setAttrs({ width: naturalWidth, height: naturalHeight })
    }
  }

  const handleOpenImageOcclusion = async () => {
    if (!props.imageOcclusion)
      throw new Error('Image occlusion integration is unavailable')
    if (!url)
      throw new Error('Image source is unavailable')
    if (!naturalSize)
      throw new Error('Image dimensions are unavailable')
    const imageId = attrs.imageId || crypto.randomUUID()
    if (!attrs.imageId)
      props.setAttrs({ imageId })
    setOpening(true)
    setOpenError(false)
    try {
      await props.imageOcclusion.open({
        image: { ...naturalSize, src: url },
        imageId,
      })
    }
    catch (cause) {
      console.error('Failed to open ImageOcclusionTopic', cause)
      setOpenError(true)
    }
    finally {
      setOpening(false)
    }
  }

  return (
    <ResizableRoot
      width={attrs.width ?? undefined}
      height={attrs.height ?? undefined}
      aspectRatio={aspectRatio}
      onMouseDown={(event) => {
        props.view.focus()
        if (event.button !== 0)
          return
        const position = props.getPos()
        if (typeof position !== 'number')
          throw new TypeError('Image NodeView position is unavailable')
        props.view.dispatch(props.view.state.tr.setSelection(
          NodeSelection.create(props.view.state.doc, position),
        ))
        event.preventDefault()
        event.stopPropagation()
      }}
      onResizeEnd={event => props.setAttrs(event.detail)}
      data-selected={props.selected ? '' : undefined}
      {...stylex.props(imageViewStyles.resizable, props.selected && imageViewStyles.selected)}
    >
      {url && !error && (
        <img
          data-editor-image=""
          src={url}
          onLoad={handleImageLoad}
          alt="upload preview"
          {...stylex.props(imageViewStyles.image)}
        />
      )}
      {imageOcclusionPreview && imageOcclusionPreview.shapes.length > 0
        ? <ImageOcclusionPreview state={imageOcclusionPreview} />
        : null}
      {uploading && !error && (
        <div {...stylex.props(imageViewStyles.overlay)}>
          <LoaderCircle aria-hidden="true" size={18} />
          <div>
            {Math.round(progress * 100)}
            %
          </div>
        </div>
      )}
      {error && (
        <div {...stylex.props(imageViewStyles.overlay, imageViewStyles.error)}>
          <ImageOff aria-hidden="true" size={18} />
          <div>
            Failed to upload image
          </div>
        </div>
      )}
      {props.selected && props.imageOcclusion && !uploading && !error
        ? (
            <div
              {...stylex.props(imageViewStyles.bubble)}
              onMouseDown={event => event.stopPropagation()}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <button
                {...stylex.props(imageViewStyles.bubbleButton)}
                data-image-action="open-occlusion"
                disabled={opening || !naturalSize}
                type="button"
                onClick={() => void handleOpenImageOcclusion()}
              >
                {opening
                  ? <LoaderCircle {...stylex.props(imageViewStyles.spinner)} aria-hidden="true" size={15} />
                  : <ScanLine aria-hidden="true" size={15} strokeWidth={1.9} />}
                <span>{t('ui.openImageOcclusion')}</span>
              </button>
              {openError
                ? <span {...stylex.props(imageViewStyles.bubbleError)} role="alert">{t('ui.openImageOcclusionFailed')}</span>
                : null}
            </div>
          )
        : null}
      <ResizableHandle
        {...stylex.props(imageViewStyles.handle)}
        position="bottom-right"
      />
    </ResizableRoot>
  )
}
