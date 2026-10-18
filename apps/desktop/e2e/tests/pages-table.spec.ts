import type { ElectronApplication, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

async function openPages(window: Page, expectedCount = '4 notes'): Promise<void> {
  await window.locator('button[data-sidebar-toggle]').waitFor()
  await window.locator('a[href*="/pages"]').click()
  const expectedTotal = Number.parseInt(expectedCount, 10)
  await expect(window.locator(`p[data-note-count="${expectedTotal}"]`)).toBeVisible()
}

async function visibleTitles(window: Page): Promise<string[]> {
  return window.locator('button[data-note-action="open"]').allTextContents()
}

async function expectTitleOrder(window: Page, titles: readonly string[]): Promise<void> {
  await expect.poll(() => visibleTitles(window)).toEqual(titles)
}

test('sorts Notes through each table header', async () => {
  const environment = await createPagesTestEnvironment('memorilo-pages-sort-', [
    { createdAt: 3_000, id: 'alpha-note', title: 'Alpha Note', updatedAt: 1_000 },
    { createdAt: 1_000, id: 'middle-note', title: 'Middle Note', updatedAt: 3_000 },
    { createdAt: 2_000, id: 'zulu-note', title: 'Zulu Note', updatedAt: 2_000 },
  ])
  let application: ElectronApplication | null = null
  try {
    application = await launchPagesTestApplication(environment)
    const window = await application.firstWindow()
    await openPages(window)

    const titleHeader = window.locator('button[data-column-id="title"]')
    await titleHeader.click()
    await expect(titleHeader.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'ascending')
    await expectTitleOrder(window, ['Alpha Note', 'Middle Note', 'Zulu Note'])
    await titleHeader.click()
    await expect(titleHeader.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'descending')
    await expectTitleOrder(window, ['Zulu Note', 'Middle Note', 'Alpha Note'])

    const createdHeader = window.locator('button[data-column-id="createdAt"]')
    await createdHeader.click()
    await expect(createdHeader.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'descending')
    await expectTitleOrder(window, ['Alpha Note', 'Zulu Note', 'Middle Note'])
    await createdHeader.click()
    await expect(createdHeader.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'ascending')
    await expectTitleOrder(window, ['Middle Note', 'Zulu Note', 'Alpha Note'])

    const modifiedHeader = window.locator('button[data-column-id="updatedAt"]')
    await modifiedHeader.click()
    await expect(modifiedHeader.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'descending')
    await expectTitleOrder(window, ['Middle Note', 'Zulu Note', 'Alpha Note'])
    await modifiedHeader.click()
    await expect(modifiedHeader.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'ascending')
    await expectTitleOrder(window, ['Alpha Note', 'Zulu Note', 'Middle Note'])
  }
  finally {
    if (application)
      await application.close()
    await removePagesTestEnvironment(environment)
  }
})

test('renames a Note through the table and keeps the title after restart', async () => {
  const environment = await createPagesTestEnvironment('memorilo-pages-rename-', [
    { createdAt: 1_000, id: 'renamed-note', title: 'Original Note', updatedAt: 1_000 },
  ])
  let application: ElectronApplication | null = null
  try {
    application = await launchPagesTestApplication(environment)
    let window = await application.firstWindow()
    await window.locator('button[data-sidebar-toggle]').waitFor()
    await window.locator('a[href*="/pages"]').click()
    await window.locator('button[data-note-action="rename"][data-note-id="renamed-note"]').click()

    const titleInput = window.locator('input[data-note-action="rename-input"][data-note-id="renamed-note"]')
    await titleInput.fill('Renamed Note')
    await titleInput.press('Enter')
    await expect(window.locator('button[data-note-action="open"][data-note-id="renamed-note"]')).toContainText('Renamed Note')

    await application.close()
    application = null

    application = await launchPagesTestApplication(environment)
    window = await application.firstWindow()
    await window.locator('button[data-sidebar-toggle]').waitFor()
    await window.locator('a[href*="/pages"]').click()
    await expect(window.locator('button[data-note-action="open"][data-note-id="renamed-note"]')).toContainText('Renamed Note')
    await expect(window.locator('button[data-note-action="open"][data-note-id="renamed-note"]').filter({ hasText: 'Original Note' })).toHaveCount(0)
  }
  finally {
    if (application)
      await application.close()
    await removePagesTestEnvironment(environment)
  }
})

test('rejects a duplicate Note title through table rename', async () => {
  const environment = await createPagesTestEnvironment('memorilo-pages-duplicate-title-', [
    { createdAt: 1_000, id: 'alpha-note', title: 'Alpha Note', updatedAt: 1_000 },
    { createdAt: 2_000, id: 'beta-note', title: 'Beta Note', updatedAt: 2_000 },
  ])
  let application: ElectronApplication | null = null
  try {
    application = await launchPagesTestApplication(environment)
    let window = await application.firstWindow()
    await openPages(window, '3 notes')
    await window.locator('button[data-note-action="rename"][data-note-id="alpha-note"]').click()

    const titleInput = window.locator('input[data-note-action="rename-input"][data-note-id="alpha-note"]')
    await titleInput.fill('Beta Note')
    await titleInput.press('Enter')
    const duplicateInput = window.locator('input[data-note-action="rename-input"][data-note-id="alpha-note"][aria-invalid="true"]')
    await expect(duplicateInput).toHaveValue('Beta Note')

    await duplicateInput.press('Escape')
    await expect(window.locator('button[data-note-action="open"][data-note-id="alpha-note"]')).toContainText('Alpha Note')
    await expect(window.locator('button[data-note-action="open"][data-note-id="beta-note"]')).toHaveCount(1)

    await application.close()
    application = null

    application = await launchPagesTestApplication(environment)
    window = await application.firstWindow()
    await openPages(window, '3 notes')
    await expect(window.locator('button[data-note-action="open"][data-note-id="alpha-note"]')).toContainText('Alpha Note')
    await expect(window.locator('button[data-note-action="open"][data-note-id="beta-note"]')).toHaveCount(1)
  }
  finally {
    if (application)
      await application.close()
    await removePagesTestEnvironment(environment)
  }
})
