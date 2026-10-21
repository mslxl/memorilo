import type { WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setTitlebarAppearance, showApplicationMenu } from './window-chrome-service'

const electron = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  getApplicationMenu: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  Menu: { getApplicationMenu: electron.getApplicationMenu },
}))
vi.mock('./main-window-chrome', () => ({ mainWindowTitlebarHeight: 40, usesCustomWindowChrome: () => true }))

const sender = { getZoomFactor: () => 1.25 } as WebContents

describe('custom title bar native boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the existing submenu and releases its owning-window listener on dismissal', async () => {
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
    })
    let dismiss: (() => void) | undefined
    const submenu = {
      closePopup: vi.fn(),
      popup: vi.fn((options: { callback: () => void }) => { dismiss = options.callback }),
    }
    electron.fromWebContents.mockReturnValue(window)
    const getMenuItemById = vi.fn(() => ({ submenu }))
    electron.getApplicationMenu.mockReturnValue({ getMenuItemById })

    const result = Effect.runPromise(showApplicationMenu(sender, { anchor: { x: 130, y: 38 }, menu: 'edit' }))
    await vi.waitFor(() => expect(submenu.popup).toHaveBeenCalled())
    expect(getMenuItemById).toHaveBeenCalledWith('edit')
    expect(submenu.popup).toHaveBeenCalledWith(expect.objectContaining({ window, x: 163, y: 48 }))
    expect(window.listenerCount('closed')).toBe(1)
    dismiss?.()
    await expect(result).resolves.toBeNull()
    expect(window.listenerCount('closed')).toBe(0)
    expect(submenu.closePopup).toHaveBeenCalledWith(window)
  })

  it('finishes an open request when its owning window closes', async () => {
    let destroyed = false
    const window = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed })
    const submenu = { closePopup: vi.fn(), popup: vi.fn() }
    electron.fromWebContents.mockReturnValue(window)
    electron.getApplicationMenu.mockReturnValue({ getMenuItemById: () => ({ submenu }) })
    const result = Effect.runPromise(showApplicationMenu(sender, { anchor: { x: 0, y: 40 }, menu: 'file' }))
    await vi.waitFor(() => expect(submenu.popup).toHaveBeenCalled())
    destroyed = true
    window.emit('closed')
    await expect(result).resolves.toBeNull()
    expect(window.listenerCount('closed')).toBe(0)
    expect(submenu.closePopup).not.toHaveBeenCalled()
  })

  it('rejects a sender without a live owning window', async () => {
    electron.fromWebContents.mockReturnValue(null)
    await expect(Effect.runPromise(setTitlebarAppearance(sender, {
      backgroundColor: '#fafaf9',
      symbolColor: '#25262a',
    }))).rejects.toMatchObject({ _tag: 'WindowChromeError', code: 'AppearanceFailed' })
  })
})
