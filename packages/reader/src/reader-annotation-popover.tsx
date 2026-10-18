import type { CSSProperties } from 'react'
import type {
  ReaderAnnotation,
  ReaderAnnotationColor,
  ReaderAnnotationStyle,
} from './types'
import * as stylex from '@stylexjs/stylex'
import { Copy, EyeOff, Highlighter, StickyNote, Trash2, Underline, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readerAnnotationPopoverStyles as styles } from './reader-annotation-popover.stylex'
import { readerSharedStyles } from './reader-theme.stylex'

const annotationColors: readonly ReaderAnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

function colorStyle(color: ReaderAnnotationColor) {
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

function popoverPosition(rect: { height: number, left: number, top: number, width: number }): {
  below: boolean
  style: CSSProperties
} {
  const edgeInset = 12
  const width = 320
  const halfWidth = Math.min(width / 2, (window.innerWidth - edgeInset * 2) / 2)
  const center = rect.left + rect.width / 2
  const left = Math.min(window.innerWidth - edgeInset - halfWidth, Math.max(edgeInset + halfWidth, center))
  const below = rect.top < 64
  return {
    below,
    style: {
      left,
      top: below ? rect.top + rect.height + 10 : rect.top - 10,
    },
  }
}

export function ReaderAnnotationPopover({
  annotation,
  anchorRect,
  colorPaletteOpen,
  creatingTopic,
  onAddAnnotation,
  onColorChange,
  onColorPaletteOpenChange,
  onCopy,
  onDelete,
  onDismiss,
  onOpenImageOcclusion,
  onStyleChange,
  openingImageOcclusion,
}: {
  annotation: ReaderAnnotation
  anchorRect: { height: number, left: number, top: number, width: number }
  colorPaletteOpen: boolean
  creatingTopic: boolean
  onAddAnnotation: () => void
  onColorChange: (color: ReaderAnnotationColor) => void
  onColorPaletteOpenChange: (open: boolean) => void
  onCopy: () => void
  onDelete: () => void
  onDismiss: () => void
  onOpenImageOcclusion?: () => void
  onStyleChange: (style: ReaderAnnotationStyle) => void
  openingImageOcclusion: boolean
}) {
  const { t } = useTranslation('common')
  const position = popoverPosition(anchorRect)
  return (
    <div
      {...stylex.props(styles.popover, position.below && styles.below)}
      aria-label={t('reader.annotationActions')}
      data-reader-capture-overlay="true"
      data-reader-toolbar="annotation"
      role="toolbar"
      style={position.style}
    >
      <button {...stylex.props(styles.tool)} aria-label={t('reader.close')} data-reader-action="dismiss-annotation" title={t('reader.close')} type="button" onClick={onDismiss}>
        <X aria-hidden="true" size={17} strokeWidth={1.9} />
      </button>
      {colorPaletteOpen
        ? (
            <div {...stylex.props(styles.colorPalette)} aria-label={t('reader.annotationColor')} role="group">
              {annotationColors.map(color => (
                <button
                  key={color}
                  {...stylex.props(styles.colorButton, colorStyle(color), annotation.color === color && styles.colorSelected)}
                  aria-label={t('reader.colorAnnotation', { color: t(`reader.colors.${color}`) })}
                  aria-pressed={annotation.color === color}
                  data-reader-action="select-color"
                  data-reader-color={color}
                  title={t('reader.useColor', { color: t(`reader.colors.${color}`) })}
                  type="button"
                  onClick={() => onColorChange(color)}
                />
              ))}
            </div>
          )
        : (
            <>
              {annotation.anchors[0].type === 'text'
                ? (
                    <button {...stylex.props(styles.tool)} aria-label={t('reader.copyAnnotationText')} title={t('copy')} type="button" onClick={onCopy}>
                      <Copy aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                  )
                : null}
              <button
                {...stylex.props(styles.tool)}
                aria-label={t('reader.chooseAnnotationColor')}
                aria-expanded={colorPaletteOpen}
                data-reader-action="choose-color"
                title={t('reader.color')}
                type="button"
                onClick={() => onColorPaletteOpenChange(true)}
              >
                <span {...stylex.props(styles.swatch, colorStyle(annotation.color))} />
              </button>
              {annotation.anchors[0].type === 'text'
                ? (
                    <>
                      <button
                        {...stylex.props(styles.tool, annotation.style === 'highlight' && styles.toolActive)}
                        aria-label={t('reader.highlightStyle')}
                        aria-pressed={annotation.style === 'highlight'}
                        data-reader-action="set-style-highlight"
                        title={t('reader.highlightStyle')}
                        type="button"
                        onClick={() => onStyleChange('highlight')}
                      >
                        <Highlighter aria-hidden="true" size={17} strokeWidth={1.9} />
                      </button>
                      <button
                        {...stylex.props(styles.tool, annotation.style === 'underline' && styles.toolActive)}
                        aria-label={t('reader.underlineStyle')}
                        aria-pressed={annotation.style === 'underline'}
                        data-reader-action="set-style-underline"
                        title={t('reader.underlineStyle')}
                        type="button"
                        onClick={() => onStyleChange('underline')}
                      >
                        <Underline aria-hidden="true" size={17} strokeWidth={1.9} />
                      </button>
                    </>
                  )
                : null}
              {annotation.anchors[0].type === 'region' && onOpenImageOcclusion !== undefined
                ? (
                    <button
                      {...stylex.props(styles.tool)}
                      aria-label={t('reader.openImageOcclusion')}
                      data-reader-action="open-image-occlusion"
                      disabled={openingImageOcclusion}
                      title={t('reader.openImageOcclusion')}
                      type="button"
                      onClick={onOpenImageOcclusion}
                    >
                      <EyeOff aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                  )
                : null}
              {annotation.annotationTopicId === undefined
                ? (
                    <button
                      {...stylex.props(styles.tool)}
                      aria-label={t('reader.addAnnotation')}
                      data-reader-action="add-annotation"
                      disabled={creatingTopic}
                      title={t('reader.addAnnotation')}
                      type="button"
                      onClick={onAddAnnotation}
                    >
                      <StickyNote aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                  )
                : null}
              <span {...stylex.props(styles.divider)} />
              <button {...stylex.props(styles.tool, styles.destructive)} aria-label={t('reader.deleteHighlight')} data-reader-action="delete-highlight" title={t('reader.deleteHighlight')} type="button" onClick={onDelete}>
                <Trash2 aria-hidden="true" size={16} strokeWidth={1.9} />
              </button>
            </>
          )}
    </div>
  )
}
