import type { ReactNode, UIEvent } from 'react'
import type { ReaderAdapter, ReaderAdapterState } from './internal/reader-adapter'
import type {
  ReaderAnnotation,
  ReaderAuxiliarySidebar,
  ReaderImageOcclusionOverlay,
  ReaderNormalizedRect,
} from './types'
import { readingAnnotationFirstAnchor, readingAnnotationText } from '@memorilo/reading-model'
import * as stylex from '@stylexjs/stylex'
import { BookOpenText, ScanLine, StickyNote } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { readerAnnotationLabel } from './internal/annotation-label'
import { ReaderOutline } from './reader-outline'
import { readerSidebarStyles as readerStyles } from './reader-sidebar.stylex'
import { readerSharedStyles } from './reader-theme.stylex'

export type ReaderSidebarTab = 'annotations' | 'contents'

interface ReaderSidebarProps {
  activeAnnotationId: string | null
  adapterState: ReaderAdapterState
  annotationEditingEnabled: boolean
  annotationPanelOpen: boolean
  annotationRenderLimit: number
  annotations: readonly ReaderAnnotation[]
  auxiliarySidebar?: ReaderAuxiliarySidebar
  auxiliarySidebarActive: boolean
  imageOcclusionOverlays: readonly ReaderImageOcclusionOverlay[]
  onActivateAnnotation: (annotationId: string) => void
  onAuxiliarySidebarSelect: () => void
  onLoadMoreAnnotations: (event: UIEvent<HTMLDivElement>) => void
  onSelectAnnotation: (annotationId: string) => void
  onTabChange: (tab: ReaderSidebarTab) => void
  registerAnnotationCard: (annotationId: string, element: HTMLElement | null) => void
  renderAnnotationEditor?: (annotation: ReaderAnnotation, readOnly: boolean) => ReactNode
  run: (operation: (adapter: ReaderAdapter) => Promise<void>) => void
  sidebarTab: ReaderSidebarTab
}

function annotationQuote(annotation: ReaderAnnotation): string | null {
  return readingAnnotationText(annotation)
}

function colorStyle(color: ReaderAnnotation['color']) {
  if (color === 'green')
    return readerSharedStyles.colorGreen
  if (color === 'blue')
    return readerSharedStyles.colorBlue
  if (color === 'pink')
    return readerSharedStyles.colorPink
  if (color === 'purple')
    return readerSharedStyles.colorPurple
  return readerSharedStyles.colorYellow
}

const txtRegionPreviewRect: ReaderNormalizedRect = {
  height: 0.18,
  width: 0.64,
  x: 0.18,
  y: 0.41,
}

function annotationRegionPreviewRect(annotation: ReaderAnnotation): ReaderNormalizedRect {
  const anchor = readingAnnotationFirstAnchor(annotation)
  if (anchor.type !== 'region')
    throw new TypeError(`Reader annotation ${annotation.id} is not a region`)
  if ('rect' in anchor)
    return anchor.rect
  if (anchor.format === 'txt')
    return txtRegionPreviewRect
  if (anchor.targets.length === 0)
    throw new Error(`Reader EPUB region annotation ${annotation.id} has no targets`)
  const left = Math.min(...anchor.targets.map(target => target.rect.x))
  const top = Math.min(...anchor.targets.map(target => target.rect.y))
  const right = Math.max(...anchor.targets.map(target => target.rect.x + target.rect.width))
  const bottom = Math.max(...anchor.targets.map(target => target.rect.y + target.rect.height))
  return { height: bottom - top, width: right - left, x: left, y: top }
}

