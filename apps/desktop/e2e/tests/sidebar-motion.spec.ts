import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

test('collapses the sidebar through the real Electron shell', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-sidebar-motion-'))
  try {
    const electronApplication = await electron.launch({
      args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MEMORILO_DATABASE_PATH: ':memory:',
        MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
        MEMORILO_E2E_HIDE_WINDOW: '1',
        MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
      },
      executablePath: electronExecutablePath,
    })
    try {
      const window = await electronApplication.firstWindow()
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      await window.locator('button[data-sidebar-toggle]').waitFor()
      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill('Sidebar motion Note')
      await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
      await window.locator('main > section[aria-label]').waitFor()

      const start = await window.evaluate(() => {
        const button = document.querySelector('button[data-sidebar-toggle]')
        const editor = document.querySelector('main > section[aria-label]')
        if (!(button instanceof HTMLButtonElement))
          throw new TypeError('Hide Sidebar button is unavailable')
        if (!(editor instanceof HTMLElement))
          throw new TypeError('Editor region is unavailable')

        button.click()
        return editor.getBoundingClientRect().left
      })

      const editor = window.locator('main > section[aria-label]')
      await expect(window.locator('aside[data-ui=sidebar]')).toHaveCount(0)

      const end = await editor.evaluate(element => element.getBoundingClientRect().left)

      expect(end).toBeLessThan(start - 200)
    }
    finally {
      await electronApplication.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
