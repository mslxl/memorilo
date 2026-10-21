import type { ElectronApplication } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

test('loads the next Note page when the virtual list reaches its end', async () => {
  const environment = await createPagesTestEnvironment(
    'memorilo-pages-scroll-',
    Array.from({ length: 130 }, (_, index) => ({
      createdAt: index,
      id: `page-${index.toString().padStart(3, '0')}`,
      title: `Page ${index.toString().padStart(3, '0')}`,
      updatedAt: index,
    })),
  )
  let electronApplication: ElectronApplication | null = null
  try {
    electronApplication = await launchPagesTestApplication(environment)
    const window = await electronApplication.firstWindow()
    await window.locator('button[data-sidebar-toggle]').waitFor()
    await window.locator('a[href*="/pages"]').click()
    await window.locator('button[data-column-id="title"]').click()
    await expect(window.locator('button[data-note-action="open"]').filter({ hasText: 'Page 000' })).toBeVisible()

    await window.getByRole('table').hover()
    await window.mouse.wheel(0, 10_000)
    await expect(window.locator('button[data-note-action="open"]').filter({ hasText: 'Page 100' })).toBeVisible()

    await window.mouse.wheel(0, 10_000)
    await expect(window.locator('button[data-note-action="open"]').filter({ hasText: 'Page 129' })).toBeVisible()
  }
  finally {
    if (electronApplication)
      await electronApplication.close()
    await removePagesTestEnvironment(environment)
  }
})
