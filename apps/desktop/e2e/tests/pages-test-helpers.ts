import type { ElectronApplication } from '@playwright/test'
import type Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from '@playwright/test'
import BetterSqlite3 from 'better-sqlite3'

export interface SeedNote {
  createdAt: number
  id: string
  title: string
  updatedAt: number
}

export interface PagesTestEnvironment {
  databasePath: string
  directory: string
  userDataDirectory: string
}

export interface LaunchPagesTestApplicationOptions {
  now?: number
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

export async function createPagesTestEnvironment(
  prefix: string,
  notes: readonly SeedNote[],
): Promise<PagesTestEnvironment> {
  const directory = await mkdtemp(resolve(tmpdir(), prefix))
  const databasePath = resolve(directory, 'memorilo.sqlite')
  const environment = {
    databasePath,
    directory,
    userDataDirectory: resolve(directory, 'user-data'),
  }
  const bootstrap = await launchPagesTestApplication(environment)
  await bootstrap.firstWindow()
  await bootstrap.close()

  const database: Database.Database = new BetterSqlite3(databasePath)
  try {
    const insert = database.prepare(`
      INSERT INTO notes (
        id,
        title,
        checkpoint_snapshot,
        checkpoint_sequence,
        latest_sequence,
        created_at,
        updated_at
      )
      VALUES (?, ?, NULL, 0, 0, ?, ?)
    `)
    for (const note of notes)
      insert.run(note.id, note.title, note.createdAt, note.updatedAt)
  }
  finally {
    database.close()
  }

  return environment
}

export async function launchPagesTestApplication(
  environment: PagesTestEnvironment,
  options: LaunchPagesTestApplicationOptions = {},
): Promise<ElectronApplication> {
  // Playwright workers can inherit this flag from the Electron package loader; passing it to Electron makes it start as Node.
  const inheritedEnvironment = Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined)
  const environmentVariables: Record<string, string> = {
    ...Object.fromEntries(inheritedEnvironment),
    MEMORILO_DATABASE_PATH: environment.databasePath,
    MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
    MEMORILO_E2E_HIDE_WINDOW: '1',
    MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
  }
  if (options.now === undefined)
    delete environmentVariables.MEMORILO_E2E_NOW_MS
  else
    environmentVariables.MEMORILO_E2E_NOW_MS = String(options.now)

  return electron.launch({
    args: [desktopDirectory, `--user-data-dir=${environment.userDataDirectory}`],
    cwd: repositoryRoot,
    env: environmentVariables,
    executablePath: electronExecutablePath,
  })
}

export async function removePagesTestEnvironment(environment: PagesTestEnvironment): Promise<void> {
  await rm(environment.directory, { force: true, recursive: true })
}
