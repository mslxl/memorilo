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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

const cover = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function publicationEntry(index: number): string {
  const title = `Book ${index}: A Complete Placeholder Title`
  const images = index === 3
    ? ''
    : `
      <link rel="http://opds-spec.org/image" href="/covers/full/${index}" type="image/png" />
      <link rel="http://opds-spec.org/image/thumbnail" href="/covers/thumbnail/${index}" type="image/png" />`
  return `
    <entry>
      <id>urn:book:${index}</id>
      <title>${title}</title>${images}
      <link rel="http://opds-spec.org/acquisition" href="/books/${index}.epub" type="application/epub+zip" />
    </entry>`
}

const publicationFeed = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Cover Test Books</title>
    ${Array.from({ length: 20 }, (_, index) => publicationEntry(index + 1)).join('')}
  </feed>`

test('Shelf loads nearby thumbnails with bounded concurrency and distinct cover states', async () => {
  let activeCoverRequests = 0
  let maximumActiveCoverRequests = 0
  let releaseFirstCover: (() => void) | undefined
  const firstCoverGate = new Promise<void>((resolveGate) => {
    releaseFirstCover = resolveGate
  })
  const requestedCoverPaths: string[] = []

  const server = createServer(async (request, response) => {
    const requestUrl = request.url
    if (!requestUrl)
      throw new TypeError('Shelf cover test request is missing a URL')
    if (requestUrl === '/opds') {
      response.writeHead(200, { 'content-type': 'application/atom+xml;profile=opds-catalog' })
      response.end(publicationFeed)
      return
    }
    if (!requestUrl.startsWith('/covers/')) {
      response.writeHead(404)
      response.end()
      return
    }

    requestedCoverPaths.push(requestUrl)
    activeCoverRequests += 1
    maximumActiveCoverRequests = Math.max(maximumActiveCoverRequests, activeCoverRequests)
    if (requestUrl === '/covers/thumbnail/1')
      await firstCoverGate
    else
      await new Promise(resolveDelay => setTimeout(resolveDelay, 120))

    activeCoverRequests -= 1
    if (requestUrl === '/covers/thumbnail/2') {
      response.writeHead(503, { 'content-type': 'text/plain' })
      response.end('Cover unavailable')
      return
    }
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(cover)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new TypeError('Local OPDS server did not expose a TCP port')

  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-shelf-covers-'))
  try {
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
      await window.setViewportSize({ height: 900, width: 1440 })
      await window.locator('a[href*="/shelf"]').click()
      await window.locator('[data-shelf-action="add-source"]').click()
      await window.locator('[data-shelf-field="url"]').fill(`http://127.0.0.1:${address.port}/opds`)
      await window.locator('[data-shelf-action="submit-source"]').click()

      const firstTitle = 'Book 1: A Complete Placeholder Title'
      const firstBook = window.locator('article').filter({ has: window.getByRole('heading', { name: firstTitle }) })
      const firstBookCover = firstBook.locator('[data-cover-state]')
      await expect(firstBookCover).toHaveAttribute('data-cover-state', 'loading')
      await expect(firstBookCover).toContainText(firstTitle)

      const missingTitle = 'Book 3: A Complete Placeholder Title'
      const missingCover = window.locator('article').filter({ has: window.getByRole('heading', { name: missingTitle }) }).locator('[data-cover-state]')
      await expect(missingCover).toHaveAttribute('data-cover-state', 'missing')
      await expect(missingCover).toContainText(missingTitle)

      await expect.poll(() => requestedCoverPaths.length).toBeGreaterThanOrEqual(3)
      expect(maximumActiveCoverRequests).toBeLessThanOrEqual(3)
      expect(requestedCoverPaths.some(path => path.includes('/full/'))).toBe(false)
      expect(requestedCoverPaths).not.toContain('/covers/thumbnail/20')

      releaseFirstCover?.()
      await expect(firstBookCover).toHaveAttribute('data-cover-state', 'loaded')
      await expect(firstBookCover.locator('img')).toHaveCount(1)

      const failedTitle = 'Book 2: A Complete Placeholder Title'
      const failedCover = window.locator('article').filter({ has: window.getByRole('heading', { name: failedTitle }) }).locator('[data-cover-state]')
      await expect(failedCover).toHaveAttribute('data-cover-state', 'error')
      await expect(failedCover).toContainText(failedTitle)
      await expect(failedCover).toContainText('Cover unavailable')

      const collection = window.locator('[data-shelf-collection]')
      await collection.evaluate(element => element.scrollTo({ top: 1200 }))
      await expect(window.locator('h3').filter({ hasText: 'Book 20: A Complete Placeholder Title' })).toBeVisible()
      await expect.poll(() => requestedCoverPaths).toContain('/covers/thumbnail/20')
    }
    finally {
      releaseFirstCover?.()
      await electronApplication.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
    server.close()
  }
})
