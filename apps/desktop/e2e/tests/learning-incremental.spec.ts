import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

type RpcValue = unknown

async function rpc(window: Page, method: string, args: readonly RpcValue[] = []): Promise<any> {
  return window.evaluate(async ({ args: requestArgs, method: requestMethod }) => {
    const response = await fetch(`memorilo://api/rpc/learning/${requestMethod}`, {
      body: JSON.stringify({ args: requestArgs }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    if (!response.ok)
      throw new Error(`Learning RPC ${requestMethod} failed with status ${response.status}`)
    return response.json()
  }, { args, method })
}

async function createHighlightedNote(window: Page, title: string, withSecondHighlight = false): Promise<ReturnType<Page['getByRole']>> {
  await window.locator('a[href*="/journals"]').waitFor()
  await window.keyboard.press('Meta+P')
  await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

  const editor = window.locator('[data-editor-content]')
  const initialBlock = editor.locator('[data-block-id]').first()
  await expect(initialBlock).toBeVisible()
  await initialBlock.click()
  await window.keyboard.press('End')
  await window.keyboard.type('Context remains editable.')
  await window.keyboard.press('Enter')
  await window.keyboard.type('Incremental learning keeps source notes editable.')

  const sourceBlock = editor.locator('[data-block-id]').last()
  await sourceBlock.evaluate((element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
    if (!(text instanceof Text))
      throw new Error('Learning source Block has no text node')
    const selection = document.getSelection()
    if (!selection)
      throw new Error('Learning source selection is unavailable')
    const range = document.createRange()
    range.selectNodeContents(text)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await expect(window.locator('[data-inline-menu="main"]')).toBeVisible()
  await window.locator('[data-inline-menu="main"] [data-editor-action="highlight"]').click()
  await expect(sourceBlock.locator('[data-inline-highlight="yellow"]')).toHaveText('Incremental learning keeps source notes editable.')
  if (withSecondHighlight) {
    await sourceBlock.click()
    await window.keyboard.press('End')
    await window.keyboard.press('Enter')
    await window.keyboard.type('A second Reading Item remains in the queue.')
    const secondBlock = editor.locator('[data-block-id]').last()
    await selectBlockText(secondBlock)
    await expect(window.locator('[data-inline-menu="main"]')).toBeVisible()
    await window.locator('[data-inline-menu="main"] [data-editor-action="highlight"]').click()
    await expect(secondBlock.locator('[data-inline-highlight="yellow"]')).toHaveText('A second Reading Item remains in the queue.')
  }
  return editor
}

async function selectBlockText(block: ReturnType<Page['locator']>): Promise<void> {
  await block.evaluate((element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
    if (!(text instanceof Text))
      throw new Error('Learning Block has no text node')
    const selection = document.getSelection()
    if (!selection)
      throw new Error('Learning selection is unavailable')
    const range = document.createRange()
    range.selectNodeContents(text)
    selection.removeAllRanges()
    selection.addRange(range)
  })
}

async function openIncrementalLearning(window: Page): Promise<void> {
  await window.locator('a[href="/learning"]').click()
  await window.locator('a[href*="/learning/review"]').click()
  await expect(window.locator('main[data-page="learning-reading-workspace"]')).toBeVisible()
}

test('runs a Highlight Reading Item through the editable Learning workspace', async () => {
  const environment = await createPagesTestEnvironment('memorilo-learning-incremental-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    try {
      const window = await application.firstWindow()
      const title = 'Incremental Learning E2E 8adf2d'
      await createHighlightedNote(window, title)

      await expect.poll(async () => (await rpc(window, 'listReadingItems', [{ includeScheduled: true }])).length).toBe(1)
      await openIncrementalLearning(window)

      const workspace = window.locator('main[data-page="learning-reading-workspace"]')
      await expect(workspace.locator('aside#learning-note-structure')).toBeVisible()
      await expect(workspace.locator('[data-learning-action="make-card"][data-learning-state="available"]')).toBeVisible()
      await expect(workspace.locator('[data-learning-action="next"]')).toBeVisible()
      await expect(workspace.locator('[data-inline-highlight="yellow"]')).toHaveText('Incremental learning keeps source notes editable.')
      await expect(workspace.locator('[data-learning-source-marker]')).toBeVisible()

      await workspace.locator('[data-learning-action="make-card"]').click()
      await expect(workspace.locator('[data-learning-action="make-card"][data-learning-state="created"]')).toBeDisabled()
      await expect.poll(async () => {
        const notes = await rpc(window, 'listNotesWithCards') as Array<{ cardCount: number, noteTitle: string }>
        return notes.find(note => note.noteTitle === title)?.cardCount ?? 0
      }).toBe(1)

      const readingItemBeforeNext = (await rpc(window, 'listReadingItems', [{ includeScheduled: true }]))[0]
      await workspace.locator('[data-learning-action="next"]').click()
      await expect.poll(async () => (await rpc(window, 'listReadingItems', [{ includeScheduled: true }]))[0]?.state).toBe('learning')
      await expect.poll(async () => await rpc(window, 'getNextLearningKind', [{ now: Date.now() }])).toBe('review')
      const readingItemAfterNext = (await rpc(window, 'listReadingItems', [{ includeScheduled: true }]))[0]
      expect(readingItemAfterNext.state).toBe('learning')
      expect(readingItemAfterNext.nextProcessAt).toBeGreaterThan(readingItemBeforeNext.nextProcessAt ?? 0)
    }
    finally {
      await application.close()
    }
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})

test('moves Reading to Basic Review and back to Reading through the public queue', async () => {
  const environment = await createPagesTestEnvironment('memorilo-learning-mixed-basic-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    try {
      const window = await application.firstWindow()
      await createHighlightedNote(window, 'Mixed Basic Learning E2E')
      await createHighlightedNote(window, 'Mixed Basic Learning E2E Second')
      await expect.poll(async () => (
        (await rpc(window, 'listReadingItems', [{ includeScheduled: true }])).length
      )).toBe(2)
      await openIncrementalLearning(window)
      const workspace = window.locator('main[data-page="learning-reading-workspace"]')
      await workspace.locator('[data-learning-action="make-card"]').click()
      await expect(workspace.locator('[data-learning-action="make-card"][data-learning-state="created"]')).toBeDisabled()

      await expect.poll(async () => {
        const queue = await rpc(window, 'listQueue', [{ limit: 3, now: Date.now() }]) as Array<{ kind: string }>
        return queue.map(item => item.kind)
      }).toEqual(['reading', 'review', 'reading'])

      const cardId = (await rpc(window, 'listQueue', [{ limit: 3, now: Date.now() }]) as Array<{ cardId?: string, kind: string }>)
        .find(item => item.kind === 'review')
        ?.cardId
      if (!cardId)
        throw new Error('Mixed Basic Card is missing from the Review queue')
      await workspace.locator('[data-learning-action="next"]').click()
      await expect.poll(async () => {
        const queue = await rpc(window, 'listQueue', [{ limit: 2, now: Date.now() }]) as Array<{ kind: string }>
        return queue.map(item => item.kind)
      }).toEqual(['review', 'reading'])
      const nextReview = await rpc(window, 'getNextItem') as { mainTargetId: string, queue?: { cardId?: string } } | null
      expect(nextReview?.queue?.cardId).toBe(cardId)
      if (!nextReview?.mainTargetId)
        throw new Error('Mixed Basic Review item is missing its main Target')
      const prepared = await rpc(window, 'prepareReview', [{ targetId: nextReview.mainTargetId }]) as Record<string, unknown>
      const { outcomes: _outcomes, ...token } = prepared
      await rpc(window, 'rateTarget', [{ ...token, rating: 'easy', targetId: nextReview.mainTargetId }])
      await expect.poll(async () => {
        const queue = await rpc(window, 'listQueue', [{ limit: 1, now: Date.now() }]) as Array<{ kind: string }>
        return queue.map(item => item.kind)
      }).toEqual(['reading'])
    }
    finally {
      await application.close()
    }
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})

test('processes extract and cloze actions through Learning scheduling', async () => {
  const environment = await createPagesTestEnvironment('memorilo-learning-actions-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    try {
      const window = await application.firstWindow()
      await createHighlightedNote(window, 'Learning actions E2E 8adf2d')
      await expect.poll(async () => (await rpc(window, 'listReadingItems', [{ includeScheduled: true }])).length).toBe(1)
      await openIncrementalLearning(window)

      const workspace = window.locator('main[data-page="learning-reading-workspace"]')
      const blocks = workspace.locator('[data-editor-content]').locator('[data-block-id]')
      const readingItem = (await rpc(window, 'listReadingItems', [{ includeScheduled: true }]))[0]

      await selectBlockText(blocks.filter({ hasText: 'Context remains editable.' }).first())
      await expect(window.locator('[data-inline-menu="main"]')).toBeVisible()
      await window.locator('[data-inline-menu="main"] [data-editor-action="highlight"]').click()
      await expect.poll(async () => (await rpc(window, 'listReadingItems', [{ includeScheduled: true, readingItemId: readingItem.readingItemId }]))[0]?.state).toBe('learning')
      const afterExtract = (await rpc(window, 'listReadingItems', [{ includeScheduled: true, readingItemId: readingItem.readingItemId }]))[0]
      expect(afterExtract.nextProcessAt).toBeGreaterThan(Date.now())

      await selectBlockText(blocks.filter({ hasText: 'Incremental learning keeps source notes editable.' }).first())
      await expect(window.locator('[data-inline-menu="main"]')).toBeVisible()
      await window.locator('[data-inline-menu="main"] [data-editor-action="cloze"]').click()
      await expect.poll(async () => (await rpc(window, 'listReadingItems', [{ includeScheduled: true, readingItemId: readingItem.readingItemId }]))[0]?.nextProcessAt).toBeGreaterThan((afterExtract.nextProcessAt ?? 0) + 20 * 60 * 60 * 1000)
      const afterCloze = (await rpc(window, 'listReadingItems', [{ includeScheduled: true, readingItemId: readingItem.readingItemId }]))[0]
      if (!afterCloze)
        throw new Error('Reading Item disappeared after Cloze')
      expect(afterCloze.nextProcessAt).toBeGreaterThan((afterExtract.nextProcessAt ?? 0) + 20 * 60 * 60 * 1000)
    }
    finally {
      await application.close()
    }
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})
