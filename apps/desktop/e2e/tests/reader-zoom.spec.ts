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

function solidPagePdf(): Buffer {
  const content = 'q 0.9 g 0 0 612 1000 re f Q BT /F1 24 Tf 72 900 Td (Zoom continuity) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1000] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
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
  body += `xref\n0 6\n0000000000 65535 f \n${entries}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

async function expectPdfToRemainVisible(direction: 'in' | 'out') {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-reader-zoom-'))
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
    await window.evaluate(() => {
      location.hash = '/reader'
    })
    await window.locator('[data-reader-file-input]').setInputFiles({
      buffer: solidPagePdf(),
      mimeType: 'application/pdf',
      name: 'zoom-continuity.pdf',
    })

    const canvas = window.locator('.reader-pdf-canvas')
    await expect(canvas).toBeVisible()
    await expect.poll(() => canvas.evaluate((element) => {
      const current = element as HTMLCanvasElement
      const context = current.getContext('2d')
      if (!context)
        throw new Error('PDF canvas does not have a 2D context')
      return context.getImageData(Math.floor(current.width / 2), Math.floor(current.height / 2), 1, 1).data[3]
    })).toBe(255)

    const zoomButton = window.locator(`[data-reader-action="scale-${direction}"]`)
    await expect(zoomButton).toBeEnabled()
    await window.evaluate((controlDirection) => {
      const surfaceElement = document.querySelector<HTMLElement>('.reader-pdf-page')
      if (!surfaceElement)
        throw new Error('PDF page surface is not available')
      const pageSurface = surfaceElement
      const initialCanvas = pageSurface.querySelector<HTMLCanvasElement>('.reader-pdf-canvas')
      if (!initialCanvas)
        throw new Error('PDF page surface is not available')
      const control = document.querySelector<HTMLButtonElement>(
        `[data-reader-action="scale-${controlDirection}"]`,
      )
      if (!control || control.disabled)
        throw new Error(`PDF scale-${controlDirection} control is not available`)

      const continuity = new Promise<{ blankSamples: number, sawResize: boolean, samples: number }>((resolvePromise, reject) => {
        let animationFrame = 0
        let blankSamples = 0
        let clicked = false
        let framesAfterResize = 0
        let initialWidth = 0
        let samples = 0
        let sawResize = false
        let observer: MutationObserver
        let timeout: ReturnType<typeof globalThis.setTimeout> | undefined

        function finish(error?: Error) {
          observer.disconnect()
          globalThis.cancelAnimationFrame(animationFrame)
          if (timeout !== undefined)
            globalThis.clearTimeout(timeout)
          if (error)
            reject(error)
          else
            resolvePromise({ blankSamples, samples, sawResize })
        }

        function sample() {
          if (!clicked)
            return
          const currentCanvas = pageSurface.querySelector<HTMLCanvasElement>('.reader-pdf-canvas')
          if (!currentCanvas) {
            blankSamples += 1
            samples += 1
            return
          }
          const context = currentCanvas.getContext('2d')
          if (!context) {
            finish(new Error('PDF canvas lost its 2D context while zooming'))
            return
          }
          const alpha = context.getImageData(
            Math.floor(currentCanvas.width / 2),
            Math.floor(currentCanvas.height / 2),
            1,
            1,
          ).data[3]
          samples += 1
          if (alpha === 0)
            blankSamples += 1
          if (currentCanvas.width !== initialWidth)
            sawResize = true
        }

        observer = new MutationObserver(() => sample())
        control.addEventListener('click', () => {
          const currentCanvas = pageSurface.querySelector<HTMLCanvasElement>('.reader-pdf-canvas')
          if (!currentCanvas) {
            finish(new Error('PDF canvas was not available when zooming began'))
            return
          }
          initialWidth = currentCanvas.width
          clicked = true
          timeout = globalThis.setTimeout(() => finish(new Error('PDF canvas did not finish zooming')), 3_000)
        }, { once: true })

        const sampleFrame = () => {
          sample()
          if (sawResize)
            framesAfterResize += 1
          if (sawResize && framesAfterResize >= 2) {
            finish()
            return
          }
          animationFrame = globalThis.requestAnimationFrame(sampleFrame)
        }

        observer.observe(pageSurface, {
          attributeFilter: ['height', 'style', 'width'],
          attributes: true,
          childList: true,
          subtree: true,
        })
        animationFrame = globalThis.requestAnimationFrame(sampleFrame)
      })
      const testWindow = globalThis as typeof globalThis & {
        __memoriloReaderZoomContinuity?: typeof continuity
      }
      testWindow.__memoriloReaderZoomContinuity = continuity
    }, direction)
    await zoomButton.click()
    const result = await window.evaluate(async () => {
      const testWindow = globalThis as typeof globalThis & {
        __memoriloReaderZoomContinuity?: Promise<{
          blankSamples: number
          samples: number
          sawResize: boolean
        }>
      }
      const continuity = testWindow.__memoriloReaderZoomContinuity
      if (!continuity)
        throw new Error('PDF zoom observer is not available')
      try {
        return await continuity
      }
      finally {
        delete testWindow.__memoriloReaderZoomContinuity
      }
    })
    expect(result.sawResize).toBe(true)
    expect(result.samples).toBeGreaterThan(0)
    expect(result.blankSamples).toBe(0)
  }
  finally {
    await electronApplication.close()
    await rm(userDataDirectory, { force: true, recursive: true })
  }
}

test('keeps the rendered PDF visible while zooming in', async () => {
  await expectPdfToRemainVisible('in')
})

test('keeps the rendered PDF visible while zooming out', async () => {
  await expectPdfToRemainVisible('out')
})
