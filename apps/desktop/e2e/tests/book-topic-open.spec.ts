import type { ElectronApplication, Page } from '@playwright/test'
import type Database from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import BetterSqlite3 from 'better-sqlite3'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

const bookTitle = 'Direct Reader Book'
const noteTitle = 'BookTopic Reading Context'

function twoPagePdf(): Buffer {
  const pageOne = 'BT /F1 24 Tf 72 700 Td (Direct reader context starts) Tj ET'
  const pageTwo = 'BT /F1 24 Tf 72 700 Td (and continues on page two) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${pageOne.length} >>\nstream\n${pageOne}\nendstream`,
    `<< /Length ${pageTwo.length} >>\nstream\n${pageTwo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const offsets = [0]
  let body = '%PDF-1.4\n'
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'ascii'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii')
  const entries = offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n `)
    .join('\n')
  body += `xref\n0 8\n0000000000 65535 f \n${entries}\ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

function readReaderRegionImageOcclusionParents(databasePath: string): readonly {
  childType: string
  parentType: string
}[] {
  const database: Database.Database = new BetterSqlite3(databasePath, { readonly: true })
  try {
    return database.prepare(`
      SELECT
        child_topic.topic_type AS childType,
        parent_topic.topic_type AS parentType
      FROM note_entries AS child_entry
      JOIN topics AS child_topic
        ON child_topic.note_row_id = child_entry.note_row_id
        AND child_topic.topic_id = child_entry.entry_id
      JOIN note_entries AS parent_entry
        ON parent_entry.note_row_id = child_entry.note_row_id
        AND parent_entry.entry_id = child_entry.parent_entry_id
      JOIN topics AS parent_topic
        ON parent_topic.note_row_id = parent_entry.note_row_id
        AND parent_topic.topic_id = parent_entry.entry_id
      WHERE child_topic.topic_type = 'image-occlusion'
    `).all() as { childType: string, parentType: string }[]
  }
  finally {
    database.close()
  }
}

const publicationFeed = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>BookTopic Test Books</title>
    <entry>
      <id>urn:book:direct-reader</id>
      <title>${bookTitle}</title>
      <author><name>Example Author</name></author>
      <link rel="http://opds-spec.org/acquisition" href="/books/direct-reader.pdf" type="application/pdf" />
    </entry>
  </feed>`

function launchApplication(databasePath: string, userDataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MEMORILO_DATABASE_PATH: databasePath,
      MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      MEMORILO_E2E_HIDE_WINDOW: process.env.MEMORILO_E2E_HIDE_WINDOW ?? '1',
      MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
    },
    executablePath: electronExecutablePath,
  })
}

async function readAssetPixel(
  application: ElectronApplication,
  page: Page,
  source: string,
  x: number,
  y: number,
): Promise<number[]> {
  const bytes = await application.evaluate(async ({ net }, assetSource) => {
    const response = await net.fetch(assetSource)
    if (!response.ok)
      throw new Error(`Reader source snapshot request failed with status ${response.status}`)
    return Array.from(new Uint8Array(await response.arrayBuffer()))
  }, source)
  return page.evaluate(async ({ bytes, x, y }) => {
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/png' })
    const sourceUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.src = sourceUrl
    try {
      await image.decode()
      if (x >= image.naturalWidth || y >= image.naturalHeight)
        throw new RangeError(`Reader source snapshot pixel ${x},${y} is outside the image`)
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context)
        throw new Error('Could not inspect Reader source snapshot pixels')
      context.drawImage(image, 0, 0)
      return [...context.getImageData(x, y, 1, 1).data]
    }
    finally {
      URL.revokeObjectURL(sourceUrl)
    }
  }, { bytes, x, y })
}

function expectCleanSourcePixel(pixel: readonly number[]): void {
  expect(pixel).toHaveLength(4)
  expect(pixel[0]).toBeGreaterThanOrEqual(245)
  expect(pixel[1]).toBeGreaterThanOrEqual(245)
  expect(pixel[2]).toBeGreaterThanOrEqual(245)
  expect(pixel[3]).toBe(255)
}

