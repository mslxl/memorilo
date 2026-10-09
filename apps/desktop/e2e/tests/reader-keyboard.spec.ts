import { Buffer } from 'node:buffer'
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

function twoPagePdf(): Buffer {
  const pageOne = 'BT /F1 24 Tf 72 900 Td (Page One) Tj ET'
  const pageTwo = 'BT /F1 24 Tf 72 900 Td (Page Two) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1000] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1000] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
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

test('arrow keys scroll before turning PDF pages at viewport boundaries', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-reader-keyboard-'))
  const electronApplication = await electron.launch({
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MEMORILO_DATABASE_PATH: ':memory:',
      MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
    },
    executablePath: electronExecutablePath,
  })
  try {
    const window = await electronApplication.firstWindow()
    await window.setViewportSize({ height: 720, width: 1280 })
    await window.evaluate(() => {
      location.hash = '/reader'
    })
    await window.getByLabel('Open PDF or EPUB').setInputFiles({
      buffer: twoPagePdf(),
      mimeType: 'application/pdf',
      name: 'keyboard-navigation.pdf',
    })
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()
    await expect(window.locator('.reader-pdf-page-slot')).toHaveCount(2)

    const scroller = window.locator('[data-ui="reader-pdf-scroller"]')
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect.poll(() => window.evaluate(() => document.activeElement?.tagName)).toBe('BODY')

    await window.keyboard.press('ArrowDown')

    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()

    await window.keyboard.down('ArrowDown')
    for (let index = 0; index < 60; index += 1)
      await window.keyboard.down('ArrowDown')
    await expect.poll(() => scroller.evaluate(element => Math.abs(
      element.scrollHeight - element.clientHeight - element.scrollTop,
    ))).toBeLessThanOrEqual(1)
    await window.keyboard.up('ArrowDown')

    await window.keyboard.press('ArrowDown')
    await expect.poll(() => scroller.evaluate(element => Math.abs(
      element.scrollHeight - element.clientHeight - element.scrollTop,
    ))).toBeLessThanOrEqual(1)

    await window.keyboard.down('ArrowUp')
    for (let index = 0; index < 60; index += 1)
      await window.keyboard.down('ArrowUp')
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()
    await window.keyboard.up('ArrowUp')

    await window.keyboard.press('ArrowUp')
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()

    await window.keyboard.press('ArrowRight')
    await expect(window.getByText('2 of 2', { exact: true })).toBeVisible()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await window.keyboard.press('ArrowLeft')
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await window.keyboard.down('ArrowUp')
    for (let index = 0; index < 60; index += 1)
      await window.keyboard.down('ArrowUp')
    await window.keyboard.up('ArrowUp')
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)

    const beforePageDown = await scroller.evaluate(element => element.scrollTop)
    await window.keyboard.press('PageDown')
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(beforePageDown)
    const afterPageDown = await scroller.evaluate(element => element.scrollTop)
    await window.keyboard.press('PageUp')
    await expect(window.getByText('1 of 2', { exact: true })).toBeVisible()
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(afterPageDown)

    await window.keyboard.press('ArrowRight')
    await expect(window.getByText('2 of 2', { exact: true })).toBeVisible()
    await window.keyboard.press('ArrowDown')
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await window.evaluate(async () => {
      const response = await fetch('memorilo://api/configuration/value', {
        body: JSON.stringify({ path: 'readerPageMode', value: 'single-page' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
      if (!response.ok)
        throw new Error(`Failed to update reader page mode: ${response.status}`)
    })
    await expect(window.getByText('2 of 2', { exact: true })).toBeVisible()
    await expect.poll(() => window.locator('.reader-pdf-page-slot').count()).toBe(0)

    await window.evaluate(async () => {
      const response = await fetch('memorilo://api/configuration/value', {
        body: JSON.stringify({ path: 'readerPageMode', value: 'continuous' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
      if (!response.ok)
        throw new Error(`Failed to update reader page mode: ${response.status}`)
    })
    await expect(window.getByText('2 of 2', { exact: true })).toBeVisible()
    await expect.poll(() => window.locator('.reader-pdf-page-slot').count()).toBe(2)
  }
  finally {
    await electronApplication.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
