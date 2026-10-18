import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'

type Language = 'en' | 'zh-CN'
type RepeatRule = Record<string, unknown>

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

function configuration(language: Language): Record<string, unknown> {
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
    language,
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

async function launchApplication(language: Language): Promise<{
  application: ElectronApplication
  directory: string
}> {
  const directory = await mkdtemp(resolve(tmpdir(), 'memorilo-todo-recurrence-'))
  const userDataDirectory = resolve(directory, 'user-data')
  await mkdir(userDataDirectory, { recursive: true })
  await writeFile(
    resolve(userDataDirectory, 'configuration.json'),
    `${JSON.stringify(configuration(language), null, 2)}\n`,
    'utf8',
  )
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

function localDate(offsetDays = 0): Date {
  const value = new Date()
  value.setHours(12, 0, 0, 0)
  value.setDate(value.getDate() + offsetDays)
  return value
}

function dateKey(value: Date): string {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'))
    .join('-')
}

function icsDate(value: Date): string {
  return dateKey(value).replaceAll('-', '')
}

function holidayCalendar(): string {
  const events = [1, 3, 6, 10].map((offset, index) => {
    const date = localDate(offset)
    return [
      'BEGIN:VEVENT',
      `UID:e2e-holiday-${index}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(localDate(offset + 1))}`,
      `SUMMARY:E2E Holiday ${index + 1}`,
      'END:VEVENT',
    ].join('\r\n')
  })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR', ''].join('\r\n')
}

async function mockChinaHolidayCalendar(application: ElectronApplication): Promise<void> {
  await application.evaluate(async (_electron, calendar) => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : input.url
      if (url.includes('/holiday/CN_zh.ics')) {
        return new Response(calendar, {
          headers: { 'content-type': 'text/calendar', 'etag': '"todo-recurrence-e2e"' },
          status: 200,
        })
      }
      return originalFetch(input, init)
    }
  }, holidayCalendar())
}

async function createNoteWithTasks(page: Page, noteTitle: string, taskTitles: readonly string[]): Promise<void> {
  await page.locator('a[href*="/journals"]').waitFor()
  await page.keyboard.press('Meta+P')
  await page.locator('input[role=combobox][aria-autocomplete=list]').fill(noteTitle)
  await page.locator('[role=listbox] [role=option][id$="-create-note"]').click()

  const editor = page.locator('[data-editor-content]')
  const heading = editor.locator('[data-block-id]').first()
  await expect(heading).toBeVisible()
  await heading.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('/todo')
  await page.locator('[role=option][data-slash-command="task-list"]').click()
  await page.keyboard.insertText(taskTitles[0] ?? '')

  for (const title of taskTitles.slice(1)) {
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText(title)
  }
  for (const title of taskTitles)
    await expect(taskBlock(page, title)).toHaveCount(1)
}

function taskBlock(page: Page, title: string): Locator {
  return page.locator('[data-list-kind="task"]').filter({ hasText: title })
}

async function openSchedule(page: Page, title: string): Promise<{ block: Locator, panel: Locator }> {
  const block = taskBlock(page, title)
  await block.hover()
  await block.locator('[data-task-menu-trigger]').click()
  const panel = page.locator('[data-task-action-panel]')
  await expect(panel).toBeVisible()
  await panel.locator('[data-task-quick-date="today"]').click()
  return { block, panel }
}

async function openRepeat(panel: Locator, page: Page): Promise<Locator> {
  await panel.locator('[data-task-setting="repeat"]').click()
  const repeat = page.locator('[data-task-repeat-picker][data-task-repeat-mode="presets"]')
  await expect(repeat).toBeVisible()
  return repeat
}

async function saveSchedule(panel: Locator): Promise<void> {
  await panel.locator('[data-task-action="save-schedule"]').click()
  await expect(panel).toBeHidden()
}

