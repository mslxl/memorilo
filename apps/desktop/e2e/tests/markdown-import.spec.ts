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
  await window.getByRole('link', { name: 'Journals' }).waitFor()
  await window.keyboard.press('Meta+P')
  await window.getByRole('combobox', { name: 'Search commands and Notes' }).fill(title)
  await window.getByRole('option').filter({ hasText: `Create Note “${title}”` }).click()
  await expect(window.getByRole('textbox', { name: 'Editor content' })).toBeVisible()
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
      await window.getByRole('link', { name: 'Pages' }).click()
      await expect(window.getByRole('main', { name: 'Pages' })).toBeVisible()
      await selectMarkdownFile(application, markdownPath)
      await window.getByRole('button', { name: 'Import…' }).click()

      const dialog = window.getByRole('dialog', { name: 'Import Markdown' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: 'Note title' })).toHaveValue('Markdown import E2E')
      await expect(dialog.getByRole('textbox', { name: 'Topic title' })).toHaveValue('Imported Markdown Topic')
      await expect(dialog.locator('select')).toHaveValue('gfm')
      await expect(dialog.getByRole('checkbox')).toBeChecked()
      await expect(dialog.getByRole('status')).toContainText('HTML is not supported')
      await dialog.getByRole('button', { exact: true, name: 'Import' }).click()

      await expect(dialog).toBeHidden()
      const editor = window.getByRole('textbox', { name: 'Editor content' })
      await expect(window.locator('section[aria-label="Markdown import E2E"]')).toBeVisible()
      await expect(editor.locator('h1')).toHaveText('Imported Markdown Topic')
      await expect(editor.locator('strong')).toHaveText('bold')
      await expect(editor.locator('em')).toHaveText('italic')
      await expect(editor.locator('s')).toHaveText('strike')
      await expect(editor.locator('code')).toHaveText('code')
      await expect(editor.locator('a').filter({ hasText: 'link' })).toHaveAttribute('href', 'https://example.com')
      await expect(editor.locator('table')).toHaveCount(1)
      await expect(editor.getByRole('button', { name: 'Task status: todo' })).toHaveCount(1)
      await expect(editor.getByRole('button', { name: 'Task status: done' })).toHaveCount(1)
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
      await window.getByRole('button', { name: 'Show Note Inspector' }).click()
      await window.getByRole('heading', { name: 'Note Structure' }).click({ button: 'right' })
      await window.getByRole('menuitem', { name: 'Add' }).click()
      await window.getByRole('menuitem', { name: 'Import Markdown' }).click()
      await attachMarkdownFile(window, 'Nested Markdown Topic.md')

      const dialog = window.getByRole('dialog', { name: 'Import Markdown' })
      await expect(dialog.getByRole('textbox', { name: 'Topic title' })).toHaveValue('Imported Markdown Topic')
      await expect(dialog.getByRole('textbox', { name: 'Note title' })).toHaveCount(0)
      await dialog.getByRole('button', { exact: true, name: 'Import' }).click()

      const editor = window.getByRole('textbox', { name: 'Editor content' })
      await expect(editor.locator('h1')).toHaveText('Imported Markdown Topic')
      await expect(window.getByRole('link', { name: 'Imported Markdown Topic' })).toBeVisible()
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