function RegionAnnotationPreview({
  annotation,
  imageOcclusion,
  label,
}: {
  annotation: ReaderAnnotation
  imageOcclusion: ReaderImageOcclusionOverlay | undefined
  label: string
}) {
  const rect = annotationRegionPreviewRect(annotation)
  return (
    <div {...stylex.props(readerStyles.regionPreview)} aria-label={label} data-reader-region-preview="" role="img">
      {imageOcclusion
        ? (
            <img
              {...stylex.props(readerStyles.regionPreviewImage)}
              alt=""
              aria-hidden="true"
              draggable={false}
              src={imageOcclusion.image.src}
            />
          )
        : (
            <div {...stylex.props(readerStyles.regionPreviewPage)}>
              <span
                {...stylex.props(readerStyles.regionPreviewSelection, colorStyle(annotation.color))}
                style={{
                  height: `${rect.height * 100}%`,
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                }}
              />
            </div>
          )}
    </div>
  )
}

export function ReaderSidebar({
  activeAnnotationId,
  adapterState,
  annotationEditingEnabled,
  annotationPanelOpen,
  annotationRenderLimit,
  annotations,
  auxiliarySidebar,
  auxiliarySidebarActive,
  imageOcclusionOverlays,
  onActivateAnnotation,
  onAuxiliarySidebarSelect,
  onLoadMoreAnnotations,
  onSelectAnnotation,
  onTabChange,
  registerAnnotationCard,
  renderAnnotationEditor,
  run,
  sidebarTab,
}: ReaderSidebarProps) {
  const { t } = useTranslation('common')
  const imageOcclusionByAnnotationId = useMemo(() => {
    const byAnnotationId = new Map<string, ReaderImageOcclusionOverlay>()
    for (const overlay of imageOcclusionOverlays) {
      if (byAnnotationId.has(overlay.annotationId))
        throw new Error(`Reader annotation ${overlay.annotationId} has multiple image occlusion overlays`)
      byAnnotationId.set(overlay.annotationId, overlay)
    }
    return byAnnotationId
  }, [imageOcclusionOverlays])
  if (annotations.some(annotation => annotation.annotationTopicId !== undefined)
    && renderAnnotationEditor === undefined) {
    throw new Error('Reader annotation Topics require an Editor renderer')
  }

  return (
    <aside
      {...stylex.props(
        readerStyles.annotationPanel,
        !annotationPanelOpen && readerStyles.annotationPanelClosed,
      )}
      aria-label={t('reader.sidebar')}
      aria-hidden={!annotationPanelOpen}
      inert={!annotationPanelOpen}
    >
      <div {...stylex.props(readerStyles.panelHeader)} role="tablist" aria-label={t('reader.sidebarViews')}>
        <button
          {...stylex.props(
            readerStyles.sidebarTab,
            !auxiliarySidebarActive && sidebarTab === 'contents' && readerStyles.sidebarTabActive,
          )}
          aria-controls="reader-contents-panel"
          aria-selected={!auxiliarySidebarActive && sidebarTab === 'contents'}
          data-reader-tab="contents"
          role="tab"
          type="button"
          onClick={() => onTabChange('contents')}
        >
          <BookOpenText aria-hidden="true" size={14} strokeWidth={1.8} />
          {t('reader.contents')}
        </button>
        {annotationEditingEnabled
          ? (
              <button
                {...stylex.props(
                  readerStyles.sidebarTab,
                  !auxiliarySidebarActive && sidebarTab === 'annotations' && readerStyles.sidebarTabActive,
                )}
                aria-controls="reader-annotations-panel"
                aria-selected={!auxiliarySidebarActive && sidebarTab === 'annotations'}
                data-reader-tab="annotations"
                role="tab"
                type="button"
                onClick={() => onTabChange('annotations')}
              >
                <StickyNote aria-hidden="true" size={14} strokeWidth={1.8} />
                {t('reader.annotations')}
                {annotations.length > 0
                  ? <span {...stylex.props(readerStyles.tabCount)}>{annotations.length}</span>
                  : null}
              </button>
            )
          : null}
        {auxiliarySidebar !== undefined
          ? (
              <button
                {...stylex.props(readerStyles.sidebarTab, auxiliarySidebarActive && readerStyles.sidebarTabActive)}
                aria-controls="reader-auxiliary-panel"
                aria-selected={auxiliarySidebarActive}
                role="tab"
                type="button"
                onClick={onAuxiliarySidebarSelect}
              >
                {auxiliarySidebar.icon}
                {auxiliarySidebar.label}
              </button>
            )
          : null}
      </div>

      {auxiliarySidebarActive && auxiliarySidebar !== undefined
        ? (
            <div
              id="reader-auxiliary-panel"
              {...stylex.props(readerStyles.panelContent, readerStyles.auxiliaryPanel)}
              role="tabpanel"
            >
              {auxiliarySidebar.content}
            </div>
          )
        : sidebarTab === 'contents'
          ? (
              <div id="reader-contents-panel" {...stylex.props(readerStyles.panelContent)} role="tabpanel">
                {adapterState.outline.length === 0
                  ? <div {...stylex.props(readerStyles.emptyAnnotations)}>{t('reader.noContents')}</div>
                  : (
                      <ReaderOutline
                        key={`${adapterState.title}:${adapterState.outline.length}`}
                        currentHref={adapterState.location.href}
                        items={adapterState.outline}
                        onNavigate={itemId => run((adapter) => {
                          if (!adapter.goToOutlineItem)
                            throw new Error('The reader exposed an outline without providing its navigation command')
                          return adapter.goToOutlineItem(itemId)
                        })}
                      />
                    )}
              </div>
            )
          : (
              <div
                id="reader-annotations-panel"
                {...stylex.props(readerStyles.annotationList)}
                role="tabpanel"
                onScroll={onLoadMoreAnnotations}
              >
                {annotations.length === 0
                  ? <div {...stylex.props(readerStyles.emptyAnnotations)}>{t('reader.noAnnotations')}</div>
                  : annotations.slice(0, annotationRenderLimit).map((annotation) => {
                      const quote = annotationQuote(annotation)
                      const active = activeAnnotationId === annotation.id
                      const label = readerAnnotationLabel(annotation, t)
                      const imageOcclusion = imageOcclusionByAnnotationId.get(annotation.id)
                      return (
                        <article
                          key={annotation.id}
                          ref={element => registerAnnotationCard(annotation.id, element)}
                          {...stylex.props(
                            readerStyles.annotationItem,
                            active && readerStyles.annotationItemActive,
                          )}
                          aria-label={label}
                          data-reader-annotation-id={annotation.id}
                          data-reader-annotation-kind={annotation.anchors[0].type}
                          onClick={() => onSelectAnnotation(annotation.id)}
                          onPointerDown={() => onActivateAnnotation(annotation.id)}
                        >
                          <button
                            {...stylex.props(readerStyles.annotationTarget)}
                            data-reader-action="select-annotation"
                            type="button"
                          >
                            <span {...stylex.props(readerStyles.annotationDot, colorStyle(annotation.color))} />
                            <span {...stylex.props(readerStyles.annotationMeta)}>
                              {label}
                            </span>
                          </button>
                          {quote
                            ? <blockquote {...stylex.props(readerStyles.annotationQuote)}>{quote}</blockquote>
                            : null}
                          {annotation.anchors[0].type === 'region'
                            ? (
                                <RegionAnnotationPreview
                                  annotation={annotation}
                                  imageOcclusion={imageOcclusion}
                                  label={label}
                                />
                              )
                            : null}
                          {imageOcclusion
                            ? (
                                <div {...stylex.props(readerStyles.annotationStatus)} data-reader-annotation-status="image-occlusion">
                                  <ScanLine aria-hidden="true" size={12} strokeWidth={1.8} />
                                  {t('reader.annotation.imageOcclusion')}
                                </div>
                              )
                            : null}
                          {annotation.annotationTopicId !== undefined
                            ? (
                                <div
                                  {...stylex.props(readerStyles.annotationEditor)}
                                  onClick={event => event.stopPropagation()}
                                >
                                  {renderAnnotationEditor?.(annotation, !active)}
                                </div>
                              )
                            : null}
                        </article>
                      )
                    })}
              </div>
            )}
    </aside>
  )
}
