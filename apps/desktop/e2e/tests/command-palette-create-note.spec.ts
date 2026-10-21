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

test('creates a Note with an initial editable Outline Block from an unmatched search', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-command-palette-create-'))
  try {
    const electronApplication = await electron.launch({
      args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MEMORILO_DATABASE_PATH: ':memory:',
        MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
        MEMORILO_E2E_HIDE_WINDOW: process.env.MEMORILO_E2E_HIDE_WINDOW ?? '1',
      },
      executablePath: electronExecutablePath,
    })
    try {
      const window = await electronApplication.firstWindow()
      const title = 'Distributed garden planning 5e812c'

      await window.locator('a[href*="/journals"]').waitFor()
      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
      const createResult = window.locator('[role=listbox] [role=option][id$=\"-create-note\"]')
      await expect(createResult).toHaveCount(1)
      await createResult.click()

      await expect(window.locator('[data-note-action="rename-current"]')).toBeVisible()
      await expect.poll(() => window.evaluate(() => globalThis.location.hash)).toMatch(/^#\/note\/[^/]+\/[^/?]+$/)
      const editor = window.locator('[data-editor-content]')
      await expect(editor.locator('[data-block-id]').first()).toBeVisible()
    }
    finally {
      await electronApplication.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
