import { Buffer } from 'node:buffer'
import { copyFile, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { startRendererDevServer } from './i18n-e2e-helpers'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = join(repositoryRoot, 'apps/desktop')
const executablePath: unknown = createRequire(join(desktopDirectory, 'package.json'))('electron')
if (typeof executablePath !== 'string')
  throw new TypeError('Desktop Electron executable is unavailable')

let renderer: Awaited<ReturnType<typeof startRendererDevServer>>
test.beforeAll(async () => {
  renderer = await startRendererDevServer()
})
test.afterAll(() => {
  renderer?.child.kill()
})

for (const redrawTitlebar of [true, false]) {
  test(`reader controls remain visible and clickable with redrawn title bar ${redrawTitlebar}`, async ({ playwright }, testInfo) => {
    test.setTimeout(90_000)
    const temporaryRoot = resolve(tmpdir())
    const directory = await mkdtemp(join(temporaryRoot, 'memorilo-reader-toolbar-'))
    if (dirname(directory) !== temporaryRoot || !directory.split(/[\\/]/).at(-1)?.startsWith('memorilo-reader-toolbar-'))
      throw new Error('Temporary reader test path escaped its expected directory')
    const isolatedDesktop = join(directory, 'apps/desktop')
    try {
      // Development persistence is relative to the app build, not userData.
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
          ELECTRON_RENDERER_URL: renderer.url,
          MEMORILO_DATABASE_PATH: ':memory:',
          MEMORILO_E2E_HIDE_WINDOW: '1',
          MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
          MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
        },
        executablePath,
      })
      let application = await launch()
      try {
        let page = await application.firstWindow()
        await expect(page).toHaveTitle(/Memorilo$/)
        await page.evaluate(async (redrawTitlebar) => {
          for (const [path, value] of [['language', 'en'], ['redrawTitlebar', redrawTitlebar]]) {
            const response = await fetch('memorilo://api/configuration/value', {
              body: JSON.stringify({ path, value }),
              headers: { 'content-type': 'application/json' },
              method: 'PATCH',
            })
            if (!response.ok)
              throw new Error(`Test configuration update failed: ${response.status}`)
          }
        }, redrawTitlebar)
        if (!redrawTitlebar) {
          await application.close()
          application = await launch()
          page = await application.firstWindow()
          await expect(page).toHaveTitle(/Memorilo$/)
        }
        await page.evaluate(() => {
          location.hash = '/reader'
        })
        await page.getByLabel('Open PDF or EPUB, TXT, CBZ, or CBR').setInputFiles({
          buffer: Buffer.from('Chapter 1\n\nReader toolbar layout fixture.\n'.repeat(50)),
          mimeType: 'text/plain',
          name: 'toolbar-layout.txt',
        })
        const toolbar = page.locator('header').filter({ has: page.locator('h2', { hasText: 'toolbar-layout.txt' }) })
        const title = toolbar.locator('h2')
        await expect(toolbar).toHaveCount(1)
        await expect(toolbar.getByRole('button', { name: 'Increase text size' })).toBeEnabled()
        const caption = page.locator('[data-window-titlebar]')
        const customChrome = redrawTitlebar && (process.platform === 'win32' || process.platform === 'linux')
        await expect(caption).toHaveCount(customChrome ? 1 : 0)
        const captionBounds = customChrome ? await caption.boundingBox() : null
        const minimumTop = captionBounds ? captionBounds.y + captionBounds.height + 10 : 10
        await expect(toolbar).toHaveCSS('position', 'fixed')
        for (const width of [1200, 800]) {
          await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setSize(width, 800), width)
          for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all())
            await dismiss.click()
          await expect(page.locator('.Toastify__toast')).toHaveCount(0)
          for (const control of [title, ...await toolbar.locator('button').all()]) {
            const bounds = await control.boundingBox()
            expect(bounds).not.toBeNull()
            expect(bounds!.y).toBeGreaterThanOrEqual(minimumTop)
          }
          for (const button of await toolbar.locator('button').all()) {
            if (await button.isDisabled())
              continue
            const hitTest = await button.evaluate((element) => {
              const rect = element.getBoundingClientRect()
              const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
              return { control: element.getAttribute('aria-label'), rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 200), reachable: hit !== null && element.contains(hit) }
            })
            expect(hitTest.reachable, JSON.stringify(hitTest)).toBe(true)
          }
          await toolbar.getByRole('button', { name: 'Show table of contents' }).click()
          await expect(toolbar.getByRole('button', { name: 'Hide table of contents' })).toBeVisible()
          await toolbar.getByRole('button', { name: 'Hide table of contents' }).click()
          await expect(toolbar.getByRole('button', { name: 'Show table of contents' })).toBeVisible()
        }
        const screenshot = await application.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window)
            throw new Error('Main window is unavailable')
          return (await window.webContents.capturePage(undefined, { stayAwake: true, stayHidden: true })).toPNG().toString('base64')
        })
        await writeFile(testInfo.outputPath('reader-toolbar.png'), Buffer.from(screenshot, 'base64'))
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
}
