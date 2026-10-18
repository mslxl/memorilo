import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

function configuration(): Record<string, unknown> {
  return {
    backup: { enabled: false, intervalMinutes: 1_440, retentionCount: 7 },
    defaultNoteLearningEnabled: true,
    flashcards: {
      buryInterdayLearningSiblings: true,
      buryNewSiblings: true,
      buryReviewSiblings: true,
      interdayOrder: 'before-reviews',
      learnAheadMinutes: 20,
      newCardsPerDay: 20,
      newGatherOrder: 'source',
      reviewOrder: 'due-random',
      studyDayStartsAtHour: 4,
    },
    goals: { dailyLearningGoalCards: 30, dailyLearningGoalMode: 'spread-week' },
    language: 'en',
    learning: { enabled: true },
    mcp: { accessToken: '', enabled: false, port: 8765 },
    networkImagePasteBehavior: 'download',
    outdentBehavior: 'logical',
    readerAnnotationCopyFormat: 'text',
    readerArrowKeyPageTurning: true,
    readerEpubPresentationMode: 'publisher',
    readerPageMode: 'continuous',
    reduceMotion: true,
    tiffConversionFormat: 'webp',
    todo: {
      autoCompleteParentTasks: true,
      blankTaskDurationMinutes: 0,
      enabled: true,
      keepDetailOpenWhenTaskLeavesView: true,
      recurringTaskCompletionAction: 'archive-completed-to-today',
      timelineWorkdayEndMinutes: 21 * 60,
      timelineWorkdayStartMinutes: 7 * 60,
    },
    weekStart: 'sunday',
  }
}

