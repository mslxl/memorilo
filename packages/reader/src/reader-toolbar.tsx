import type { ReactNode } from 'react'
import type { ReaderAdapterState } from './internal/reader-adapter'
import type { ReaderSessionEngine } from './internal/reader-session-engine'
import type { ReaderOcrStatus, ReaderScaleCapability } from './types'
import { Button, ButtonGroup } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  ScanLine,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readerShellStyles as readerStyles } from './reader-shell.stylex'

export type ReaderChrome = 'embedded' | 'window'

interface ReaderToolbarProps {
  adapterState: ReaderAdapterState
  annotationCount: number
  annotationEditingEnabled: boolean
  annotationPanelOpen: boolean
  chrome: ReaderChrome
  ocrStatus: ReaderOcrStatus | null
  onToggleAnnotationPanel: () => void
  onToggleRegionSelection: () => void
  regionSelectionActive: boolean
  run: ReaderSessionEngine['run']
  sidebarActions?: ReactNode
  sidebarActionsActive?: boolean
  sourceName?: string
  status: ReaderSessionEngine['state']['status']
  title?: string
  toolbarActions?: ReactNode
}

function scaleActionLabel(
  capability: ReaderScaleCapability,
  direction: 'in' | 'out',
  t: ReturnType<typeof useTranslation<'common'>>['t'],
): string {
  if (capability.kind === 'zoom')
    return direction === 'in' ? t('reader.zoomIn') : t('reader.zoomOut')
  return direction === 'in' ? t('reader.increaseTextSize') : t('reader.decreaseTextSize')
}

