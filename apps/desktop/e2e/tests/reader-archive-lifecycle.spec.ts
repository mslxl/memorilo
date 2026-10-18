import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

import { lifecycleCbz, lifecycleEpub } from './reader-archive-fixtures'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule
test('releases and reopens EPUB and CBZ reader sessions', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-reader-archives-'))
  const electronApplication = await electron.launch({
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MEMORILO_DATABASE_PATH: ':memory:',
      MEMORILO_E2E_HIDE_WINDOW: '1',
      MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
    },
    executablePath: electronExecutablePath,
  })

  try {
    const window = await electronApplication.firstWindow()
    await window.setViewportSize({ height: 900, width: 1440 })

    const openReaderRoute = async () => {
      await window.evaluate(() => {
        location.hash = '/reader'
      })
      await expect(window.locator('[data-reader-file-input]')).toBeVisible()
    }
    const leaveReaderRoute = async () => {
      await window.evaluate(() => {
        location.hash = '/shelf'
      })
      await expect(window.locator('[data-reader-file-input]')).toHaveCount(0)
    }
    const expectEpub = async () => {
      await window.locator('[data-reader-file-input]').setInputFiles({
        buffer: lifecycleEpub(),
        mimeType: 'application/epub+zip',
        name: 'lifecycle.epub',
      })
      const frame = window.locator('main iframe[aria-label="Lifecycle EPUB"]')
      await expect(frame).toBeVisible()
      await expect(frame).toHaveCount(1)
      await expect(frame.contentFrame().getByText('EPUB lifecycle fixture')).toBeVisible()
    }
    const expectCbz = async () => {
      await window.locator('[data-reader-file-input]').setInputFiles({
        buffer: lifecycleCbz(),
        mimeType: 'application/vnd.comicbook+zip',
        name: 'lifecycle.cbz',
      })
      const image = window.locator('main img')
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate(element => ({
        complete: (element as HTMLImageElement).complete,
        height: (element as HTMLImageElement).naturalHeight,
        width: (element as HTMLImageElement).naturalWidth,
      }))).toEqual({ complete: true, height: 1, width: 1 })
    }

    await openReaderRoute()
    await expectEpub()
    await leaveReaderRoute()
    await openReaderRoute()
    await expectEpub()
    await leaveReaderRoute()

    await openReaderRoute()
    await expectCbz()
    await leaveReaderRoute()
    await openReaderRoute()
    await expectCbz()
  }
  finally {
    await electronApplication.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
