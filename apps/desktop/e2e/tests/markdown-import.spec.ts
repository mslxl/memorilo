import type { ElectronApplication, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

function launchApplication(userDataDirectory: string): Promise<ElectronApplication> {
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

const markdownSource = `# Imported Markdown Topic

**bold** *italic* ~~strike~~ \`code\` [link](https://example.com)

- [ ] Open task
- [x] Done task

| Name | Value |
| --- | --- |
| One | 1 |

<div>unsupported</div>
`

async function attachMarkdownFile(window: Page, name: string): Promise<void> {
  const input = window.locator('input[type="file"]')
  await expect(input).toHaveCount(1)
  await input.setInputFiles({
    buffer: Buffer.from(markdownSource),
    mimeType: 'text/markdown',
    name,
  })
}

async function selectMarkdownFile(application: ElectronApplication, filePath: string): Promise<void> {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, filePath)
}

async function createNote(window: Page, title: string): Promise<void> {
  await window.locator('a[href*="/journals"]').waitFor()
  await window.keyboard.press('Meta+P')
  await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
  await expect(window.locator('[data-editor-content]')).toBeVisible()
}

test('imports Markdown as a new Note with GFM content and warnings', async () => {
  test.setTimeout(90_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-markdown-import-note-'))
  try {
    const application = await launchApplication(userDataDirectory)
    try {
      const window = await application.firstWindow()
      const markdownPath = resolve(userDataDirectory, 'Markdown import E2E.md')
      await writeFile(markdownPath, markdownSource)
      await window.locator('a[href*="/pages"]').click()
      await expect(window.locator('main[data-page=pages]')).toBeVisible()
      await selectMarkdownFile(application, markdownPath)
      await window.locator('button[data-note-action="import"]').click()

      const dialog = window.locator('[data-markdown-import-dialog]')
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('[data-markdown-import-field="note-title"]')).toHaveValue('Markdown import E2E')
      await expect(dialog.locator('[data-markdown-import-field="topic-title"]')).toHaveValue('Imported Markdown Topic')
      await expect(dialog.locator('[data-markdown-import-field="flavor"]')).toHaveValue('gfm')
      await expect(dialog.locator('[data-markdown-import-field="map-tasks"]')).toBeChecked()
      await expect(dialog.locator('[data-markdown-import-diagnostics]')).toContainText('HTML is not supported')
      await dialog.locator('[data-markdown-import-action="submit"]').click()

      await expect(dialog).toBeHidden()
      const editor = window.locator('[data-editor-content]')
      await expect(window.locator('section[aria-label="Markdown import E2E"]')).toBeVisible()
      await expect(editor.locator('h1')).toHaveText('Imported Markdown Topic')
      await expect(editor.locator('strong')).toHaveText('bold')
      await expect(editor.locator('em')).toHaveText('italic')
      await expect(editor.locator('s')).toHaveText('strike')
      await expect(editor.locator('code')).toHaveText('code')
      await expect(editor.locator('a').filter({ hasText: 'link' })).toHaveAttribute('href', 'https://example.com')
      await expect(editor.locator('table')).toHaveCount(1)
      await expect(editor.locator('button[data-task-status-control][data-status="todo"]')).toHaveCount(1)
      await expect(editor.locator('button[data-task-status-control][data-status="done"]')).toHaveCount(1)
    }
    finally {
      await application.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})

test('imports Markdown as a Topic from the Note Structure context menu', async () => {
  test.setTimeout(90_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'memorilo-markdown-import-topic-'))
  try {
    const application = await launchApplication(userDataDirectory)
    try {
      const window = await application.firstWindow()
      const noteTitle = 'Markdown context import E2E'
      await createNote(window, noteTitle)
      await window.locator('[data-note-inspector-toggle]').click()
      await window.locator('[data-note-inspector] h1').click({ button: 'right' })
      await window.locator('[role="menuitem"][data-entry-action="add"]').click()
      await window.locator('[role="menuitem"][data-entry-action="import-markdown"]').click()
      await attachMarkdownFile(window, 'Nested Markdown Topic.md')

      const dialog = window.locator('[data-markdown-import-dialog]')
      await expect(dialog.locator('[data-markdown-import-field="topic-title"]')).toHaveValue('Imported Markdown Topic')
      await expect(dialog.locator('[data-markdown-import-field="note-title"]')).toHaveCount(0)
      await dialog.locator('[data-markdown-import-action="submit"]').click()

      const editor = window.locator('[data-editor-content]')
      await expect(editor.locator('h1')).toHaveText('Imported Markdown Topic')
      await expect(window.locator('[data-note-inspector] [data-note-entry-topic-type="regular"] a').filter({ hasText: 'Imported Markdown Topic' })).toBeVisible()
      await expect(window.locator(`section[aria-label="${noteTitle}"]`)).toBeVisible()
    }
    finally {
      await application.close()
    }
  }
  finally {
    await rm(userDataDirectory, { force: true, recursive: true })
  }
})
