import type { Page } from '@playwright/test'
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

async function launchApplication(userDataDirectory: string) {
  return electron.launch({
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
}

async function createWhiteboard(window: Page, noteTitle: string, whiteboardTitle: string) {
  await window.locator('a[href*="/journals"]').waitFor()
  await window.locator('label.sidebar-trigger__label-element .sidebar-trigger').click()
  await window.keyboard.press('Meta+P')
  await window.locator('input[role=combobox][aria-autocomplete=list]').fill(noteTitle)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
  await window.locator('[data-note-inspector-toggle]').click()
  await window.locator('[data-note-inspector] h1').click({ button: 'right' })
  await window.locator('[role="menuitem"][data-entry-action="add"]').click()
  await window.locator('[role="menuitem"][data-entry-action="add-whiteboard"]').click()
  const dialog = window.locator('[data-entry-creation-kind="whiteboard"]')
  await dialog.locator('[data-entry-field="title"]').fill(whiteboardTitle)
  await dialog.locator('[data-entry-action="create"]').click()
  await window.locator(`[data-note-entry-topic-type="whiteboard"] a[title="${whiteboardTitle}"]`).click()
}

async function renderedDarkPixelBounds(window: Page) {
  return window.locator('canvas.static').evaluate((canvasElement) => {
    const canvas = canvasElement as HTMLCanvasElement
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      throw new Error('Whiteboard static canvas has no 2D context')
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let bottom = -1
    let count = 0
    let left = canvas.width
    let right = -1
    let top = canvas.height
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4
        const alpha = pixels[index + 3]
        const red = pixels[index]
        const green = pixels[index + 1]
        const blue = pixels[index + 2]
        if (alpha === undefined || red === undefined || green === undefined || blue === undefined)
          throw new Error('Whiteboard static canvas returned an incomplete pixel')
        if (alpha === 0 || red >= 180 || green >= 180 || blue >= 180)
          continue
        count += 1
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    return { bottom, count, left, right, top }
  })
}

function expectRectangleOutline(renderedPixels: Awaited<ReturnType<typeof renderedDarkPixelBounds>>) {
  expect(renderedPixels.count, 'dragging a rectangle must render visible dark pixels').toBeGreaterThan(100)
  expect(renderedPixels.right - renderedPixels.left, 'the rendered outline must retain the dragged width').toBeGreaterThan(150)
  expect(renderedPixels.bottom - renderedPixels.top, 'the rendered outline must retain the dragged height').toBeGreaterThan(90)
}

test('keeps Whiteboard shortcuts inactive while typing in an embedded editor', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-whiteboard-embed-'))
  const application = await launchApplication(userDataDirectory)

  try {
    const window = await application.firstWindow()
    const noteTitle = 'Embedded editor regression'
    const whiteboardTitle = 'Research board'

    await createWhiteboard(window, noteTitle, whiteboardTitle)
    const insertEditor = window.locator('button[data-whiteboard-action="insert-editor"]')
    await expect(insertEditor).toHaveCount(1)
    await expect(insertEditor.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " App-toolbar ")]')).toHaveCount(1)
    await insertEditor.click()

    await expect(window.locator('.excalidraw__embeddable-container')).toHaveCount(1)
    await expect(window.locator('[data-memorilo-whiteboard-editor]')).toHaveCount(1)
    const editor = window.locator('[data-memorilo-whiteboard-editor]').locator('[data-editor-content]')
    await expect(editor).toBeVisible()
    await editor.focus()
    await expect(window.locator('input[name="editor-current-shape"]:checked')).toHaveCount(1)

    await window.keyboard.type('r')

    await expect(editor).toContainText('r')
    await expect(window.locator('input[name="editor-current-shape"]:checked')).toHaveCount(1)
  }
  finally {
    await application.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})

test('renders a rectangle outline after dragging on a Whiteboard', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-whiteboard-outline-'))
  const application = await launchApplication(userDataDirectory)

  try {
    const window = await application.firstWindow()
    await window.setViewportSize({ height: 700, width: 900 })
    await createWhiteboard(window, 'Visible outline regression', 'Outline board')
    await window.locator('[data-note-inspector-toggle]').click()

    const interactiveCanvas = window.locator('canvas.interactive')
    const canvasBounds = await interactiveCanvas.boundingBox()
    if (!canvasBounds)
      throw new Error('Whiteboard interactive canvas has no layout bounds')

    const start = { x: canvasBounds.x + 240, y: canvasBounds.y + 180 }
    const end = { x: start.x + 180, y: start.y + 120 }
    await window.locator('input[name="editor-current-shape"][aria-keyshortcuts^="R"]').click()
    await expect(window.locator('input[name="editor-current-shape"]:checked')).toHaveCount(1)
    await window.mouse.move(start.x, start.y)
    await window.mouse.down()
    await window.mouse.move(end.x, end.y, { steps: 12 })
    await window.mouse.up()
    await window.keyboard.press('Escape')

    expectRectangleOutline(await renderedDarkPixelBounds(window))

    await expect.poll(() => window.locator('canvas.static').evaluate((canvasElement, rectangle) => {
      const canvas = canvasElement as HTMLCanvasElement
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context)
        throw new Error('Whiteboard static canvas has no 2D context')
      const bounds = canvas.getBoundingClientRect()
      const scaleX = canvas.width / bounds.width
      const scaleY = canvas.height / bounds.height
      const left = Math.round((rectangle.start.x - bounds.left + 20) * scaleX)
      const right = Math.round((rectangle.end.x - bounds.left - 20) * scaleX)
      const top = Math.round((rectangle.start.y - bounds.top) * scaleY)
      const yRadius = Math.max(2, Math.ceil(3 * scaleY))
      const pixels = context.getImageData(left, top - yRadius, right - left, yRadius * 2 + 1).data
      let darkPixelCount = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3]
        const red = pixels[index]
        const green = pixels[index + 1]
        const blue = pixels[index + 2]
        if (alpha === undefined || red === undefined || green === undefined || blue === undefined)
          throw new Error('Whiteboard static canvas returned an incomplete pixel')
        if (alpha > 0 && red < 180 && green < 180 && blue < 180)
          darkPixelCount += 1
      }
      return darkPixelCount
    }, { end, start })).toBeGreaterThan(20)

    await window.locator('[data-note-inspector-toggle]').click()
    await window.getByRole('link', { name: 'Visible outline regression' }).click()
    await window.getByRole('link', { name: 'Outline board' }).click()
    await window.locator('input[name="editor-current-shape"][aria-keyshortcuts^="R"]').waitFor()
    await expect.poll(async () => {
      const pixels = await renderedDarkPixelBounds(window)
      return pixels.count > 100
        && pixels.right - pixels.left > 150
        && pixels.bottom - pixels.top > 90
    }).toBe(true)
  }
  finally {
    await application.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
