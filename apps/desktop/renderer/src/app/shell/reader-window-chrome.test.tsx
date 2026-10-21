import { desktopConfigurationDefinition } from '@memorilo/desktop-config'
import { WindowReader } from '@memorilo/editor/reader'
import { act, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { i18n, setI18nLanguage } from '../../i18n'
import { DesktopConfigurationContext } from '../../shared/configuration'
import { AppShell } from './app-shell'

const boundary = vi.hoisted(() => ({ platform: 'windows' }))
vi.mock('../../shared/platform', () => ({ getPlatform: () => boundary.platform }))
vi.mock('../router', () => ({ router: { history: { back: vi.fn(), forward: vi.fn() } } }))
vi.mock('../command-palette/command-palette', () => ({ CommandPalette: () => null }))
vi.mock('./app-titlebar', () => ({ AppTitlebar: () => null }))
vi.mock('./app-toast', () => ({ AppToastContainer: () => null }))
vi.mock('./todo-calendar-bootstrap', () => ({ TodoCalendarBootstrap: () => null }))
vi.mock('./workspace-sidebar', () => ({ WorkspaceSidebar: () => <aside style={{ width: 248 }} /> }))
vi.mock('./window-titlebar-service', async importOriginal => ({
  ...await importOriginal<typeof import('./window-titlebar-service')>(),
  loadWindowApplicationIcon: () => Effect.succeed(null),
  openWindowTitlebarMenu: () => Effect.succeed(null),
  updateWindowTitlebarAppearance: () => Effect.succeed(null),
}))

describe('reader window chrome layout', () => {
  it.each([
    ['windows', true, 50],
    ['linux', true, 50],
    ['windows', false, 10],
    ['linux', false, 10],
    ['macos', true, 10],
  ] as const)('positions reader controls below the %s frame (custom: %s)', async (platform, customTitlebarEnabled, expectedTop) => {
    boundary.platform = platform
    Object.defineProperty(window, 'desktop', { configurable: true, value: { customTitlebarEnabled, platform } })
    try {
      await page.viewport(1200, 800)
      await act(async () => {
        setI18nLanguage('en')
        await vi.waitFor(() => expect(i18n.language).toBe('en'))
      })
      const configuration = {
        ...desktopConfigurationDefinition.defaults,
        // A pending preference must not reposition controls before a restart.
        redrawTitlebar: !customTitlebarEnabled,
      }
      const rendered = render(
        <div style={{ height: 500, width: 1100 }}>
          <DesktopConfigurationContext value={configuration}>
            <AppShell>
              <WindowReader
                annotationEditingEnabled={false}
                sidebarActions={<button aria-label="Inspector" style={{ height: 32, width: 32 }} type="button">I</button>}
                source={{ data: new TextEncoder().encode('Reader layout fixture.'), name: 'layout.txt' }}
                title="Reader layout fixture"
              />
            </AppShell>
          </DesktopConfigurationContext>
        </div>,
      )
      await waitFor(() => expect(rendered.getByRole('button', { name: 'Increase text size' })).toBeEnabled())
      const title = rendered.getByRole('heading', { name: 'Reader layout fixture' })
      const toolbar = title.closest('header')!
      expect(toolbar.getBoundingClientRect().top).toBe(expectedTop)
      const inspector = rendered.getByRole('button', { name: 'Inspector' })
      expect(inspector.parentElement!.getBoundingClientRect().top).toBe(expectedTop)
      const controls = [...toolbar.querySelectorAll('button'), inspector]
      for (const button of controls) {
        if (button instanceof HTMLButtonElement && button.disabled)
          continue
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        expect(hit !== null && button.contains(hit), JSON.stringify({ control: button.getAttribute('aria-label') ?? button.textContent, rect, hit: hit?.outerHTML.slice(0, 200) })).toBe(true)
      }
    }
    finally {
      Reflect.deleteProperty(window, 'desktop')
    }
  })
})