async function readRule(block: Locator): Promise<RepeatRule | null> {
  const value = await block.getAttribute('data-task-repeat')
  return value === null ? null : JSON.parse(value) as RepeatRule
}

async function expectRule(block: Locator, expected: RepeatRule): Promise<void> {
  await expect.poll(() => readRule(block)).toMatchObject(expected)
}

async function configurePreset(
  page: Page,
  title: string,
  preset: string,
  expected: RepeatRule,
): Promise<void> {
  const { block, panel } = await openSchedule(page, title)
  const repeat = await openRepeat(panel, page)
  await repeat.locator(`[data-task-repeat-preset="${preset}"]`).click()
  await saveSchedule(panel)
  await expectRule(block, expected)
}

async function openCustomRepeat(page: Page, title: string): Promise<{
  block: Locator
  panel: Locator
  repeat: Locator
}> {
  const { block, panel } = await openSchedule(page, title)
  const presets = await openRepeat(panel, page)
  await presets.locator('[data-task-repeat-preset="custom"]').click()
  const repeat = page.locator('[data-task-repeat-picker][data-task-repeat-mode="custom"]')
  await expect(repeat.locator('[data-task-field="reference"]')).toBeVisible()
  return { block, panel, repeat }
}

async function saveCustomRepeat(panel: Locator, repeat: Locator): Promise<void> {
  await repeat.locator('[data-task-action="save-repeat"]').click()
  await saveSchedule(panel)
}

async function setWeekdays(repeat: Locator, wanted: readonly number[]): Promise<void> {
  const group = repeat.locator('[data-task-group="repeat-weekdays"]')
  for (const weekday of wanted) {
    const button = group.locator(`[data-task-weekday="${weekday}"]`)
    if (await button.getAttribute('aria-pressed') !== 'true')
      await button.click()
  }
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    if (wanted.includes(weekday))
      continue
    const button = group.locator(`[data-task-weekday="${weekday}"]`)
    if (await button.getAttribute('aria-pressed') === 'true')
      await button.click()
  }
}

async function setCheckbox(repeat: Locator, field: string, checked: boolean): Promise<void> {
  const checkbox = repeat.locator(`[data-task-field="${field}"]`)
  if (await checkbox.isChecked() !== checked)
    await checkbox.click()
}