export function ReaderToolbar({
  adapterState,
  annotationCount,
  annotationEditingEnabled,
  annotationPanelOpen,
  chrome,
  ocrStatus,
  onToggleAnnotationPanel,
  onToggleRegionSelection,
  regionSelectionActive,
  run,
  sidebarActions,
  sidebarActionsActive = false,
  sourceName,
  status,
  title,
  toolbarActions,
}: ReaderToolbarProps) {
  const { t } = useTranslation('common')
  const scaleCapability = adapterState.capabilities.scale
  const displayTitle = title || adapterState.title || sourceName || t('reader.document')
  const sidebarLabel = annotationEditingEnabled
    ? annotationPanelOpen ? t('reader.hideSidebar') : t('reader.showSidebar')
    : annotationPanelOpen ? t('reader.hideContents') : t('reader.showContents')
  const currentOcrState = adapterState.position.format === 'pdf'
    && ocrStatus?.pageNumber === adapterState.position.pageNumber
    ? ocrStatus.state
    : undefined
  const sidebarButton = (
    <Button
      aria-label={sidebarLabel}
      aria-pressed={annotationPanelOpen}
      data-reader-action="toggle-sidebar"
      data-window-no-drag=""
      title={sidebarLabel}
      variant="toolbar"
      xstyle={[
        readerStyles.button,
        chrome === 'window' && readerStyles.buttonWindow,
        annotationPanelOpen && readerStyles.buttonActive,
      ]}
      onClick={onToggleAnnotationPanel}
    >
      <BookOpenText aria-hidden="true" size={16} strokeWidth={1.8} />
      {annotationCount > 0
        ? <span {...stylex.props(readerStyles.annotationBadge)}>{annotationCount}</span>
        : null}
    </Button>
  )

  const toolbar = (
    <header {...stylex.props(readerStyles.toolbar, chrome === 'window' && readerStyles.toolbarWindow)}>
      {chrome === 'embedded'
        ? (
            <div {...stylex.props(readerStyles.titleGroup)}>
              <h2 {...stylex.props(readerStyles.title)}>{displayTitle}</h2>
              <span {...stylex.props(readerStyles.format)}>{adapterState.format}</span>
              {adapterState.textLayer === 'ocr'
                ? <span {...stylex.props(readerStyles.statusChip)}>{t('reader.ocrText')}</span>
                : null}
              {currentOcrState === 'recognizing'
                ? <span {...stylex.props(readerStyles.statusChip)}>{t('reader.recognizing')}</span>
                : null}
              {adapterState.textLayer === 'none' && currentOcrState !== 'recognizing' && status === 'ready'
                ? <span {...stylex.props(readerStyles.statusChip)}>{t('reader.imagePage')}</span>
                : null}
            </div>
          )
        : (
            <div {...stylex.props(readerStyles.titleGroup, readerStyles.titleGroupWindow)}>
              <h2 {...stylex.props(readerStyles.title)}>{displayTitle}</h2>
            </div>
          )}

      <ButtonGroup
        variant={chrome === 'window' ? 'glass' : 'plain'}
        xstyle={[
          readerStyles.navigation,
          chrome === 'window' && readerStyles.navigationWindow,
        ]}
      >
        <Button
          aria-label={t('reader.previous')}
          data-window-no-drag=""
          disabled={status !== 'ready' || !adapterState.canGoBackward}
          title={t('reader.previous')}
          variant="toolbar"
          xstyle={[readerStyles.button, chrome === 'window' && readerStyles.buttonWindow]}
          onClick={() => run(adapter => adapter.goBackward('end'))}
        >
          <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.9} />
        </Button>
        <span {...stylex.props(readerStyles.location)} aria-live="polite" data-reader-location="">
          {adapterState.location.label || t('reader.opening')}
        </span>
        <Button
          aria-label={t('reader.next')}
          data-window-no-drag=""
          disabled={status !== 'ready' || !adapterState.canGoForward}
          title={t('reader.next')}
          variant="toolbar"
          xstyle={[readerStyles.button, chrome === 'window' && readerStyles.buttonWindow]}
          onClick={() => run(adapter => adapter.goForward('start'))}
        >
          <ChevronRight aria-hidden="true" size={17} strokeWidth={1.9} />
        </Button>
      </ButtonGroup>

      <ButtonGroup
        variant={chrome === 'window' ? 'glass' : 'plain'}
        xstyle={[
          readerStyles.actions,
          chrome === 'window' && readerStyles.actionsWindow,
          chrome === 'window' && sidebarActions !== undefined && readerStyles.actionsWindowWithSidebarActions,
          chrome === 'window' && sidebarActionsActive && readerStyles.actionsWindowWithSidebarActionsActive,
        ]}
      >
        {sidebarButton}
        {toolbarActions}
        {annotationEditingEnabled && adapterState.capabilities.regionSelection
          ? (
              <Button
                aria-label={t('reader.selectArea')}
                aria-pressed={regionSelectionActive}
                data-reader-action="select-area"
                disabled={status !== 'ready'}
                title={t('reader.selectArea')}
                variant="toolbar"
                xstyle={[
                  readerStyles.button,
                  chrome === 'window' && readerStyles.buttonWindow,
                  regionSelectionActive && readerStyles.buttonActive,
                ]}
                onClick={onToggleRegionSelection}
              >
                <ScanLine aria-hidden="true" size={16} strokeWidth={1.8} />
              </Button>
            )
          : null}
        {adapterState.capabilities.ocr
          ? (
              <Button
                aria-label={t('reader.recognizePage')}
                disabled={status !== 'ready' || currentOcrState === 'recognizing'}
                title={t('reader.recognizePage')}
                variant="toolbar"
                xstyle={[readerStyles.button, chrome === 'window' && readerStyles.buttonWindow]}
                onClick={() => run((adapter) => {
                  if (!adapter.recognizeCurrentPage)
                    throw new Error('The reader declared OCR without providing its command')
                  return adapter.recognizeCurrentPage()
                })}
              >
                <Sparkles aria-hidden="true" size={15} strokeWidth={1.8} />
              </Button>
            )
          : null}
        {scaleCapability
          ? (
              <>
                <Button
                  aria-label={scaleActionLabel(scaleCapability, 'out', t)}
                  data-reader-action="scale-out"
                  data-window-no-drag=""
                  disabled={status !== 'ready' || adapterState.scale <= scaleCapability.minimum}
                  title={scaleActionLabel(scaleCapability, 'out', t)}
                  variant="toolbar"
                  xstyle={[readerStyles.button, chrome === 'window' && readerStyles.buttonWindow]}
                  onClick={() => run((adapter) => {
                    if (!adapter.setScale)
                      throw new Error('The reader declared scaling without providing its command')
                    return adapter.setScale(adapterState.scale - scaleCapability.step)
                  })}
                >
                  <Minus aria-hidden="true" size={15} strokeWidth={2} />
                </Button>
                <Button
                  aria-label={scaleActionLabel(scaleCapability, 'in', t)}
                  data-reader-action="scale-in"
                  data-window-no-drag=""
                  disabled={status !== 'ready' || adapterState.scale >= scaleCapability.maximum}
                  title={scaleActionLabel(scaleCapability, 'in', t)}
                  variant="toolbar"
                  xstyle={[readerStyles.button, chrome === 'window' && readerStyles.buttonWindow]}
                  onClick={() => run((adapter) => {
                    if (!adapter.setScale)
                      throw new Error('The reader declared scaling without providing its command')
                    return adapter.setScale(adapterState.scale + scaleCapability.step)
                  })}
                >
                  <Plus aria-hidden="true" size={15} strokeWidth={2} />
                </Button>
              </>
            )
          : null}
      </ButtonGroup>
    </header>
  )
  if (chrome !== 'window' || sidebarActions === undefined)
    return toolbar
  return (
    <>
      {toolbar}
      <ButtonGroup
        data-window-no-drag=""
        variant="glass"
        xstyle={[
          readerStyles.sidebarActions,
          readerStyles.sidebarActionsWindow,
        ]}
      >
        {sidebarActions}
      </ButtonGroup>
    </>
  )
}
