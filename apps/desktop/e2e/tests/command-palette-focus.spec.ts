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

test('focuses the selected Topic Block after opening it from search', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-command-palette-focus-'))
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
      const editor = window.locator('[data-editor-content]')
      const noteTitle = 'Command palette focus test'
      const originText = 'Command palette focus origin'
      const targetText = 'Command palette focus target 7f3c91'

      await window.locator('a[href*="/journals"]').waitFor()
      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill(noteTitle)
      await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
      await editor.waitFor()
      await editor.locator('[data-block-id]').first().click()
      await window.keyboard.press('End')
      await window.keyboard.press('Enter')
      await window.keyboard.type(originText)
      await window.keyboard.press('Enter')
      await window.keyboard.type(targetText)
      await window.getByText(originText, { exact: true }).click()

      await window.waitForTimeout(600)
      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill(targetText)
      const targetResult = window.getByRole('option').filter({ hasText: targetText })
      await expect(targetResult).toHaveCount(1)
      await targetResult.click()
      await expect.poll(() => window.evaluate(() => globalThis.location.hash)).toMatch(/^#\/note\/[^/]+\/[^/?]+\?focus=[^&]+$/)

      const targetBlock = window.locator('[data-block-id]').filter({ hasText: targetText })
      await expect(targetBlock).toHaveCount(1)
      await expect.poll(async () => targetBlock.evaluate((block) => {
        const selection = document.getSelection()
        return {
          activeEditor: document.activeElement?.matches('[data-editor-content].ProseMirror') === true,
          anchorInsideTarget: selection?.anchorNode ? block.contains(selection.anchorNode) : false,
          focusInsideTarget: selection?.focusNode ? block.contains(selection.focusNode) : false,
        }
      })).toEqual({
        activeEditor: true,
        anchorInsideTarget: true,
        focusInsideTarget: true,
      })
    }
    finally {
      await electronApplication.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
