import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

async function createNote(window: Page, title: string): Promise<void> {
  await window.getByRole('link', { name: 'Journals' }).waitFor()
  await window.keyboard.press('Meta+P')
  await window.getByRole('combobox', { name: 'Search commands and Notes' }).fill(title)
  await window.getByRole('option').filter({ hasText: `Create Note “${title}”` }).click()
  const section = window.locator(`section[aria-label="${title}"]`)
  await expect(section).toBeVisible()
  const editor = section.getByRole('textbox', { name: 'Editor content' })
  await expect(editor).toBeVisible()
  await expect(editor.locator('[data-block-id]')).toHaveCount(1)
}

async function placeCaretAtDocumentEnd(editor: Locator): Promise<void> {
  await editor.evaluate((element) => {
    const selection = globalThis.getSelection()
    if (!selection)
      throw new Error('Editor selection is unavailable')
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await editor.focus()
}

async function openSlashMenu(window: Page, editor: Locator): Promise<Locator> {
  await placeCaretAtDocumentEnd(editor)
  await window.keyboard.press('Enter')
  await window.keyboard.press('Enter')
  const selectionInCodeBlock = await editor.evaluate(() => {
    const anchor = globalThis.getSelection()?.anchorNode
    return anchor instanceof Element
      ? anchor.closest('pre[data-language]') !== null
      : anchor?.parentElement?.closest('pre[data-language]') !== null
  })
  if (selectionInCodeBlock)
    await window.keyboard.press('Enter')
  await window.keyboard.type('/')
  const options = window.getByRole('listbox').getByRole('option')
  await expect(options.first()).toBeVisible()
  return options
}

async function registeredSlashMenuComponents(window: Page, editor: Locator): Promise<string[]> {
  const options = await openSlashMenu(window, editor)
  const labels = await options.evaluateAll(elements => elements.map(element => element.textContent?.replace(/\s+/gu, ' ').trim() ?? ''))
  await window.keyboard.press('Escape')
  await window.keyboard.press('Backspace')
  return labels
}

async function addTodoStates(editor: Locator, window: Page): Promise<void> {
  const tasks = editor.locator('[data-list-kind="task"]')
  const appendTaskText = async (text: string): Promise<void> => {
    const paragraph = editor.locator('[data-list-kind="task"] > .list-content > *').last()
    await paragraph.click()
    await window.keyboard.insertText(text)
    await expect(paragraph).toHaveText(text)
  }

  await expect(tasks).toHaveCount(1)
  await appendTaskText('clipboard todo todo')
  await window.keyboard.press('Enter')
  await window.keyboard.press('Meta+Enter')
  await expect(tasks).toHaveCount(2)
  await appendTaskText('clipboard todo doing')
  await window.keyboard.press('Enter')
  await window.keyboard.press('Meta+Enter')
  await expect(tasks).toHaveCount(3)
  await appendTaskText('clipboard todo done')
  const statusButton = (index: number) => tasks.nth(index).getByRole('button', { name: /Task status:/u })
  const setTaskStatus = async (index: number, expected: 'todo' | 'doing' | 'done'): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await tasks.nth(index).getAttribute('data-task-status') === expected)
        return
      await statusButton(index).click()
      await expect.poll(() => tasks.nth(index).getAttribute('data-task-status')).not.toBeNull()
    }
    await expect(tasks.nth(index)).toHaveAttribute('data-task-status', expected)
  }
  await setTaskStatus(1, 'doing')
  await setTaskStatus(2, 'done')
  await expect(tasks.nth(0)).toHaveAttribute('data-task-status', 'todo')
}

async function appendRegisteredComponents(window: Page, editor: Locator, labels: readonly string[]): Promise<void> {
  for (const label of labels) {
    const beforeTaskLists = await editor.locator('[data-list-kind="task"]').count()
    const options = await openSlashMenu(window, editor)
    const option = options.filter({ hasText: label })
    await expect(option).toHaveCount(1)
    await option.click()
    await expect(options.first()).toBeHidden()

    if (await editor.locator('[data-list-kind="task"]').count() > beforeTaskLists)
      await addTodoStates(editor, window)
  }
}

