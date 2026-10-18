import { expect, test } from '@playwright/test'

import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

test('keeps the active Editor Block mounted while typing', async () => {
  const environment = await createPagesTestEnvironment('memorilo-editor-input-stability-', [])
  try {
    const application = await launchPagesTestApplication(environment)
    try {
      const window = await application.firstWindow()
      await window.locator('a[href*="/journals"]').waitFor()
      await window.keyboard.press('Meta+P')
      await window.locator('input[role=combobox][aria-autocomplete=list]').fill('Input stability Note')
      await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

      const editor = window.locator('[data-editor-content]')
      await editor.waitFor()
      await editor.locator('[data-block-id]').first().click()
      await window.keyboard.press('End')
      await window.keyboard.press('Enter')

      const activeBlock = editor.locator('[data-block-id]').last()
      const initialBlock = await activeBlock.elementHandle()
      if (!initialBlock)
        throw new TypeError('Active Editor Block is unavailable')

      await window.keyboard.type('a')
      await window.waitForTimeout(50)

      expect(await initialBlock.evaluate(block => block.isConnected)).toBe(true)
      await expect(activeBlock).toContainText('a')
    }
    finally {
      await application.close()
    }
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})
