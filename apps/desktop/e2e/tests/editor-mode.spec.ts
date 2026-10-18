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

test('switches a non-empty Topic between Document and Outline without losing editor focus', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-editor-mode-'))
  try {
    const electronApplication = await electron.launch({
      args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MEMORILO_DATABASE_PATH: ':memory:',
        MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      },
      executablePath: electronExecutablePath,
    })
    try {
      const window = await electronApplication.firstWindow()
      const title = 'Dynamic editor mode 7e21c4'

      await window.locator('a[href*="/journals"]').waitFor()
      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
      await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

      const editor = window.locator('[data-editor-content]')
      const heading = editor.locator('[data-block-id]').first()
      const editorShell = window.locator('[data-editor-mode]')
      await expect(editorShell).toHaveAttribute('data-editor-mode', 'document')

      await window.locator('[data-editor-mode-picker] button[data-editor-mode="document"]').click()
      await expect(window.locator('[data-editor-mode-picker]')).toHaveCount(0)
      await heading.click()
      await window.keyboard.type(title)
      await window.keyboard.press('End')
      const readSelection = () => heading.evaluate((element) => {
        const selection = document.getSelection()
        if (!selection?.anchorNode || !selection.focusNode)
          throw new Error('Editor heading has no active DOM selection')
        return {
          activeEditor: document.activeElement?.matches('[data-editor-content]') === true,
          anchorInHeading: element.contains(selection.anchorNode),
          anchorOffset: selection.anchorOffset,
          collapsed: selection.isCollapsed,
          focusInHeading: element.contains(selection.focusNode),
          focusOffset: selection.focusOffset,
        }
      })
      const selectionBeforeSwitch = await readSelection()
      expect(selectionBeforeSwitch).toEqual({
        activeEditor: true,
        anchorInHeading: true,
        anchorOffset: title.length,
        collapsed: true,
        focusInHeading: true,
        focusOffset: title.length,
      })

      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill('editor-mode-outline')
      await window.locator('[role=listbox] [role=option][id$="-editor-mode-outline"]').click()

      await expect(editorShell).toHaveAttribute('data-editor-mode', 'outline')
      await expect(editor.locator('[data-block-id]').first()).toBeVisible()
      await expect.poll(readSelection).toEqual(selectionBeforeSwitch)

      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill('editor-mode-document')
      await window.locator('[role=listbox] [role=option][id$="-editor-mode-document"]').click()
      await expect(editorShell).toHaveAttribute('data-editor-mode', 'document')
      await expect(editor.locator('[data-block-id]').first()).toBeVisible()
      await expect.poll(readSelection).toEqual(selectionBeforeSwitch)
    }
    finally {
      await electronApplication.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