async function editorStructure(editor: Locator): Promise<readonly unknown[]> {
  return editor.evaluate((root) => {
    const normalizeText = (element: Element): string => {
      const clone = element.cloneNode(true)
      if (!(clone instanceof Element))
        return ''
      clone.querySelectorAll('[data-card-hover-controls], [data-task-meta], select, .ProseMirror-separator, .ProseMirror-trailingBreak, .prosemirror-math-source, .prosemirror-math-display').forEach(node => node.remove())
      return clone.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
    }

    return Array.from(root.children).map((element) => {
      const code = element.querySelector('pre[data-language] code')
      const table = element.querySelector('table')
      return {
        cardDirections: Array.from(element.querySelectorAll('[data-card-delimiter]'))
          .map(card => card.getAttribute('data-card-direction')),
        code: code?.textContent ?? null,
        codeLanguage: element.querySelector('pre[data-language]')?.getAttribute('data-language') ?? null,
        kind: element.getAttribute('data-list-kind'),
        shape: table
          ? {
              columns: table.rows[0]?.cells.length ?? 0,
              rows: table.rows.length,
            }
          : null,
        tag: element.tagName,
        text: normalizeText(element),
      }
    })
  })
}

function attachErrorCapture(window: Page): string[] {
  const errors: string[] = []
  window.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  window.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(`console: ${message.text()}`)
  })
  window.on('dialog', (dialog) => {
    errors.push(`dialog: ${dialog.message()}`)
    void dialog.dismiss()
  })
  return errors
}

test('copies all registered slash-menu components to another Note', async () => {
  test.setTimeout(180_000)
  const environment = await createPagesTestEnvironment('memorilo-clipboard-components-', [])
  let application: ElectronApplication | null = null
  try {
    application = await launchPagesTestApplication(environment)
    const window = await application.firstWindow()
    const errors = attachErrorCapture(window)
    await createNote(window, 'Clipboard source')

    const editor = window.locator('section[aria-label="Clipboard source"]').getByRole('textbox', { name: 'Editor content' })
    const registeredComponents = await registeredSlashMenuComponents(window, editor)
    expect(registeredComponents.length).toBeGreaterThan(0)
    await appendRegisteredComponents(window, editor, registeredComponents)

    const sourceStructure = await editorStructure(editor)
    await expect(editor.locator('[data-list-kind="task"]')).toHaveCount(3)
    await editor.focus()
    await window.keyboard.press('Meta+A')
    await window.keyboard.press('Meta+C')

    await createNote(window, 'Clipboard target')
    const targetEditor = window.locator('section[aria-label="Clipboard target"]').getByRole('textbox', { name: 'Editor content' })
    await targetEditor.locator('[data-block-id]').first().click()
    await window.keyboard.press('Meta+A')
    await targetEditor.click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Paste' }).click()
    await expect(targetEditor.locator('pre[data-language]')).not.toHaveCount(0)
    await expect.poll(() => editorStructure(targetEditor), { timeout: 30_000 }).toEqual(sourceStructure)
    await expect(targetEditor.locator('[data-list-kind="task"]')).toHaveCount(3)
    await expect(window.locator('section[aria-label="Clipboard target"] [role="status"]')).toHaveCount(0)
    expect(errors).toEqual([])

    await window.getByRole('link', { name: 'Pages' }).click()
    await expect(window.getByRole('main', { name: 'Pages' })).toBeVisible()
    await window.getByRole('button', { name: 'Open Note: Clipboard target' }).click()
    const reopenedEditor = window.locator('section[aria-label="Clipboard target"]').getByRole('textbox', { name: 'Editor content' })
    await expect.poll(() => editorStructure(reopenedEditor), { timeout: 30_000 }).toEqual(sourceStructure)
    await expect(window.locator('section[aria-label="Clipboard target"] [role="status"]')).toHaveCount(0)
    expect(errors).toEqual([])
  }
  finally {
    if (application)
      await application.close()
    await removePagesTestEnvironment(environment)
  }
})
