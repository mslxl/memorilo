import type { CSSProperties, ReactNode } from 'react'
import type { PaletteCommand } from '../../shared/command-palette'
import type { PageTitlebarOptions } from '../../shared/page-titlebar'
import * as stylex from '@stylexjs/stylex'
import { Match } from 'effect'
import { useCallback, useEffect, useState } from 'react'

import { CommandPaletteCommandsContext } from '../../shared/command-palette'
import { useDesktopConfiguration } from '../../shared/configuration'
import { matchesKeyboardShortcut } from '../../shared/keyboard-shortcut'
import { PageTitlebarContext } from '../../shared/page-titlebar'
import { getPlatform } from '../../shared/platform'
import { CommandPalette } from '../command-palette/command-palette'
import { router } from '../router'
import { appShellStyles } from './app-shell.stylex'
import { AppTitlebar } from './app-titlebar'
import { AppToastContainer } from './app-toast'
import { TodoCalendarBootstrap } from './todo-calendar-bootstrap'
import { hasCustomWindowTitlebar } from './window-chrome'
import { WindowTitlebar } from './window-titlebar'
import { WorkspaceSidebar } from './workspace-sidebar'

export function AppShell({ children }: { children: ReactNode }) {
  const [pageTitlebar, setPageTitlebar] = useState<PageTitlebarOptions | null>(null)
  const [pageCommands, setPageCommands] = useState<readonly PaletteCommand[]>([])
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const configuration = useDesktopConfiguration()
  const toggleSidebar = useCallback(() => setSidebarVisible(visible => !visible), [])
  useEffect(() => {
    const isFormControlTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement))
        return false
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isFormControlTarget(event.target))
        return
      if (matchesKeyboardShortcut(event, configuration.shortcuts.back)) {
        event.preventDefault()
        router.history.back()
      }
      else if (matchesKeyboardShortcut(event, configuration.shortcuts.forward)) {
        event.preventDefault()
        router.history.forward()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [configuration.shortcuts.back, configuration.shortcuts.forward])
  const compactCanvasTitlebar = pageTitlebar?.titleVisibility === 'hidden'
  const readerLeadingOffset = Match.value({
    compactCanvasTitlebar,
    platform: getPlatform(),
    sidebarVisible,
  }).pipe(
    Match.when(({ sidebarVisible }) => sidebarVisible, () => 270),
    Match.when(({ compactCanvasTitlebar }) => compactCanvasTitlebar, () => 55),
    Match.when(({ platform }) => platform === 'macos', () => 120),
    Match.orElse(() => 55),
  )
  const shellStyle = {
    '--reader-leading-offset': `${readerLeadingOffset}px`,
    // Fixed reader controls use viewport coordinates, outside workspace flow.
    '--window-titlebar-height': hasCustomWindowTitlebar() ? '40px' : '0px',
  } as CSSProperties
  const shellProps = stylex.props(appShellStyles.shell)

  return (
    <PageTitlebarContext value={setPageTitlebar}>
      <CommandPaletteCommandsContext value={setPageCommands}>
        <div
          {...shellProps}
          className={shellProps.className}
          style={shellStyle}
        >
          <WindowTitlebar />
          <div {...stylex.props(appShellStyles.workspace)}>
            <AppTitlebar page={pageTitlebar} sidebarVisible={sidebarVisible} />
            <div {...stylex.props(appShellStyles.body)}>
              <WorkspaceSidebar
                compactCollapsed={compactCanvasTitlebar}
                visible={sidebarVisible}
                onToggle={toggleSidebar}
              />
              <div {...stylex.props(appShellStyles.routeViewport)}>{children}</div>
            </div>
          </div>
          <CommandPalette
            contextualCommands={pageCommands}
            sidebarVisible={sidebarVisible}
            onToggleSidebar={toggleSidebar}
          />
          <TodoCalendarBootstrap />
          <AppToastContainer />
        </div>
      </CommandPaletteCommandsContext>
    </PageTitlebarContext>
  )
}