test.describe('Todo recurrence user flows', () => {
  test.setTimeout(240_000)

  test('covers presets and every regular custom rule combination', async () => {
    const context = await launchApplication('en')
    try {
      const page = await context.application.firstWindow()
      const today = localDate()
      const titles = [
        'E2E repeat daily preset',
        'E2E repeat weekly preset',
        'E2E repeat monthly preset',
        'E2E repeat yearly preset',
        'E2E repeat workdays preset',
        'E2E repeat completion week',
        'E2E repeat selected month date',
        'E2E repeat monthly weekday',
        'E2E repeat monthly workday',
        'E2E repeat yearly date',
        'E2E repeat yearly weekday',
        'E2E repeat disable',
      ]
      await createNoteWithTasks(page, 'Todo recurrence E2E', titles)

      await configurePreset(page, titles[0]!, 'day', {
        interval: 1,
        mode: 'due',
        skipHolidays: false,
        skipWeekends: false,
        unit: 'day',
      })
      await configurePreset(page, titles[1]!, 'week', {
        interval: 1,
        mode: 'due',
        unit: 'week',
        weekdays: [today.getDay()],
      })
      await configurePreset(page, titles[2]!, 'month', {
        interval: 1,
        mode: 'due',
        monthDay: today.getDate(),
        monthMode: 'date',
        unit: 'month',
      })
      await configurePreset(page, titles[3]!, 'year', {
        interval: 1,
        mode: 'due',
        unit: 'year',
        yearDay: today.getDate(),
        yearMode: 'date',
        yearMonth: today.getMonth() + 1,
      })
      await configurePreset(page, titles[4]!, 'workday', {
        interval: 1,
        mode: 'due',
        skipHolidays: false,
        skipWeekends: true,
        unit: 'day',
      })

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[5]!)
        await repeat.locator('[data-task-field=reference]').selectOption('completion')
        await repeat.locator('[data-task-field=interval]').fill('2')
        await repeat.locator('[data-task-field=unit]').selectOption('week')
        await setWeekdays(repeat, [1, 3, 5])
        await repeat.locator('[data-task-field=end]').selectOption('date')
        const endDate = dateKey(localDate(120))
        await repeat.locator('[data-task-field=end-date]').fill(endDate)
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          endDate,
          interval: 2,
          mode: 'completion',
          unit: 'week',
          weekdays: [1, 3, 5],
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[6]!)
        await repeat.locator('[data-task-field=reference]').selectOption('custom')
        await repeat.locator('[data-task-month-navigation=next]').click()
        await repeat.locator('[data-task-date]').filter({ hasText: '15' }).click()
        await repeat.locator('[data-task-field=interval]').fill('2')
        await repeat.locator('[data-task-field=unit]').selectOption('month')
        await repeat.locator('[data-task-month-mode=date], [data-task-year-mode=date]').click()
        await repeat.locator('[data-task-group=day-of-month] [data-task-day-of-month=31]').click()
        const anchor = new Date(today.getFullYear(), today.getMonth() + 1, 15, 12)
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          anchorDate: dateKey(anchor),
          interval: 2,
          mode: 'custom',
          monthDay: 31,
          monthMode: 'date',
          unit: 'month',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[7]!)
        await repeat.locator('[data-task-field=reference]').selectOption('due')
        await repeat.locator('[data-task-field=unit]').selectOption('month')
        await repeat.locator('[data-task-month-mode=weekday], [data-task-year-mode=weekday]').click()
        await repeat.locator('[data-task-field=occurrence]').selectOption('-1')
        await repeat.locator('[data-task-field=weekday]').selectOption('5')
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          interval: 1,
          mode: 'due',
          monthMode: 'weekday',
          monthOrdinal: -1,
          monthWeekday: 5,
          unit: 'month',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[8]!)
        await repeat.locator('[data-task-field=reference]').selectOption('completion')
        await repeat.locator('[data-task-field=interval]').fill('3')
        await repeat.locator('[data-task-field=unit]').selectOption('month')
        await repeat.locator('[data-task-month-mode=workday]').click()
        await repeat.locator('[data-task-field=workday-occurrence]').selectOption('3')
        await setCheckbox(repeat, 'skip-weekends', true)
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          interval: 3,
          mode: 'completion',
          monthMode: 'workday',
          monthOrdinal: 3,
          skipWeekends: true,
          unit: 'month',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[9]!)
        await repeat.locator('[data-task-field=reference]').selectOption('due')
        await repeat.locator('[data-task-field=interval]').fill('2')
        await repeat.locator('[data-task-field=unit]').selectOption('year')
        await repeat.locator('[data-task-month-mode=date], [data-task-year-mode=date]').click()
        await repeat.locator('[data-task-field=month]').selectOption('2')
        await repeat.locator('[data-task-group=day-of-month] [data-task-day-of-month=last]').click()
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          interval: 2,
          mode: 'due',
          unit: 'year',
          yearDay: 'last',
          yearMode: 'date',
          yearMonth: 2,
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[10]!)
        await repeat.locator('[data-task-field=reference]').selectOption('completion')
        await repeat.locator('[data-task-field=unit]').selectOption('year')
        await repeat.locator('[data-task-month-mode=weekday], [data-task-year-mode=weekday]').click()
        await repeat.locator('[data-task-field=month]').selectOption('11')
        await repeat.locator('[data-task-field=occurrence]').selectOption('4')
        await repeat.locator('[data-task-field=weekday]').selectOption('4')
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          interval: 1,
          mode: 'completion',
          unit: 'year',
          yearMode: 'weekday',
          yearMonth: 11,
          yearOrdinal: 4,
          yearWeekday: 4,
        })
      }

      await configurePreset(page, titles[11]!, 'day', { mode: 'due', unit: 'day' })
      {
        const { block, panel } = await openSchedule(page, titles[11]!)
        const repeat = await openRepeat(panel, page)
        await repeat.locator('[data-task-repeat-preset=none]').click()
        await saveSchedule(panel)
        await expect.poll(() => readRule(block)).toBeNull()
      }
    }
    finally {
      await closeApplication(context)
    }
  })

  test('covers statutory-holiday policies, combined filters, and Chinese lunar recurrence', async () => {
    const context = await launchApplication('zh-CN')
    try {
      await mockChinaHolidayCalendar(context.application)
      const page = await context.application.firstWindow()
      const titles = [
        'E2E 节假日过滤组合',
        'E2E 法定节假日重复',
        'E2E 节假日顺延',
        'E2E 跳过整次节假日',
        'E2E 农历重复',
      ]
      await createNoteWithTasks(page, 'Todo 重复 E2E', titles)

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[0]!)
        await repeat.locator('[data-task-field=reference]').selectOption('due')
        await repeat.locator('[data-task-field=interval]').fill('1')
        await repeat.locator('[data-task-field=unit]').selectOption('day')
        await setCheckbox(repeat, 'skip-holidays', true)
        await setCheckbox(repeat, 'skip-weekends', true)
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          calendarId: 'cn-holidays',
          interval: 1,
          mode: 'due',
          skipHolidays: true,
          skipWeekends: true,
          unit: 'day',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[1]!)
        await repeat.locator('[data-task-field=reference]').selectOption('due')
        await repeat.locator('[data-task-field=interval]').fill('2')
        await repeat.locator('[data-task-field=unit]').selectOption('holiday')
        await repeat.locator('[data-task-field=holiday-policy]').selectOption('allow')
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          calendarId: 'cn-holidays',
          holidayPolicy: 'allow',
          interval: 2,
          mode: 'due',
          unit: 'holiday',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[2]!)
        await repeat.locator('[data-task-field=reference]').selectOption('completion')
        await repeat.locator('[data-task-field=unit]').selectOption('holiday')
        await repeat.locator('[data-task-field=holiday-policy]').selectOption('next-workday')
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          calendarId: 'cn-holidays',
          holidayPolicy: 'next-workday',
          interval: 1,
          mode: 'completion',
          unit: 'holiday',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[3]!)
        await repeat.locator('[data-task-field=reference]').selectOption('due')
        await repeat.locator('[data-task-field=unit]').selectOption('week')
        await repeat.locator('[data-task-field=holiday-policy]').selectOption('skip')
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          calendarId: 'cn-holidays',
          holidayPolicy: 'skip',
          interval: 1,
          mode: 'due',
          unit: 'week',
        })
      }

      {
        const { block, panel, repeat } = await openCustomRepeat(page, titles[4]!)
        await repeat.locator('[data-task-field=reference]').selectOption('custom')
        await repeat.locator('[data-task-month-navigation=next]').click()
        await repeat.locator('[data-task-date]').filter({ hasText: '15' }).click()
        await repeat.locator('[data-task-field=interval]').fill('2')
        await repeat.locator('[data-task-field=unit]').selectOption('lunar')
        await repeat.locator('[data-task-field=lunar-month]').selectOption('8')
        await repeat.locator('[data-task-field=lunar-day]').selectOption('15')
        const today = localDate()
        const anchor = new Date(today.getFullYear(), today.getMonth() + 1, 15, 12)
        await saveCustomRepeat(panel, repeat)
        await expectRule(block, {
          anchorDate: dateKey(anchor),
          interval: 2,
          lunarDay: 15,
          lunarMonth: 8,
          mode: 'custom',
          unit: 'lunar',
        })
      }
    }
    finally {
      await closeApplication(context)
    }
  })
})