async function launchApplication(): Promise<{ application: ElectronApplication, directory: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'memorilo-todo-detail-'))
  const userDataDirectory = resolve(directory, 'user-data')
  await mkdir(userDataDirectory, { recursive: true })
  await writeFile(resolve(userDataDirectory, 'configuration.json'), `${JSON.stringify(configuration(), null, 2)}\n`, 'utf8')
  const application = await electron.launch({
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
  return { application, directory }
}

async function closeApplication(context: Awaited<ReturnType<typeof launchApplication>>): Promise<void> {
  await context.application.close()
  await rm(context.directory, { force: true, recursive: true })
}

async function createNoteWithNestedTodo(page: Page, noteTitle: string): Promise<void> {
  await page.locator('a[href*="/journals"]').waitFor()
  await page.keyboard.press('Meta+P')
  await page.locator('input[role=combobox][aria-autocomplete=list]').fill(noteTitle)
  await page.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

  const editor = page.locator('[data-editor-content]')
  const heading = editor.locator('[data-block-id]').first()
  await expect(heading).toBeVisible()
  await editor.focus()
  await heading.evaluate((element) => {
    const selection = globalThis.getSelection()
    if (!selection)
      throw new Error('Editor selection is unavailable')
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('/todo')
  await page.locator('[role=option][data-slash-command="task-list"]').click()
  await expect(page.locator('[data-list-kind="task"]')).toHaveCount(1, { timeout: 15_000 })
  const firstTaskParagraph = page.locator('[data-list-kind="task"] > .list-content > p').first()
  await expect(firstTaskParagraph).toBeVisible({ timeout: 15_000 })
  await firstTaskParagraph.click()
  await page.keyboard.insertText('Todo detail root')
  await expect(page.locator('[data-list-kind="task"] > .list-content > p').filter({ hasText: 'Todo detail root' })).toHaveCount(1, { timeout: 15_000 })
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-list-kind="task"]')).toHaveCount(2, { timeout: 15_000 })
  await page.keyboard.press('Tab')
  await page.keyboard.insertText('Todo detail child')
  await expect(page.locator('[data-list-kind="task"] > .list-content > p').filter({ hasText: 'Todo detail root' })).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('[data-list-kind="task"] > .list-content > p').filter({ hasText: 'Todo detail child' })).toHaveCount(1, { timeout: 15_000 })
}

function blockByText(root: Locator, text: string): Locator {
  return root.locator('[data-list-kind] > .list-content > p').filter({ hasText: text }).locator('..').locator('..')
}

test.describe('Todo detail sidebar', () => {
  test.setTimeout(180_000)

  test('opens without navigation, edits the subtree, updates schedule/status, and returns to the source Note', async () => {
    const context = await launchApplication()
    try {
      const page = await context.application.firstWindow()
      await createNoteWithNestedTodo(page, 'Todo detail E2E')

      const rootInNote = page.locator('[data-list-kind="task"] > .list-content > p').filter({ hasText: 'Todo detail root' }).locator('..').locator('..')
      const rootBlockId = await rootInNote.getAttribute('data-block-id')
      if (!rootBlockId)
        throw new Error('Todo root is missing a block id')
      const initialHash = await page.evaluate(() => globalThis.location.hash)

      await page.locator('a[href*="/todo"]').click()
      await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toMatch(/^#\/todo(?:\?|$)/)
      await page.locator(`[data-task-block-id="${rootBlockId}"]`).click()

      const sidebar = page.locator('[data-task-detail-sidebar]')
      await expect(sidebar).toBeVisible()
      await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toBe('#/todo')
      expect(await page.evaluate(() => globalThis.location.hash)).not.toBe(initialHash)

      const detailEditor = sidebar.locator('[data-todo-detail-editor]')
      await expect(detailEditor.locator('[data-outline-focus-root]')).toHaveAttribute('data-block-id', rootBlockId)
      await expect(detailEditor.locator(`[data-block-id="${rootBlockId}"]`)).toHaveText(/Todo detail root/)
      await expect(blockByText(detailEditor, 'Todo detail child')).toHaveCount(1)
      await expect(blockByText(detailEditor, 'Todo detail child')).toBeVisible()
      await expect(blockByText(detailEditor, 'Todo detail root').locator(':scope > .list-marker')).toHaveCSS('display', 'none')

      const rootParagraph = blockByText(detailEditor, 'Todo detail root').locator(':scope > .list-content > p')
      await rootParagraph.selectText()
      await page.keyboard.insertText('Todo detail root edited')
      const childParagraph = blockByText(detailEditor, 'Todo detail child').locator(':scope > .list-content > p')
      await childParagraph.selectText()
      await page.keyboard.insertText('Todo detail child edited')
      await expect(detailEditor).toContainText('Todo detail root edited')
      await expect(detailEditor).toContainText('Todo detail child edited')

      const statusButton = sidebar.locator('[data-task-detail-action="status"]')
      await statusButton.click()
      await expect(statusButton).toBeVisible()

      await sidebar.locator('[data-task-action-trigger="schedule"]').click()
      const schedule = page.locator('[data-task-action-panel]')
      await expect(schedule).toBeVisible()
      await schedule.locator('[data-task-quick-date="tomorrow"]').click()
      await expect(schedule.locator('[data-task-setting="time"]')).toBeVisible()
      await schedule.locator('[data-task-setting="time"]').click({ force: true })
      const timePicker = page.locator('[data-task-time-picker]')
      await timePicker.locator('input[type="time"]').fill('13:30')
      await timePicker.locator('button').first().click({ force: true })
      await expect(schedule).toBeHidden()

      const sourceLink = sidebar.getByRole('link', { name: 'Todo detail E2E' })
      await sourceLink.click()
      await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toMatch(/^#\/note\/[^/]+\/[^/?]+\?focus=/)
      const focusedRoot = page.locator(`[data-block-id="${rootBlockId}"]`)
      await expect.poll(async () => focusedRoot.evaluate((block) => {
        const selection = document.getSelection()
        return {
          activeEditor: document.activeElement?.matches('[data-editor-content].ProseMirror') === true,
          anchorInsideRoot: selection?.anchorNode ? block.contains(selection.anchorNode) : false,
          focusInsideRoot: selection?.focusNode ? block.contains(selection.focusNode) : false,
        }
      })).toEqual({ activeEditor: true, anchorInsideRoot: true, focusInsideRoot: true })
      await expect(page.locator('[data-editor-content]')).toContainText('Todo detail root edited')
      await expect(page.locator('[data-editor-content]')).toContainText('Todo detail child edited')
      await expect(focusedRoot).toHaveAttribute('data-task-status', 'doing')
    }
    finally {
      await closeApplication(context)
    }
  })

  test('syncs subtask edits from the detail sidebar to the Todo list and source Note', async () => {
    const context = await launchApplication()
    try {
      const page = await context.application.firstWindow()
      await createNoteWithNestedTodo(page, 'Todo subtask detail E2E')

      const childInNote = page.locator('[data-list-kind="task"] > .list-content > p').filter({ hasText: 'Todo detail child' }).locator('..').locator('..')
      const childBlockId = await childInNote.getAttribute('data-block-id')
      if (!childBlockId)
        throw new Error('Todo child is missing a block id')

      await page.locator('a[href*="/todo"]').click()
      await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toMatch(/^#\/todo(?:\?|$)/)
      await page.locator(`[data-task-block-id="${childBlockId}"]`).click()

      const sidebar = page.locator('[data-task-detail-sidebar]')
      await expect(sidebar).toBeVisible()
      const detailEditor = sidebar.locator('[data-todo-detail-editor]')
      await expect(detailEditor.locator('[data-outline-focus-root]')).toHaveAttribute('data-block-id', childBlockId)
      await expect(blockByText(detailEditor, 'Todo detail child')).toBeVisible()
      await expect(blockByText(detailEditor, 'Todo detail root')).toHaveAttribute('data-outline-focus-ancestor', '')

      const childParagraph = blockByText(detailEditor, 'Todo detail child').locator(':scope > .list-content > p')
      await childParagraph.selectText()
      await page.keyboard.insertText('Todo detail child edited from sidebar')
      await expect(detailEditor).toContainText('Todo detail child edited from sidebar')

      await sidebar.locator('[data-task-detail-action="close"]').click()
      await expect(page.locator(`[data-task-block-id="${childBlockId}"]`)).toBeVisible()

      await page.locator(`[data-task-block-id="${childBlockId}"]`).click()
      const reopenedSidebar = page.locator('[data-task-detail-sidebar]')
      await reopenedSidebar.locator('[data-task-detail-action="status"]').click()
      await expect(reopenedSidebar.locator('[data-task-detail-action="status"]')).toBeVisible()

      await reopenedSidebar.getByRole('link', { name: 'Todo subtask detail E2E' }).click()
      await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toMatch(/^#\/note\/[^/]+\/[^/?]+\?focus=/)
      const focusedChild = page.locator(`[data-block-id="${childBlockId}"]`)
      await expect(focusedChild).toHaveAttribute('data-task-status', 'doing')
      await expect(focusedChild).toContainText('Todo detail child edited from sidebar')
      await expect(page.locator('[data-editor-content]')).toContainText('Todo detail root')
    }
    finally {
      await closeApplication(context)
    }
  })
})
