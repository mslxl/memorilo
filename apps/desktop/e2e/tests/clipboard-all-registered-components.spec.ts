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
  await expect(window.getByRole('textbox', { name: 'Editor content' })).toBeVisible()
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
  await window.keyboard.type('/')
  const options = window.getByRole('option')
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
    const paragraph = editor.locator('[data-list-kind="task"] > .list-content > p').last()
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
  await statusButton(1).click()
  await statusButton(2).click()
  await statusButton(2).click()
  await expect(tasks.nth(0)).toHaveAttribute('data-task-status', 'todo')
  await expect(tasks.nth(1)).toHaveAttribute('data-task-status', 'doing')
  await expect(tasks.nth(2)).toHaveAttribute('data-task-status', 'done')
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
    const dynamicAttribute = /^id$|id$|^aria-(?:activedescendant|controls|describedby|owns)$/iu
    return Array.from(root.querySelectorAll<HTMLElement>('*')).map(element => ({
      attributes: Array.from(element.attributes)
        .filter(attribute => !dynamicAttribute.test(attribute.name))
        .map(attribute => [attribute.name, attribute.value] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
      children: element.children.length,
      tag: element.tagName,
      text: element.children.length === 0 ? element.textContent : undefined,
    }))
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

    const editor = window.getByRole('textbox', { name: 'Editor content' })
    const registeredComponents = await registeredSlashMenuComponents(window, editor)
    expect(registeredComponents.length).toBeGreaterThan(0)
    await appendRegisteredComponents(window, editor, registeredComponents)

    const sourceStructure = await editorStructure(editor)
    await expect(editor.locator('[data-list-kind="task"]')).toHaveCount(3)
    await editor.focus()
    await window.keyboard.press('Meta+A')
    await window.keyboard.press('Meta+C')

    await createNote(window, 'Clipboard target')
    const targetEditor = window.getByRole('textbox', { name: 'Editor content' })
    await targetEditor.locator('[data-block-id]').first().click()
    await window.keyboard.press('Meta+A')
    await window.keyboard.press('Meta+V')
    await expect.poll(() => editorStructure(targetEditor), { timeout: 30_000 }).toEqual(sourceStructure)
    await expect(targetEditor.locator('[data-list-kind="task"]')).toHaveCount(3)
    await expect(window.locator('section[aria-label="Clipboard target"] [role="status"]')).toHaveCount(0)
    expect(errors).toEqual([])

    await window.getByRole('link', { name: 'Pages' }).click()
    await expect(window.getByRole('main', { name: 'Pages' })).toBeVisible()
    await window.getByRole('button', { name: 'Open Note: Clipboard target' }).click()
    const reopenedEditor = window.getByRole('textbox', { name: 'Editor content' })
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
