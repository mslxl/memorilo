import type { PageTitlebarOptions } from '../../shared/page-titlebar'
import { ButtonGroup, EditableTitle } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Match } from 'effect'
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'
import { PageTitlebarButton } from '../../shared/page-titlebar-button'
import { getPlatform } from '../../shared/platform'
import { router } from '../router'
import { appTitlebarStyles } from './app-titlebar.stylex'

interface HistoryPosition {
  index: number
  maxIndex: number
}

const navigationSpring = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.3,
} as const

function historyIndex(): number {
  return router.history.location.state.__TSR_index
}

export function AppTitlebar({
  page,
  sidebarVisible,
}: {
  page: PageTitlebarOptions | null
  sidebarVisible: boolean
}) {
  const { t } = useTranslation('app')
  const [historyPosition, setHistoryPosition] = useState<HistoryPosition>(() => {
    const index = historyIndex()
    return { index, maxIndex: index }
  })
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => router.history.subscribe(({ action, location }) => {
    const index = location.state.__TSR_index
    setHistoryPosition(current => ({
      index,
      maxIndex: action.type === 'PUSH' ? index : Math.max(current.maxIndex, index),
    }))
  }), [])

  useEffect(() => {
    const platform = getPlatform()
    const customChrome = platform === 'windows' || platform === 'linux'
    const appName = customChrome ? 'Memorilo' : t('appTitle')
    const suffix = customChrome ? '— Memorilo' : t('appTitleSuffix')
    document.title = page?.title ? `${page.title} ${suffix}` : appName
  }, [page?.title, t])

  const canGoBack = historyPosition.index > 0
  const canGoForward = historyPosition.index < historyPosition.maxIndex
  const compactCanvasTitlebar = page?.titleVisibility === 'hidden'
  // macOS reserves the upper-left corner for the native traffic lights. Keep
  // that extra inset only on macOS; Windows and Linux have no renderer-side
  // traffic-light area to reserve.
  const navigationOffset = Match.value({
    compactCanvasTitlebar,
    platform: getPlatform(),
    sidebarVisible,
  }).pipe(
    Match.when(({ sidebarVisible }) => sidebarVisible, () => 270),
    Match.when(({ compactCanvasTitlebar }) => compactCanvasTitlebar, () => 55),
    Match.when(({ platform }) => platform === 'macos', () => 164),
    Match.orElse(() => 55),
  )
  const leadingOffset = navigationOffset + 76

  return (
    <header
      {...stylex.props(
        appTitlebarStyles.titlebar,
        page?.titleVisibility === 'hidden' && appTitlebarStyles.titlebarPassThrough,
      )}
      data-window-drag={page?.titleVisibility === 'hidden' ? undefined : ''}
    >
      {page?.navigation !== 'hidden'
        ? (
            <ButtonGroup asChild variant="glass" aria-label={t('pageNavigation')} xstyle={appTitlebarStyles.navigationGroup}>
              <motion.div
                animate={{ left: navigationOffset }}
                initial={false}
                transition={shouldReduceMotion ? { duration: 0 } : navigationSpring}
              >
                <PageTitlebarButton
                  disabled={!canGoBack}
                  label={t('back')}
                  title={canGoBack ? t('back') : t('noPreviousPage')}
                  onClick={() => router.history.back()}
                >
                  <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.9} />
                </PageTitlebarButton>
                <PageTitlebarButton
                  disabled={!canGoForward}
                  label={t('forward')}
                  title={canGoForward ? t('forward') : t('noNextPage')}
                  onClick={() => router.history.forward()}
                >
                  <ChevronRight aria-hidden="true" size={18} strokeWidth={1.9} />
                </PageTitlebarButton>
              </motion.div>
            </ButtonGroup>
          )
        : null}
      {page?.leading
        ? (
            <motion.div
              {...stylex.props(appTitlebarStyles.leadingSlot)}
              animate={{ left: leadingOffset }}
              data-window-no-drag=""
              initial={false}
              transition={shouldReduceMotion ? { duration: 0 } : navigationSpring}
            >
              {page.leading}
            </motion.div>
          )
        : null}
      {page?.titleVisibility !== 'hidden'
        ? (
            <div
              {...stylex.props(
                appTitlebarStyles.titleSlot,
                page?.titleVisibility === 'wide' && appTitlebarStyles.titleSlotWide,
              )}
            >
              {page?.title
                ? page.onRenameTitle
                  ? (
                      <EditableTitle.Root
                        key={page.title}
                        value={page.title}
                        validate={value => value.length === 0 ? t('noteTitleCannotBeEmpty') : null}
                        getSubmitError={() => t('couldNotRename')}
                        onSubmit={page.onRenameTitle}
                      >
                        <EditableTitle.Trigger
                          aria-label={t('renameNoteFor', { title: page.title })}
                          data-window-no-drag=""
                          title={t('renameNote')}
                        >
                          <EditableTitle.Text>{page.title}</EditableTitle.Text>
                          <EditableTitle.Icon asChild>
                            <Pencil aria-hidden="true" strokeWidth={1.8} />
                          </EditableTitle.Icon>
                        </EditableTitle.Trigger>
                        <EditableTitle.Input aria-label={t('noteTitle')} data-window-no-drag="" title={t('renameNote')} />
                        <EditableTitle.Error />
                      </EditableTitle.Root>
                    )
                  : (
                      <div {...stylex.props(appTitlebarStyles.staticTitle)}>
                        <span {...stylex.props(appTitlebarStyles.titleText)} data-window-title-text="">{page.title}</span>
                      </div>
                    )
                : null}
            </div>
          )
        : null}
      {page?.trailing
        ? (
            <ButtonGroup
              data-window-no-drag=""
              data-titlebar-appearance={page.trailingAppearance ?? 'group'}
              variant="glass"
              xstyle={[
                appTitlebarStyles.navigationGroup,
                appTitlebarStyles.trailingGroup,
                page.trailingAppearance === 'plain' && appTitlebarStyles.trailingGroupPlain,
                page.sidebarAction !== undefined && appTitlebarStyles.trailingGroupWithSidebarAction,
              ]}
            >
              {page.trailing}
            </ButtonGroup>
          )
        : null}
      {page?.sidebarAction
        ? (
            <ButtonGroup
              data-window-no-drag=""
              variant="glass"
              xstyle={[appTitlebarStyles.navigationGroup, appTitlebarStyles.sidebarActionGroup]}
            >
              {page.sidebarAction}
            </ButtonGroup>
          )
        : null}
    </header>
  )
}