test('persists and reloads a BookTopic annotation and region occlusion', async () => {
  test.setTimeout(120_000)
  const pdf = twoPagePdf()
  const server = createServer((request, response) => {
    if (request.url === '/opds') {
      response.writeHead(200, { 'content-type': 'application/atom+xml;profile=opds-catalog' })
      response.end(publicationFeed)
      return
    }
    if (request.url === '/books/direct-reader.pdf') {
      response.writeHead(200, {
        'content-length': pdf.byteLength,
        'content-type': 'application/pdf',
      })
      response.end(pdf)
      return
    }
    response.writeHead(404)
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new TypeError('Local OPDS server did not expose a TCP port')

  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-book-topic-open-'))
  const databasePath = resolve(userDataDirectory, 'memorilo.sqlite')
  let electronApplication: ElectronApplication | null = null
  try {
    electronApplication = await launchApplication(databasePath, userDataDirectory)
    let window = await electronApplication.firstWindow()
    await window.setViewportSize({ height: 900, width: 1440 })

    await window.locator('a[href*="/shelf"]').click()
    await window.locator('[data-shelf-action="add-source"]').click()
    await window.locator('[data-shelf-field="url"]').fill(`http://127.0.0.1:${address.port}/opds`)
    await window.locator('[data-shelf-action="submit-source"]').click()
    await expect(window.getByRole('heading', { name: bookTitle })).toBeVisible()

    await window.keyboard.press('Meta+P')
    await window.locator('input[role=combobox][aria-autocomplete=list]').fill(noteTitle)
    await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
    await expect(window.locator('[data-note-action="rename-current"]')).toBeVisible()

    await window.locator('[data-note-inspector-toggle]').click()
    const structure = window.locator('[data-note-inspector]')
    const regularTopic = structure.locator(`[data-note-entry-kind="topic"] a[title="${noteTitle}"]`)
    await expect(regularTopic).toBeVisible()
    await regularTopic.click({ button: 'right' })

    const entryMenu = window.getByRole('menu')
    await expect(entryMenu.locator('[data-entry-action="open-book"]')).toHaveCount(0)
    await entryMenu.locator('[role="menuitem"][data-entry-action="add"]').click()
    await window.locator('[role="menuitem"][data-entry-action="add-book"]').click()

    const picker = window.locator('[data-book-topic-picker]')
    await picker.locator('[data-book-option]').filter({ hasText: bookTitle }).click()
    await picker.locator('[data-book-action="submit"]').click()

    const bookTopic = structure.locator(`[data-note-entry-topic-type="book"] a[title="${bookTitle}"]`)
    await expect(bookTopic).toBeVisible()
    await bookTopic.click()

    await expect.poll(() => window.evaluate(() => {
      const [path, searchText = ''] = globalThis.location.hash.slice(1).split('?')
      const search = new URLSearchParams(searchText)
      return {
        noteId: search.get('noteId'),
        path,
        topicId: search.get('topicId'),
      }
    })).toEqual({
      noteId: expect.stringMatching(/\S/u),
      path: expect.stringMatching(/^\/reader\/[a-f0-9]{64}$/u),
      topicId: expect.stringMatching(/\S/u),
    })
    // The first packaged PDF load can initialize PDF.js's worker and range
    // transport lazily; wait for the reader's ready state, not the default
    // five-second assertion window used by ordinary DOM transitions.
    await expect(window.locator('[data-page-number="1"]')).toBeVisible({ timeout: 30_000 })
    await expect(window.locator('.reader-pdf-page-slot')).toHaveCount(2)
    await expect(window.getByRole('heading', { name: `${noteTitle} \u00B7 ${bookTitle}` })).toBeVisible()
    await expect(window.locator('[data-reader-action="select-area"]')).toBeVisible()

    const contextIds = await window.evaluate(() => {
      const [, searchText = ''] = globalThis.location.hash.slice(1).split('?')
      const search = new URLSearchParams(searchText)
      const noteId = search.get('noteId')
      const topicId = search.get('topicId')
      if (!noteId || !topicId)
        throw new Error('Reader route is missing its BookTopic context')
      return { noteId, topicId }
    })
    const readerHash = await window.evaluate(() => globalThis.location.hash)

    await expect.poll(() => window.locator('.reader-pdf-text-layer').count()).toBe(2)
    await window.evaluate(() => {
      const layers = Array.from(document.querySelectorAll<HTMLElement>('.reader-pdf-text-layer'))
      const firstLayer = layers[0]
      const secondLayer = layers[1]
      if (!firstLayer || !secondLayer)
        throw new Error('Cross-page selection requires two PDF text layers')
      const firstWalker = document.createTreeWalker(firstLayer, NodeFilter.SHOW_TEXT)
      const secondWalker = document.createTreeWalker(secondLayer, NodeFilter.SHOW_TEXT)
      const firstText = firstWalker.nextNode()
      const secondText = secondWalker.nextNode()
      if (!(firstText instanceof Text) || !(secondText instanceof Text))
        throw new Error('Cross-page selection requires text nodes in both PDF pages')
      const range = document.createRange()
      range.setStart(firstText, 0)
      range.setEnd(secondText, secondText.data.length)
      const selection = document.getSelection()
      if (!selection)
        throw new Error('Cross-page selection requires a document selection')
      selection.removeAllRanges()
      selection.addRange(range)
      secondLayer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    const selectionToolbar = window.locator('[data-reader-toolbar="selection"]')
    await expect(selectionToolbar).toBeVisible()
    await selectionToolbar.locator('[data-reader-action="highlight-selection"]').click()
    await expect.poll(() => window.locator('.reader-pdf-annotation').count()).toBe(2)
    await expect.poll(() => window.locator('.reader-pdf-annotation').evaluateAll((elements) => {
      return new Set(elements.map(element => element.getAttribute('data-annotation-id'))).size
    })).toBe(1)

    await window.locator('[data-reader-action="toggle-sidebar"]').click()
    await window.locator('[data-reader-tab="annotations"]').click()
    const annotationsPanel = window.locator('#reader-annotations-panel')
    const crossPageAnnotation = annotationsPanel.locator('[data-reader-annotation-kind="text"]').first()
    await expect(crossPageAnnotation).toBeVisible()
    await expect(crossPageAnnotation).toContainText('Direct reader context starts')
    await expect(crossPageAnnotation).toContainText('and continues on page two')

    await window.locator('[data-reader-action="select-area"]').click()
    const page = window.locator('.reader-pdf-page').first()
    const pageBox = await page.boundingBox()
    if (!pageBox)
      throw new Error('PDF page is not visible')
    await window.mouse.move(pageBox.x + 80, pageBox.y + 90)
    await window.mouse.down()
    await window.mouse.move(pageBox.x + 240, pageBox.y + 160, { steps: 5 })
    await window.mouse.up()
    await window.locator('[data-reader-action="highlight-area"]').click()

    const highlightedArea = window.locator('button[data-reader-annotation-id]').last()
    await expect(highlightedArea).toBeVisible()
    await window.locator('[data-reader-tab="annotations"]').click()
    const regionAnnotation = annotationsPanel.locator('[data-reader-annotation-kind="region"]').first()
    await expect(regionAnnotation).toBeVisible()
    const regionPreview = regionAnnotation.locator('[data-reader-region-preview]')
    await expect(regionPreview).toBeVisible()
    await regionPreview.click()
    const highlightActions = window.locator('[data-reader-toolbar="annotation"]')
    await expect(highlightActions).toBeVisible()
    await highlightActions.locator('[data-reader-action="choose-color"]').click()
    await highlightActions.locator('[data-reader-action="select-color"][data-reader-color="blue"]').click()

    await highlightActions.locator('[data-reader-action="open-image-occlusion"]').click()
    await expect(window.locator('[data-topic-type="image-occlusion"]')).toBeVisible()
    await expect.poll(() => readReaderRegionImageOcclusionParents(databasePath)).toEqual([{
      childType: 'image-occlusion',
      parentType: 'book',
    }])

    await window.evaluate((hash) => {
      globalThis.location.hash = hash
    }, readerHash)
    const restoredArea = window.locator('button[data-reader-annotation-id]').last()
    await expect(restoredArea).toBeVisible({ timeout: 30_000 })
    await window.locator('[data-reader-action="toggle-sidebar"]').click()
    await window.locator('[data-reader-tab="annotations"]').click()
    const restoredAnnotationsPanel = window.locator('#reader-annotations-panel')
    const restoredRegionAnnotation = restoredAnnotationsPanel.locator('[data-reader-annotation-kind="region"]').first()
    await expect(restoredRegionAnnotation.locator('[data-reader-annotation-status="image-occlusion"]')).toBeVisible()
    const restoredRegionImage = restoredRegionAnnotation.locator('[data-reader-region-preview] img')
    await expect.poll(() => restoredRegionImage.evaluate((image) => {
      if (!(image instanceof HTMLImageElement))
        throw new TypeError('Reader annotation region preview is not an image')
      return image.naturalWidth
    })).toBeGreaterThan(0)
    await restoredRegionAnnotation.locator('[data-reader-annotation-status="image-occlusion"]').click()
    const restoredActions = window.locator('[data-reader-toolbar="annotation"]')
    await expect(restoredActions).toBeVisible()
    await restoredActions.locator('[data-reader-action="add-annotation"]').click()

    const annotationEditor = window.locator('[data-editor-content]').last()
    await expect(annotationEditor).toBeVisible()
    await annotationEditor.click()
    await window.keyboard.type('Margin annotation')
    await expect(annotationEditor).toContainText('Margin annotation')

    const windowClosed = window.waitForEvent('close')
    await electronApplication.evaluate(({ BrowserWindow }) => {
      const [nativeWindow] = BrowserWindow.getAllWindows()
      if (!nativeWindow)
        throw new Error('Reader persistence test has no native window to close')
      nativeWindow.close()
    })
    await windowClosed
    await electronApplication.close()
    electronApplication = null

    electronApplication = await launchApplication(databasePath, userDataDirectory)
    window = await electronApplication.firstWindow()
    await window.setViewportSize({ height: 900, width: 1440 })
    await window.locator('a[href*="/journals"]').waitFor()
    await window.evaluate(({ noteId, topicId }) => {
      globalThis.location.hash = `/note/${encodeURIComponent(noteId)}/${encodeURIComponent(topicId)}`
    }, contextIds)
    const structureAfterAnnotation = window.locator('[data-note-inspector]')
    const persistedImageOcclusionTopic = structureAfterAnnotation.locator('[data-note-entry-topic-type="image-occlusion"] a')
    await expect(persistedImageOcclusionTopic).toBeVisible()
    await persistedImageOcclusionTopic.click()
    await expect(window.locator('[data-topic-type="image-occlusion"]')).toBeVisible()
    const imageOcclusionSource = window.locator('[data-reader-source-link]')
    await expect(imageOcclusionSource).toBeVisible()
    const imageOcclusionSourceImage = imageOcclusionSource.getByRole('img')
    await expect(imageOcclusionSourceImage).toBeVisible()
    const imageOcclusionSourceUrl = await imageOcclusionSourceImage.getAttribute('src')
    if (!imageOcclusionSourceUrl)
      throw new Error('Reader image occlusion source did not expose an asset URL')
    expectCleanSourcePixel(await readAssetPixel(electronApplication, window, imageOcclusionSourceUrl, 2, 2))
    await imageOcclusionSource.click()
    await expect.poll(() => window.evaluate(() => {
      const [, searchText = ''] = globalThis.location.hash.slice(1).split('?')
      const search = new URLSearchParams(searchText)
      return {
        annotationId: search.get('annotationId'),
        noteId: search.get('noteId'),
        topicId: search.get('topicId'),
      }
    })).toEqual({
      annotationId: expect.stringMatching(/\S/u),
      noteId: contextIds.noteId,
      topicId: contextIds.topicId,
    })

    await window.evaluate(({ noteId, topicId }) => {
      globalThis.location.hash = `/note/${encodeURIComponent(noteId)}/${encodeURIComponent(topicId)}`
    }, contextIds)
    await expect.poll(() => readReaderRegionImageOcclusionParents(databasePath)).toEqual([{
      childType: 'image-occlusion',
      parentType: 'book',
    }])

    const annotationTopic = structureAfterAnnotation.locator('[data-note-entry-topic-type="regular"] a').last()
    await expect(annotationTopic).toBeVisible()
    await annotationTopic.click()
    await expect(window.locator('[data-reader-source-link]')).toBeVisible()
    const annotationSourceImage = window.locator('[data-reader-source-link] img')
    await expect(annotationSourceImage).toBeVisible()
    const annotationSourceUrl = await annotationSourceImage.getAttribute('src')
    if (!annotationSourceUrl)
      throw new Error('Reader source snapshot did not expose an asset URL')
    expectCleanSourcePixel(await readAssetPixel(electronApplication, window, annotationSourceUrl, 2, 2))
    await expect(window.getByText('Margin annotation')).toBeVisible()

    await window.locator('[data-reader-source-link]').click()
    await expect.poll(() => window.evaluate(() => {
      const [, searchText = ''] = globalThis.location.hash.slice(1).split('?')
      const search = new URLSearchParams(searchText)
      return {
        annotationId: search.get('annotationId'),
        noteId: search.get('noteId'),
        topicId: search.get('topicId'),
      }
    })).toEqual({
      annotationId: expect.stringMatching(/\S/u),
      noteId: contextIds.noteId,
      topicId: contextIds.topicId,
    })
    await expect(window.locator('[data-reader-toolbar="annotation"]')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('Margin annotation')).toBeVisible()
    await window.locator('[data-reader-tab="annotations"]').click()
    const restoredCrossPageAnnotation = window.locator('#reader-annotations-panel [data-reader-annotation-kind="text"]').first()
    await expect(restoredCrossPageAnnotation).toContainText('Direct reader context starts')
    await expect(restoredCrossPageAnnotation).toContainText('and continues on page two')
    await expect.poll(() => window.locator('.reader-pdf-annotation').count()).toBe(3)
    const restoredHighlight = window.locator('button[data-reader-annotation-id]').last()
    await expect(restoredHighlight).toHaveAttribute('data-style', 'highlight')
    const restoredHighlightActions = window.locator('[data-reader-toolbar="annotation"]')
    await expect(restoredHighlightActions.locator('[data-reader-action="add-annotation"]')).toHaveCount(0)
    await restoredHighlightActions.locator('[data-reader-action="choose-color"]').click()
    const restoredBlue = restoredHighlightActions.locator('[data-reader-action="select-color"][data-reader-color="blue"]')
    await expect(restoredBlue).toHaveAttribute('aria-pressed', 'true')
    await restoredBlue.click()

    await restoredHighlightActions
      .locator('[data-reader-action="delete-highlight"]')
      .click()
    const deleteDialog = window.getByRole('dialog')
    await expect(deleteDialog.getByRole('button')).toHaveCount(2)
    const cancelDelete = deleteDialog.locator('[data-reader-dialog-action="cancel"]')
    const deleteHighlight = deleteDialog.locator('[data-reader-dialog-action="delete"]')
    await expect(cancelDelete).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(deleteHighlight).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(cancelDelete).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(deleteDialog).toHaveCount(0)
    await expect(window.locator('button[data-reader-annotation-id]').last()).toBeVisible()

    await restoredHighlightActions.locator('[data-reader-action="delete-highlight"]').click()
    await expect(deleteDialog).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(deleteDialog).toHaveCount(0)
    await expect(window.locator('button[data-reader-annotation-id]').last()).toBeVisible()

    await restoredHighlightActions.locator('[data-reader-action="delete-highlight"]').click()
    await expect(window.getByRole('dialog')).toBeVisible()
    await deleteHighlight.click()
    await expect(window.locator('.reader-pdf-annotation')).toHaveCount(2)

    await window.evaluate(({ noteId, topicId }) => {
      globalThis.location.hash = `/note/${encodeURIComponent(noteId)}/${encodeURIComponent(topicId)}`
    }, contextIds)
    const retainedAnnotationTopic = window.locator('[data-note-inspector] [data-note-entry-topic-type="regular"] a').last()
    await expect(retainedAnnotationTopic).toBeVisible()
    await retainedAnnotationTopic.click()
    await expect(window.locator('[data-reader-source-link]')).toHaveCount(0)
    await expect(window.locator('[data-topic-type="regular"] img')).toBeVisible()
    await expect(window.getByText('Margin annotation')).toBeVisible()
    await expect(window.locator('[data-note-inspector] [data-note-entry-topic-type="image-occlusion"] a')).toBeVisible()
    await expect.poll(() => readReaderRegionImageOcclusionParents(databasePath)).toEqual([{
      childType: 'image-occlusion',
      parentType: 'book',
    }])
  }
  finally {
    await electronApplication?.close()
    await rm(userDataDirectory, { force: true, recursive: true })
    server.close()
  }
})
