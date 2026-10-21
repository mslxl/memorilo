import type { ElectronApplication } from '@playwright/test'
import type Database from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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

const imageContents = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

interface StoredAssetRow {
  byte_size: number
  deletion_claimed_at: number | null
  file_name: string
  mime_type: string
  original_file_name: string
  reference_count: number
  unreferenced_at: number | null
}

function readStoredAssets(databasePath: string): readonly StoredAssetRow[] {
  const database: Database.Database = new BetterSqlite3(databasePath, { readonly: true })
  try {
    return database.prepare(`
      SELECT
        assets.file_name,
        assets.original_file_name,
        assets.mime_type,
        assets.byte_size,
        assets.unreferenced_at,
        assets.deletion_claimed_at,
        COALESCE(SUM(note_asset_references.reference_count), 0) AS reference_count
      FROM assets
      LEFT JOIN note_asset_references
        ON note_asset_references.asset_file_name = assets.file_name
      GROUP BY assets.file_name
    `).all() as StoredAssetRow[]
  }
  finally {
    database.close()
  }
}

function readBoundImageOcclusionTopicCount(databasePath: string): number {
  const database: Database.Database = new BetterSqlite3(databasePath, { readonly: true })
  try {
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM topics AS occlusion
      JOIN note_entries AS child
        ON child.note_row_id = occlusion.note_row_id
        AND child.entry_id = occlusion.topic_id
      JOIN topics AS source
        ON source.note_row_id = child.note_row_id
        AND source.topic_id = child.parent_entry_id
      WHERE occlusion.topic_type = 'image-occlusion'
        AND source.topic_type = 'regular'
    `).get() as { count: number }
    return row.count
  }
  finally {
    database.close()
  }
}

function launchApplication(databasePath: string, userDataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MEMORILO_DATABASE_PATH: databasePath,
      MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      MEMORILO_E2E_HIDE_WINDOW: process.env.MEMORILO_E2E_HIDE_WINDOW ?? '1',
    },
    executablePath: electronExecutablePath,
  })
}

test('persists an uploaded image beside the database and renders it after restart', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'memorilo-image-asset-'))
  const databasePath = resolve(directory, 'memorilo.sqlite')
  const userDataDirectory = resolve(directory, 'user-data')
  const assetDirectory = resolve(directory, 'assets')
  const title = 'Persistent image asset 7f2c91'
  let application: ElectronApplication | null = null

  try {
    application = await launchApplication(databasePath, userDataDirectory)
    let window = await application.firstWindow()

    await window.locator('a[href*="/journals"]').waitFor()
    await window.keyboard.press('Meta+P')
    await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
    await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

    const editor = window.locator('[data-editor-content]')
    await expect(editor.locator('[data-block-id]').first()).toBeVisible()
    await editor.click({ button: 'right' })
    await window.locator('[role="menuitem"][data-editor-action="insert-image"]').click()

    const imageDialog = window.locator('[data-image-dialog]')
    await imageDialog.locator('[data-image-field="file"]').setInputFiles({
      buffer: imageContents,
      mimeType: 'image/png',
      name: 'sample-image.png',
    })
    await imageDialog.locator('[data-image-action="upload"]').click()

    const image = editor.locator('[data-editor-image]')
    await expect(image).toHaveAttribute('src', /^memorilo:\/\/asset\/[0-9a-f-]+\.png$/)
    const assetUrl = await image.getAttribute('src')
    if (!assetUrl)
      throw new Error('Uploaded image did not receive an asset URL')
    const imageRequest = await application.evaluate(async ({ net }, src) => {
      const response = await net.fetch(src)
      return {
        body: Array.from(new Uint8Array(await response.arrayBuffer())),
        contentType: response.headers.get('content-type'),
        status: response.status,
      }
    }, assetUrl)
    expect(imageRequest).toEqual({
      body: Array.from(imageContents),
      contentType: 'image/png',
      status: 200,
    })
    await expect.poll(() => image.evaluate(element => ({
      complete: (element as HTMLImageElement).complete,
      naturalHeight: (element as HTMLImageElement).naturalHeight,
      naturalWidth: (element as HTMLImageElement).naturalWidth,
    }))).toEqual({ complete: true, naturalHeight: 1, naturalWidth: 1 })

    const assetFileName = new URL(assetUrl).pathname.slice(1)
    const noteHash = await window.evaluate(() => globalThis.location.hash)

    await expect.poll(async () => readStoredAssets(databasePath)).toEqual([{
      byte_size: imageContents.byteLength,
      deletion_claimed_at: null,
      file_name: assetFileName,
      mime_type: 'image/png',
      original_file_name: 'sample-image.png',
      reference_count: 1,
      unreferenced_at: null,
    }])
    await expect.poll(() => readdir(assetDirectory)).toEqual([assetFileName])
    await expect.poll(() => readFile(resolve(assetDirectory, assetFileName))).toEqual(imageContents)

    await application.close()
    application = null

    application = await launchApplication(databasePath, userDataDirectory)
    window = await application.firstWindow()
    await window.locator('a[href*="/journals"]').waitFor()
    await window.evaluate((hash) => {
      globalThis.location.hash = hash
    }, noteHash)

    const reopenedEditor = window.locator('[data-editor-content]')
    const reopenedImage = reopenedEditor.locator('[data-editor-image]')
    await expect(reopenedImage).toHaveAttribute('src', assetUrl)
    await expect.poll(() => reopenedImage.evaluate(element => ({
      complete: (element as HTMLImageElement).complete,
      naturalHeight: (element as HTMLImageElement).naturalHeight,
      naturalWidth: (element as HTMLImageElement).naturalWidth,
    }))).toEqual({ complete: true, naturalHeight: 1, naturalWidth: 1 })
    expect(readStoredAssets(databasePath)).toEqual([{
      byte_size: imageContents.byteLength,
      deletion_claimed_at: null,
      file_name: assetFileName,
      mime_type: 'image/png',
      original_file_name: 'sample-image.png',
      reference_count: 1,
      unreferenced_at: null,
    }])

    let openImageOcclusion = window.locator('[data-image-action="open-occlusion"]')
    if (!await openImageOcclusion.isVisible())
      await reopenedImage.click({ force: true })
    await openImageOcclusion.click()
    const occlusionEditor = window.locator('[data-topic-type="image-occlusion"]')
    await expect(occlusionEditor).toBeVisible()
    await expect(occlusionEditor.locator('[data-image-occlusion-field="title"]'))
      .toHaveValue('Image Occlusion')
    const occlusionHash = await window.evaluate(() => globalThis.location.hash)

    await occlusionEditor.locator('[data-image-occlusion-tool="rectangle"]').click()
    const canvas = occlusionEditor.locator('canvas').first()
    const canvasBounds = await canvas.boundingBox()
    if (!canvasBounds)
      throw new Error('Image occlusion canvas did not receive layout bounds')
    await window.mouse.move(
      canvasBounds.x + canvasBounds.width * 0.35,
      canvasBounds.y + canvasBounds.height * 0.35,
    )
    await window.mouse.down()
    await window.mouse.move(
      canvasBounds.x + canvasBounds.width * 0.6,
      canvasBounds.y + canvasBounds.height * 0.6,
    )
    await window.mouse.up()
    await expect(occlusionEditor.locator('[data-image-occlusion-action="delete"]')).toBeEnabled()

    await window.evaluate((hash) => {
      globalThis.location.hash = hash
    }, noteHash)
    const sourceEditor = window.locator('[data-editor-content]')
    const sourceImage = sourceEditor.locator('[data-editor-image]')
    await expect(sourceImage).toBeVisible()
    await expect(sourceEditor.locator('[data-image-occlusion-preview]')).toBeVisible()
    openImageOcclusion = window.locator('[data-image-action="open-occlusion"]')
    if (!await openImageOcclusion.isVisible())
      await sourceImage.click({ force: true })
    await openImageOcclusion.click()
    await expect.poll(() => window.evaluate(() => globalThis.location.hash)).toBe(occlusionHash)
    await expect.poll(() => readBoundImageOcclusionTopicCount(databasePath)).toBe(1)
    await expect.poll(() => readStoredAssets(databasePath)).toEqual([{
      byte_size: imageContents.byteLength,
      deletion_claimed_at: null,
      file_name: assetFileName,
      mime_type: 'image/png',
      original_file_name: 'sample-image.png',
      reference_count: 2,
      unreferenced_at: null,
    }])
  }
  finally {
    await application?.close()
    await rm(directory, { force: true, recursive: true })
  }
})
