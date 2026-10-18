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

const navigationFeed = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Navigation only</title>
    <entry>
      <title>Newest Books</title>
      <link href="/opds/new" type="application/atom+xml;profile=opds-catalog" />
    </entry>
  </feed>`

const publicationFeed = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Newest Books</title>
    <entry>
      <id>urn:book:newest</id>
      <title>A Book From Navigation</title>
      <author><name>Example Author</name></author>
      <link rel="http://opds-spec.org/acquisition" href="/books/newest.epub" type="application/epub+zip" />
    </entry>
  </feed>`

test('All Sources preserves navigation-only OPDS catalogs', async () => {
  const server = createServer((request, response) => {
    const body = request.url === '/opds/new' ? publicationFeed : navigationFeed
    response.writeHead(200, { 'content-type': 'application/atom+xml;profile=opds-catalog' })
    response.end(body)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new TypeError('Local OPDS server did not expose a TCP port')

  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-shelf-navigation-'))
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

      await expect(window.locator('h3').filter({ hasText: 'A Book From Navigation' })).toBeVisible()
      await expect(window.locator('nav')).toHaveCount(0)
      await window.locator('[data-ui="shelf-source-trigger"]').click()
      await window.locator('[data-shelf-source-value="__all_sources__"]').click()

      const sourcePreview = window.locator('[data-shelf-source-preview]')
      await expect(sourcePreview.locator('h2')).toHaveText('Navigation only')
      await expect(sourcePreview.locator('article h3')).toHaveText('A Book From Navigation')
      await expect(window.getByRole('menu')).toBeHidden()
      await sourcePreview.locator('button[data-shelf-action="open-source"]').click()
      await expect(window.locator('button[aria-haspopup="menu"]')).toContainText('Navigation only')
      await expect(window.locator('h3').filter({ hasText: 'A Book From Navigation' })).toBeVisible()
    }
    finally {
      await electronApplication.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
    server.close()
  }
})
