import type { DesktopTitlebarAppearance, ShowDesktopApplicationMenuInput } from '@memorilo/desktop-api'
import type { BrowserWindow, WebContents } from 'electron'
import process from 'node:process'
import { Data, Effect } from 'effect'
import { BrowserWindow as ElectronWindow, Menu } from 'electron'
import { mainWindowTitlebarHeight, usesCustomWindowChrome } from './main-window-chrome'

// eslint-disable-next-line unicorn/throw-new-error
export class WindowChromeError extends Data.TaggedError('WindowChromeError')<{
  cause: unknown
  code: 'MenuUnavailable' | 'MenuFailed' | 'AppearanceFailed'
}> {}

function owningWindow(sender: WebContents): BrowserWindow {
  const window = ElectronWindow.fromWebContents(sender)
  if (!usesCustomWindowChrome(process.platform) || !window || window.isDestroyed())
    throw new Error('Custom title bar is unavailable for this window')
  return window
}

export function showApplicationMenu(sender: WebContents, input: ShowDesktopApplicationMenuInput) {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const window = owningWindow(sender)
        const menu = Menu.getApplicationMenu()?.getMenuItemById(input.menu)?.submenu
        if (!menu)
          throw new Error(`Application menu ${input.menu} is unavailable`)
        return { menu, window }
      },
      catch: cause => new WindowChromeError({ cause, code: 'MenuUnavailable' }),
    }),
    ({ menu, window }) => Effect.callback<null, WindowChromeError>((resume) => {
      const complete = () => {
        window.removeListener('closed', complete)
        resume(Effect.succeed(null))
      }
      window.once('closed', complete)
      try {
        // Electron positions native menus in DIP; renderer anchors are CSS
        // pixels and must follow the owning webContents' page zoom.
        const zoom = sender.getZoomFactor()
        menu.popup({ callback: complete, window, x: Math.round(input.anchor.x * zoom), y: Math.round(input.anchor.y * zoom) })
      }
      catch (cause) {
        window.removeListener('closed', complete)
        resume(Effect.fail(new WindowChromeError({ cause, code: 'MenuFailed' })))
      }
      return Effect.sync(() => {
        window.removeListener('closed', complete)
      })
    }),
    ({ menu, window }) => Effect.sync(() => {
      if (!window.isDestroyed())
        menu.closePopup(window)
    }),
  )
}

export function setTitlebarAppearance(sender: WebContents, input: DesktopTitlebarAppearance) {
  return Effect.try({
    try: () => {
      owningWindow(sender).setTitleBarOverlay({
        color: input.backgroundColor,
        height: Math.round(mainWindowTitlebarHeight * sender.getZoomFactor()),
        symbolColor: input.symbolColor,
      })
      return null
    },
    catch: cause => new WindowChromeError({ cause, code: 'AppearanceFailed' }),
  })
}
