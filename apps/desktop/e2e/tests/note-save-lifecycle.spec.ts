import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

async function createEditedNote(window: Page, title: string, text: string): Promise<void> {
  await window.locator('a[href*="/journals"]').waitFor()
  await window.keyboard.press('Meta+P')
  await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
  const editor = window.locator('[data-editor-content]')
  const initialBlock = editor.locator('[data-block-id]').first()
  await expect(initialBlock).toBeVisible()
  await initialBlock.click()
  await window.keyboard.press('Meta+A')
  await window.keyboard.insertText(text.trim())
  await expect(editor).toContainText(text.trim())
}

async function assertPersisted(environment: Awaited<ReturnType<typeof createPagesTestEnvironment>>, title: string, text: string): Promise<void> {
  const relaunched = await launchPagesTestApplication(environment)
  try {
    const window = await relaunched.firstWindow()
    const recentNote = window.locator('button[data-note-action="open"]').filter({ hasText: title })
    await expect(recentNote).toBeVisible()
    await recentNote.click()
    const editor = window.locator('[data-editor-content]')
    await expect(editor.locator('[data-block-id]').first()).toContainText(text)
  }
  finally {
    await relaunched.close()
  }
}

test('persists an edit made immediately before the native window closes', async () => {
  const environment = await createPagesTestEnvironment('memorilo-window-close-save-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    const window = await application.firstWindow()
    await createEditedNote(window, 'Window close persistence', ' saved-before-close')
    const closed = window.waitForEvent('close')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await closed
    await application.close()

    await assertPersisted(environment, 'Window close persistence', 'saved-before-close')
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})

test('persists an edit across route navigation before the debounce expires', async () => {
  const environment = await createPagesTestEnvironment('memorilo-route-save-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    const window = await application.firstWindow()
    await createEditedNote(window, 'Route persistence', 'saved-before-navigation')
    await window.locator('a[href*="/pages"]').click()
    await expect(window.locator('main[data-page=pages]')).toBeVisible()
    await new Promise(resolve => setTimeout(resolve, 300))
    await application.close()

    await assertPersisted(environment, 'Route persistence', 'saved-before-navigation')
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})

test('persists an edit made immediately before application quit', async () => {
  const environment = await createPagesTestEnvironment('memorilo-quit-save-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    const window = await application.firstWindow()
    await window.locator('a[href*="/journals"]').waitFor()
    const title = 'Application quit persistence'
    await window.keyboard.press('Meta+P')
    await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
    await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
    const heading = window.locator('[data-editor-content]').locator('[data-block-id]').first()
    await expect(heading).toBeVisible()
    const editor = window.locator('[data-editor-content]')
    await heading.click()
    await window.keyboard.press('Meta+A')
    await window.keyboard.insertText('saved-before-quit')
    await expect(editor).toContainText('saved-before-quit')

    await application.evaluate(({ app }) => app.quit())
    const applicationProcess = application.process()
    await new Promise<void>((resolve) => {
      if (applicationProcess.exitCode !== null)
        resolve()
      else
        applicationProcess.once('exit', () => resolve())
    })

    await assertPersisted(environment, 'Application quit persistence', 'saved-before-quit')
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})
