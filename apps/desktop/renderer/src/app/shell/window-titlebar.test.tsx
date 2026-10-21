import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n, setI18nLanguage } from '../../i18n'
import { WindowTitlebar } from './window-titlebar'

const boundary = vi.hoisted(() => ({ icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', openMenu: vi.fn(), platform: 'windows' }))
vi.mock('../../shared/platform', () => ({ getPlatform: () => boundary.platform }))
vi.mock('./window-titlebar-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('./window-titlebar-service')>()
  return { ...original, loadWindowApplicationIcon: () => Effect.succeed(boundary.icon), openWindowTitlebarMenu: boundary.openMenu }
})

describe('window title bar', () => {
  beforeEach(() => {
    boundary.platform = 'windows'
    boundary.openMenu.mockReset().mockImplementation(() => Effect.succeed(null))
  })

  it.each(['windows', 'linux'])('places four accessible menus beside the app name on %s', (platform) => {
    boundary.platform = platform
    const rendered = render(<WindowTitlebar />)
    const menus = rendered.getByRole('menubar', { name: 'Application menu' })
    expect(menus.querySelectorAll('[role="menuitem"]')).toHaveLength(4)
    expect(rendered.getByText('Memorilo')).toBeInTheDocument()
    expect(menus).toHaveAttribute('data-window-no-drag')
  })

  it.each(['macos', 'other'])('leaves native chrome alone on %s', (platform) => {
    boundary.platform = platform
    const rendered = render(<WindowTitlebar />)
    expect(rendered.container).toBeEmptyDOMElement()
  })

  it('does not render a second title bar over an existing native frame', () => {
    Object.defineProperty(window, 'desktop', { configurable: true, value: { customTitlebarEnabled: false } })
    try {
      const rendered = render(<WindowTitlebar />)
      expect(rendered.container).toBeEmptyDOMElement()
    }
    finally {
      Reflect.deleteProperty(window, 'desktop')
    }
  })

  it('supports F10, arrow navigation and opening a native menu with the keyboard', async () => {
    const rendered = render(<WindowTitlebar />)
    fireEvent.keyDown(window, { key: 'F10' })
    const file = rendered.getByRole('menuitem', { name: 'File' })
    const edit = rendered.getByRole('menuitem', { name: 'Edit' })
    expect(file).toHaveFocus()
    fireEvent.keyDown(file, { key: 'ArrowRight' })
    expect(edit).toHaveFocus()
    expect(file).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(edit, { key: 'ArrowDown' })
    await waitFor(() => expect(boundary.openMenu).toHaveBeenCalledWith(expect.objectContaining({ menu: 'edit' })))
    await waitFor(() => expect(edit).toHaveAttribute('aria-expanded', 'false'))
  })

  it('keeps the editor selection focused when a menu is pressed with the mouse', async () => {
    const rendered = render(
      <>
        <input aria-label="Editor" />
        <WindowTitlebar />
      </>,
    )
    const editor = rendered.getByRole('textbox', { name: 'Editor' })
    act(() => editor.focus())
    const menu = rendered.getByRole('menuitem', { name: 'Edit' })
    expect(fireEvent.mouseDown(menu)).toBe(false)
    expect(editor).toHaveFocus()
    fireEvent.click(menu)
    await waitFor(() => expect(menu).toHaveAttribute('aria-expanded', 'false'))
  })

  it('translates menus while preserving the application name and original icon', async () => {
    const rendered = render(<WindowTitlebar />)
    await act(async () => {
      setI18nLanguage('zh')
      await vi.waitFor(() => expect(i18n.language).toBe('zh'))
    })
    expect(rendered.getByRole('menubar', { name: '应用菜单' })).toBeInTheDocument()
    expect(rendered.getByRole('menuitem', { name: '文件' })).toBeInTheDocument()
    expect(rendered.getByRole('menuitem', { name: '窗口' })).toBeInTheDocument()
    expect(rendered.getByText('Memorilo')).toBeInTheDocument()
    expect(rendered.container.querySelector('[data-window-app-icon] img')).toHaveAttribute('src', boundary.icon)
  })
})
