import type { Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDist = resolve(repositoryRoot, 'apps/desktop/dist')

function packagedExecutable(): string {
  if (process.platform === 'darwin') {
    const directory = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    return resolve(desktopDist, directory, 'memorilo.app', 'Contents/MacOS/memorilo')
  }
  if (process.platform === 'win32')
    return resolve(desktopDist, 'win-unpacked/memorilo.exe')
  if (process.platform === 'linux')
    return resolve(desktopDist, 'linux-unpacked/memorilo')
  throw new Error(`Unsupported packaged test platform: ${process.platform}`)
}

async function createPage(window: Page, title: string) {
  await window.locator('a[href*="/journals"]').waitFor()
  await window.keyboard.press('Meta+P')
  const search = window.locator('input[role=combobox][aria-autocomplete=list]')
  await search.fill(title)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

  await expect(window.locator('[data-editor-content]')).toBeVisible()
  await expect(window.locator('button[data-note-action="open"]').filter({ hasText: title })).toBeVisible()
}

test('reproduces formula layout regressions in an Outline Page', async () => {
  test.setTimeout(120_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-math-outline-'))
  const environment = Object.fromEntries(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined),
  )
  const application = await electron.launch({
    args: [`--user-data-dir=${userDataDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...environment,
      MEMORILO_DATABASE_PATH: ':memory:',
      MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      MEMORILO_E2E_HIDE_WINDOW: '1',
      MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
    },
    executablePath: packagedExecutable(),
  })

  try {
    const window = await application.firstWindow()
    const title = 'Outline formula layout reproduction'
    await createPage(window, title)

    const editor = window.locator('[data-editor-content]')
    await window.keyboard.press('Meta+P')
    await window.locator('input[role=combobox][aria-autocomplete=list]').fill('editor-mode-outline')
    await window.locator('[role=listbox] [role=option][id$="-editor-mode-outline"]').click()
    await expect(window.locator('[data-editor-mode="outline"]')).toBeVisible()

    const firstBlock = editor.locator('[data-block-id]').first()
    await firstBlock.click()
    await window.keyboard.press('End')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('$\\frac{1}{2}$')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('$$')
    await window.keyboard.press('Enter')
    await window.keyboard.insertText('x^2')
    await firstBlock.click()

    const inlineFormula = editor.locator('.prosemirror-math-inline')
    const blockFormula = editor.locator('.prosemirror-math-block')
    await expect(inlineFormula).toHaveCount(1)
    await expect(blockFormula).toHaveCount(1)
    await expect(blockFormula.locator('math')).toHaveCount(1)
    await window.waitForTimeout(500)

    const layout = await editor.evaluate((root) => {
      const box = (element: Element | null) => {
        if (!element)
          return null
        const rect = element.getBoundingClientRect()
        return { height: rect.height, left: rect.left, top: rect.top, width: rect.width }
      }
      const inline = root.querySelector<HTMLElement>('.prosemirror-math-inline')
      const inlineBlock = inline?.closest<HTMLElement>('[data-block-id]')
      const inlineMarker = inlineBlock?.querySelector<HTMLElement>(':scope > .list-marker')
      const inlineKatex = inline?.querySelector<HTMLElement>('.prosemirror-math-display .katex')
      const block = root.querySelector<HTMLElement>('.prosemirror-math-block')
      const blockContainer = block?.closest<HTMLElement>('[data-block-id]')
      const blockMarker = blockContainer?.querySelector<HTMLElement>(':scope > .list-marker')
      const blockMath = block?.querySelector<HTMLElement>('math')
      const blockDisplay = block?.querySelector<HTMLElement>('.prosemirror-math-display')
      if (!inlineBlock || !inlineMarker || !inlineKatex || !blockContainer || !blockMarker || !blockMath || !blockDisplay)
        throw new Error('Formula layout reproduction nodes are incomplete')

      const inlineMarkerRect = inlineMarker.getBoundingClientRect()
      const inlineKatexRect = inlineKatex.getBoundingClientRect()
      return {
        block: {
          display: box(blockDisplay),
          math: box(blockMath),
          textAlign: getComputedStyle(blockMath).textAlign,
        },
        inline: {
          formula: box(inlineKatex),
          marker: box(inlineMarker),
          markerFormulaCenterDelta: Math.abs(
            inlineMarkerRect.top + inlineMarkerRect.height / 2
            - inlineKatexRect.top - inlineKatexRect.height / 2,
          ),
        },
      }
    })
    await test.info().attach('math-outline-layout.json', {
      body: JSON.stringify(layout, null, 2),
      contentType: 'application/json',
    })
    await test.info().attach('math-outline-layout.png', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })

    expect(layout.inline.markerFormulaCenterDelta).toBeLessThanOrEqual(0.5)
    expect(layout.block.textAlign).toBe('center')
  }
  finally {
    await application.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
