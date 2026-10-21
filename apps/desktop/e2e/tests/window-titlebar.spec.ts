import { Buffer } from 'node:buffer'
import { copyFile, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = join(repositoryRoot, 'apps/desktop')
const desktopRequire = createRequire(join(desktopDirectory, 'package.json'))
const executablePath: unknown = desktopRequire('electron')
if (typeof executablePath !== 'string')
  throw new TypeError('Desktop Electron executable is unavailable')

test('integrates application menus into Windows/Linux chrome in the built desktop', async ({ playwright }, testInfo) => {
  test.skip(process.platform !== 'win32' && process.platform !== 'linux', 'Custom chrome is scoped to Windows and Linux')
  test.setTimeout(180_000)
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'memorilo-titlebar-'))
  if (dirname(directory) !== temporaryRoot || !directory.split(/[\\/]/).at(-1)?.startsWith('memorilo-titlebar-'))
    throw new Error('Temporary title bar test path escaped its expected directory')
  const isolatedDesktop = join(directory, 'apps/desktop')
  try {
    // Development persistence uses a path relative to the app build, so a
    // separate userData alone does not isolate the user's development database.
    await mkdir(isolatedDesktop, { recursive: true })
    await cp(join(desktopDirectory, 'out'), join(isolatedDesktop, 'out'), { recursive: true })
    await copyFile(join(desktopDirectory, 'package.json'), join(isolatedDesktop, 'package.json'))
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(join(desktopDirectory, 'node_modules'), join(isolatedDesktop, 'node_modules'), linkType)
    await mkdir(join(directory, '.cache'), { recursive: true })
    await symlink(join(repositoryRoot, '.cache/embedding-models'), join(directory, '.cache/embedding-models'), linkType)
    const launch = () => playwright._electron.launch({
      args: [`--user-data-dir=${join(directory, 'user-data')}`, isolatedDesktop],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MEMORILO_DATABASE_PATH: ':memory:',
        MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
        MEMORILO_E2E_HIDE_WINDOW: '1',
        MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
      },
      executablePath,
    })
    let application = await launch()
    try {
      const page = await application.firstWindow()
      await page.locator('[data-window-titlebar]').waitFor()
      await expect(page.locator('[data-application-menu]')).toHaveCount(4)
      const originalIcon = await application.evaluate(async ({ app }) => {
        const icon = await app.getFileIcon(process.execPath, { size: 'small' })
        return icon.toDataURL()
      })
      await expect(page.locator('[data-window-app-icon] img')).toHaveAttribute('src', originalIcon)
      await expect.poll(() => page.locator('[data-window-app-icon] img').evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true)
      const caption = await page.locator('[data-window-titlebar]').boundingBox()
      expect(caption?.y).toBe(0)
      expect(caption?.height).toBe(40)
      expect(await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window)
          throw new Error('Main window is unavailable')
        return { hidden: !window.isVisible(), menuVisible: window.isMenuBarVisible(), resizable: window.isResizable() }
      })).toEqual({ hidden: true, menuVisible: false, resizable: true })

      await page.keyboard.press('F10')
      await expect(page.locator('[data-application-menu="file"]')).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(page.locator('[data-application-menu="edit"]')).toBeFocused()

      await application.evaluate(({ BrowserWindow, Menu }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window)
          throw new Error('Main window is unavailable')
        const state = globalThis as typeof globalThis & { titlebarOpenedMenus?: string[] }
        state.titlebarOpenedMenus = []
        for (const id of ['file', 'edit', 'view', 'window']) {
          const menu = Menu.getApplicationMenu()?.getMenuItemById(id)?.submenu
          if (!menu)
            throw new Error(`Missing native submenu: ${id}`)
          menu.once('menu-will-show', () => {
            state.titlebarOpenedMenus?.push(id)
            setTimeout(() => menu.closePopup(window), 100)
          })
        }
      })
      for (const id of ['file', 'edit', 'view', 'window']) {
        await page.locator(`[data-application-menu="${id}"]`).click()
        await expect.poll(() => application.evaluate(() => (globalThis as typeof globalThis & { titlebarOpenedMenus?: string[] }).titlebarOpenedMenus)).toContain(id)
        await expect(page.locator(`[data-application-menu="${id}"]`)).toHaveAttribute('aria-expanded', 'false')
      }
      await expect(page.getByRole('alert')).toHaveCount(0)

      for (const language of ['en', 'zh-CN']) {
        await page.evaluate(async (value) => {
          const response = await fetch('memorilo://api/configuration/value', {
            body: JSON.stringify({ path: 'language', value }),
            headers: { 'content-type': 'application/json' },
            method: 'PATCH',
          })
          if (!response.ok)
            throw new Error(`Language update failed: ${response.status}`)
        }, language)
        await expect(page.locator('[data-application-menu="file"]')).toHaveText(language === 'en' ? 'File' : '文件')
        await expect(page.locator('[data-window-app-name]')).toHaveText('Memorilo')
        await expect(page.locator('[data-window-app-icon] img')).toHaveAttribute('src', originalIcon)
        await expect(page).toHaveTitle(/Memorilo$/)
      }

      const capture = async (name: string) => {
        const png = await application.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window)
            throw new Error('Main window is unavailable')
          const image = await window.webContents.capturePage(undefined, { stayAwake: true, stayHidden: true })
          return image.toPNG().toString('base64')
        })
        await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'))
      }
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur()
      })
      await page.mouse.move(600, 80)
      await capture('titlebar-1200.png')
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(720, 640))
      const layout = await page.locator('[data-window-titlebar]').evaluate((bar) => {
        const content = bar.firstElementChild?.getBoundingClientRect()
        const menus = bar.querySelector('[role="menubar"]')?.getBoundingClientRect()
        return { availableRight: content?.right ?? 0, menuRight: menus?.right ?? 0 }
      })
      expect(layout.menuRight).toBeLessThan(layout.availableRight)
      await capture('titlebar-720.png')
      await page.evaluate(async () => {
        const response = await fetch('memorilo://api/configuration/value', {
          body: JSON.stringify({ path: 'theme.appearance', value: 'dark' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        })
        if (!response.ok)
          throw new Error(`Theme update failed: ${response.status}`)
      })
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.uiThemeResolvedAppearance)).toBe('dark')
      await expect.poll(() => page.locator('[data-window-titlebar]').evaluate((bar) => {
        const menu = bar.querySelector('[role="menuitem"]')
        const mark = bar.querySelector('[data-window-app-icon]')
        return menu && mark ? getComputedStyle(menu).color === getComputedStyle(mark).color : false
      })).toBe(true)
      await capture('titlebar-dark.png')
      expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false)

      const openSettings = async () => {
        const opened = application.waitForEvent('window')
        await application.evaluate(({ Menu }) => {
          const settings = Menu.getApplicationMenu()?.getMenuItemById('settings')
          if (!settings)
            throw new Error('Settings menu is unavailable')
          settings.click()
        })
        const settings = await opened
        await settings.getByRole('switch', { name: '启用重绘标题栏' }).waitFor()
        return settings
      }
      const settings = await openSettings()
      const toggle = settings.getByRole('switch', { name: '启用重绘标题栏' })
      await expect(toggle).toBeChecked()
      await expect(settings.getByText('将应用菜单放在 Memorilo 名称旁边，关闭后使用系统标题栏。重启应用后生效。')).toBeVisible()
      const reducedMotionBounds = await settings.getByRole('switch', { name: '减少动态效果' }).boundingBox()
      const titlebarBounds = await toggle.boundingBox()
      expect(titlebarBounds?.y).toBeGreaterThan(reducedMotionBounds?.y ?? 0)
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      // A saved preference must not remove renderer chrome from a window
      // whose native frame is still the custom one.
      await expect(page.locator('[data-window-titlebar]')).toHaveCount(1)
      await application.close()

      application = await launch()
      const nativePage = await application.firstWindow()
      await expect(nativePage).toHaveTitle(/Memorilo$/)
      expect(await nativePage.evaluate(() => (window as unknown as { desktop: { customTitlebarEnabled: boolean } }).desktop.customTitlebarEnabled)).toBe(false)
      await expect(nativePage.locator('[data-window-titlebar]')).toHaveCount(0)
      expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMenuBarVisible())).toBe(true)
      const nativeSettings = await openSettings()
      const nativeToggle = nativeSettings.getByRole('switch', { name: '启用重绘标题栏' })
      await expect(nativeToggle).not.toBeChecked()
      await nativeToggle.click()
      await expect(nativeToggle).toBeChecked()
      await expect(nativePage.locator('[data-window-titlebar]')).toHaveCount(0)
      await application.close()

      application = await launch()
      const customPage = await application.firstWindow()
      await expect(customPage.locator('[data-window-titlebar]')).toHaveCount(1)
      expect(await customPage.evaluate(() => (window as unknown as { desktop: { customTitlebarEnabled: boolean } }).desktop.customTitlebarEnabled)).toBe(true)
      expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMenuBarVisible())).toBe(false)
      expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true)
    }
    finally {
      await application.close()
    }
  }
  finally {
    await rm(directory, { force: true, recursive: true })
  }
})
