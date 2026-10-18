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

test('switches timeline views and creates a task in multi-day view', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-todo-timeline-'))
  const electronApplication = await electron.launch({
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
  try {
    const window = await electronApplication.firstWindow()
    await window.locator('a[href*="/todo"]').click()

    const scheduleButton = window.locator('[data-todo-view-option="agenda"]')
    const timelineButton = window.locator('[data-todo-view-option="timeline"]')

    await scheduleButton.click()
    await expect.poll(() => window.evaluate(() => globalThis.location.hash)).toBe('#/todo?view=agenda')
    await timelineButton.click()
    await expect.poll(() => window.evaluate(() => globalThis.location.hash)).toBe('#/todo?view=timeline')
    const calendar = window.locator('[data-todo-time-grid-calendar]')
    await calendar.waitFor()

    await window.locator('[data-todo-time-grid-mode="multi-day"]').click()
    const dayColumn = calendar.locator('.fc-timegrid-col[data-date]').first()
    const timeSlot = calendar.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]').first()
    const [dayColumnBox, timeSlotBox] = await Promise.all([dayColumn.boundingBox(), timeSlot.boundingBox()])
    if (dayColumnBox === null || timeSlotBox === null)
      throw new Error('Multi-day timeline slot is unavailable')
    await window.mouse.click(dayColumnBox.x + dayColumnBox.width / 2, timeSlotBox.y + timeSlotBox.height / 2)

    await expect(window.locator('[data-task-detail-sidebar]')).toBeVisible()
  }
  finally {
    await electronApplication.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
