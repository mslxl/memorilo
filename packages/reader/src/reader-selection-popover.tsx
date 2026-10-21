import type { CSSProperties } from 'react'
import type { ReaderAdapterSelection } from './internal/reader-adapter'
import type { ReaderAnnotationColor } from './types'
import * as stylex from '@stylexjs/stylex'
import { Copy, Highlighter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readerSelectionPopoverStyles as readerStyles } from './reader-selection-popover.stylex'
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

function paletteColorPosition(color: ReaderAnnotationColor) {
  if (color === 'green')
    return readerStyles.paletteColorGreen
  if (color === 'blue')
    return readerStyles.paletteColorBlue
  if (color === 'pink')
    return readerStyles.paletteColorPink
  if (color === 'purple')
    return readerStyles.paletteColorPurple
  return readerStyles.paletteColorYellow
}

function popoverLayout(
  selection: ReaderAdapterSelection,
  colorPaletteOpen: boolean,
): { placement: 'above' | 'below', style: CSSProperties } {
  const center = selection.clientRect.left + selection.clientRect.width / 2
  const estimatedWidth = colorPaletteOpen ? 234 : selection.selection.type === 'region' ? 142 : 188
  const estimatedHeight = 52
  const edgeInset = 12
  const halfWidth = Math.min(estimatedWidth / 2, (window.innerWidth - edgeInset * 2) / 2)
  const left = Math.min(window.innerWidth - edgeInset - halfWidth, Math.max(edgeInset + halfWidth, center))
  const placement = selection.clientRect.top >= estimatedHeight + 20 ? 'above' : 'below'
  return {
    placement,
    style: {
      left,
      top: placement === 'above'
        ? selection.clientRect.top - 10
        : selection.clientRect.top + selection.clientRect.height + 10,
    },
  }
}

interface ReaderSelectionPopoverProps {
  annotationEditingEnabled: boolean
  colorPaletteOpen: boolean
  selectedColor: ReaderAnnotationColor
  selection: ReaderAdapterSelection
  onColorPaletteOpenChange: (open: boolean) => void
  onCopy: () => void
  onCreateHighlight: () => void
  onDismiss: () => void
  onSelectedColorChange: (color: ReaderAnnotationColor) => void
}

export function ReaderSelectionPopover({
  annotationEditingEnabled,
  colorPaletteOpen,
  selectedColor,
  selection,
  onColorPaletteOpenChange,
  onCopy,
  onCreateHighlight,
  onDismiss,
  onSelectedColorChange,
}: ReaderSelectionPopoverProps) {
  const { t } = useTranslation('common')
  const layout = popoverLayout(selection, colorPaletteOpen)
  const popoverBelow = layout.placement === 'below'
  const compactRegionToolbar = selection.selection.type === 'region' && !colorPaletteOpen

  return (
    <div
      {...stylex.props(
        readerStyles.glassPopover,
        readerStyles.selectionToolbar,
        colorPaletteOpen && readerStyles.selectionToolbarPalette,
        !annotationEditingEnabled && readerStyles.selectionToolbarCopyOnly,
        compactRegionToolbar && readerStyles.selectionToolbarRegion,
        popoverBelow ? readerStyles.popoverBelow : readerStyles.popoverAbove,
      )}
      aria-label={t('reader.selectionActions')}
      data-reader-capture-overlay="true"
      data-reader-toolbar="selection"
      role="toolbar"
      style={layout.style}
    >
      {annotationEditingEnabled && colorPaletteOpen
        ? annotationColors.map(color => (
            <button
              key={color}
              {...stylex.props(
                readerStyles.paletteSwatch,
                paletteColorPosition(color),
                colorStyle(color),
                selectedColor === color && readerStyles.colorButtonSelected,
              )}
              aria-label={t('reader.colorAnnotation', { color: t(`reader.colors.${color}`) })}
              aria-pressed={selectedColor === color}
              data-reader-action="select-color"
              data-reader-color={color}
              title={t('reader.useColor', { color: t(`reader.colors.${color}`) })}
              type="button"
              onClick={() => {
                onSelectedColorChange(color)
                onColorPaletteOpenChange(false)
              }}
            />
          ))
        : (
            <>
              {selection.selection.type === 'text'
                ? (
                    <button
                      {...stylex.props(readerStyles.paletteTool, readerStyles.paletteCopy)}
                      aria-label={t('reader.copySelection')}
                      data-reader-action="copy-selection"
                      title={t('copy')}
                      type="button"
                      onClick={onCopy}
                    >
                      <Copy aria-hidden="true" size={18} strokeWidth={1.85} />
                    </button>
                  )
                : null}
              {annotationEditingEnabled
                ? (
                    <>
                      <button
                        {...stylex.props(
                          readerStyles.paletteTool,
                          readerStyles.paletteColorTool,
                          readerStyles.paletteColor,
                          selection.selection.type === 'region' && readerStyles.paletteColorRegion,
                        )}
                        aria-label={t('reader.chooseAnnotationColor')}
                        aria-expanded={colorPaletteOpen}
                        data-reader-action="choose-color"
                        title={t('reader.color')}
                        type="button"
                        onClick={() => onColorPaletteOpenChange(true)}
                      >
                        <span {...stylex.props(readerStyles.paletteCurrentColor, colorStyle(selectedColor))} />
                      </button>
                      <button
                        {...stylex.props(
                          readerStyles.paletteTool,
                          readerStyles.paletteHighlight,
                          selection.selection.type === 'region' && readerStyles.paletteHighlightRegion,
                        )}
                        aria-label={selection.selection.type === 'text'
                          ? t('reader.highlightSelection')
                          : t('reader.highlightArea')}
                        data-reader-action={selection.selection.type === 'text' ? 'highlight-selection' : 'highlight-area'}
                        title={t('reader.highlight')}
                        type="button"
                        onClick={onCreateHighlight}
                      >
                        <Highlighter aria-hidden="true" size={19} strokeWidth={1.85} />
                      </button>
                    </>
                  )
                : null}
            </>
          )}
      <button
        {...stylex.props(readerStyles.paletteTool, readerStyles.paletteClose)}
        aria-label={t('reader.dismissSelectionActions')}
        data-reader-action="dismiss-selection"
        title={t('reader.close')}
        type="button"
        onClick={onDismiss}
      >
        <X aria-hidden="true" size={18} strokeWidth={1.85} />
      </button>
    </div>
  )
}
