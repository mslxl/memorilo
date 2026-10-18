import type { DesktopP2pPairedDevice, DesktopP2pStatus } from '@memorilo/desktop-api'
import type { ElectronApplication, Page } from '@playwright/test'
import type Database from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createJournalNote } from '@memorilo/editor/note'
import { _electron as electron, expect, test } from '@playwright/test'
import BetterSqlite3 from 'better-sqlite3'

interface P2pBridge {
  acceptInvitation: (invitation: string) => Promise<string>
  completePairing: (response: string) => Promise<DesktopP2pPairedDevice>
  createInvitation: () => Promise<string>
  getStatus: () => Promise<DesktopP2pStatus>
}

interface P2pRendererWindow extends Window {
  desktop: { p2p: P2pBridge }
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

/* Existing databases are seeded through the public aggregate interface so the fixture tracks the current schema. */
function currentDatabaseNotes() {
  return [
    createCapturedJournal('2026-08-21', '123', 1787250091307, 1787313803066),
    createCapturedJournal('2026-08-22', 'Today', 1787331007597, 1787336610625),
  ]
}

function createCapturedJournal(journalDate: string, text: string, createdAt: number, updatedAt: number) {
  const note = createJournalNote(journalDate)
  const [topic] = note.getEntries()
  if (!topic || topic.kind !== 'topic')
    throw new Error(`Journal ${journalDate} is missing its canonical Topic`)
  const blockId = note.getTopicContent(topic.id).blocks[0]?.id
  if (blockId === undefined)
    throw new Error(`Journal ${journalDate} is missing its canonical Block`)
  note.applyTopicBlockEdits({
    edits: [{
      blockId,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      operation: 'update-block-content',
    }],
    topicId: topic.id,
  })
  return {
    checkpointSequence: 0,
    createdAt,
    id: note.id,
    latestSequence: 0,
    snapshot: note.exportSnapshot(),
    title: journalDate,
    updatedAt,
  }
}

async function seedSourceDatabase(databasePath: string, userDataDirectory: string): Promise<void> {
  const bootstrap = await launchPeer(databasePath, 'Source bootstrap', userDataDirectory)
  await bootstrap.firstWindow()
  await bootstrap.close()

  const database: Database.Database = new BetterSqlite3(databasePath)
  try {
    const insertNote = database.prepare(`
      INSERT INTO notes (
        id, title, kind, checkpoint_snapshot, checkpoint_sequence,
        latest_sequence, created_at, updated_at
      ) VALUES (?, ?, 'journal', ?, ?, ?, ?, ?)
    `)
    const insertJournal = database.prepare(`
      INSERT INTO journals (note_row_id, journal_date, has_user_content)
      VALUES (?, ?, 1)
    `)
    database.transaction(() => {
      for (const note of currentDatabaseNotes()) {
        const inserted = insertNote.run(
          note.id,
          note.title,
          Buffer.from(note.snapshot),
          note.checkpointSequence,
          note.latestSequence,
          note.createdAt,
          note.updatedAt,
        )
        insertJournal.run(inserted.lastInsertRowid, note.title)
      }
    })()
  }
  finally {
    database.close()
  }
}

function launchPeer(databasePath: string, deviceName: string, userDataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MEMORILO_DATABASE_PATH: databasePath,
      MEMORILO_DEVICE_NAME: deviceName,
      MEMORILO_EMBEDDING_MODEL_OFFLINE: '1',
      MEMORILO_E2E_HIDE_WINDOW: '1',
      MEMORILO_SHELF_IMAGE_CACHE_PATH: ':memory:',
    },
    executablePath: electronExecutablePath,
  })
}

async function waitForApplication(window: Page): Promise<void> {
  await window.locator('a[href*="/journals"]').waitFor()
}

async function waitForSyncedPeer(window: Page, deviceName: string): Promise<void> {
  await expect.poll(() => window.evaluate(() => (
    (window as unknown as P2pRendererWindow).desktop.p2p.getStatus()
  )), { timeout: 20_000 }).toMatchObject({
    devices: [{ deviceName, error: null, state: 'synced' }],
    error: null,
    state: 'ready',
  })
}

async function createNote(window: Page, title: string): Promise<void> {
  await window.keyboard.press('Meta+P')
  await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()
  await expect(window.locator('[data-note-action="rename-current"]')).toBeVisible()
}

async function pairPeers(firstWindow: Page, secondWindow: Page): Promise<void> {
  const [firstStatus, secondStatus] = await Promise.all([
    firstWindow.evaluate(() => (window as unknown as P2pRendererWindow).desktop.p2p.getStatus()),
    secondWindow.evaluate(() => (window as unknown as P2pRendererWindow).desktop.p2p.getStatus()),
  ])
  if (firstStatus.peerId === null || secondStatus.peerId === null)
    throw new Error('P2P peers did not start')
  const [inviterWindow, acceptingWindow] = firstStatus.peerId < secondStatus.peerId
    ? [firstWindow, secondWindow]
    : [secondWindow, firstWindow]
  const invitation = await inviterWindow.evaluate(() => (
    (window as unknown as P2pRendererWindow).desktop.p2p.createInvitation()
  ))
  const response = await acceptingWindow.evaluate(invitationCode => (
    (window as unknown as P2pRendererWindow).desktop.p2p.acceptInvitation(invitationCode)
  ), invitation)
  await inviterWindow.evaluate(pairingResponse => (
    (window as unknown as P2pRendererWindow).desktop.p2p.completePairing(pairingResponse)
  ), response)
}

test('synchronizes the captured existing database to a new peer', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'memorilo-p2p-existing-database-'))
  const sourceDatabasePath = resolve(directory, 'source.sqlite')
  const destinationDatabasePath = resolve(directory, 'destination.sqlite')
  await seedSourceDatabase(sourceDatabasePath, resolve(directory, 'source-bootstrap-user-data'))
  let sourceApplication: ElectronApplication | null = null
  let destinationApplication: ElectronApplication | null = null
  try {
    sourceApplication = await launchPeer(sourceDatabasePath, 'Captured database', resolve(directory, 'source-user-data'))
    destinationApplication = await launchPeer(destinationDatabasePath, 'New peer', resolve(directory, 'destination-user-data'))
    const sourceWindow = await sourceApplication.firstWindow()
    const destinationWindow = await destinationApplication.firstWindow()
    await Promise.all([waitForApplication(sourceWindow), waitForApplication(destinationWindow)])

    await pairPeers(sourceWindow, destinationWindow)

    await waitForSyncedPeer(destinationWindow, 'Captured database')

    const journals = destinationWindow.locator('main[data-page=journals]')
    const previousJournal = journals.getByRole('article').filter({
      has: destinationWindow.locator('time[datetime="2026-08-21"]'),
    })
    const todayJournal = journals.getByRole('article').filter({
      has: destinationWindow.locator('time[datetime="2026-08-22"]'),
    })
    await expect(previousJournal).toBeVisible({ timeout: 20_000 })
    await expect(todayJournal).toBeVisible({ timeout: 20_000 })
    await expect(previousJournal.locator('[data-editor-content]')).toContainText('123')
    await expect(todayJournal.locator('[data-editor-content]')).toContainText('Today')

    await destinationWindow.locator('a[href*="/pages"]').click()
    const pages = destinationWindow.locator('main[data-page=pages]')
    await expect(pages).toBeVisible()
    await expect(pages.locator('button[data-note-action="open"]').filter({ hasText: '2026-08-21' })).toHaveCount(0)
    await expect(pages.locator('button[data-note-action="open"]').filter({ hasText: '2026-08-22' })).toHaveCount(0)
  }
  finally {
    await Promise.all([
      sourceApplication?.close(),
      destinationApplication?.close(),
    ])
    await rm(directory, { force: true, recursive: true })
  }
})

test('automatically reconnects paired peers after application restarts', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'memorilo-p2p-reconnect-'))
  const firstDatabasePath = resolve(directory, 'first.sqlite')
  const secondDatabasePath = resolve(directory, 'second.sqlite')
  const firstUserDataDirectory = resolve(directory, 'first-user-data')
  const secondUserDataDirectory = resolve(directory, 'second-user-data')
  let firstApplication: ElectronApplication | null = null
  let secondApplication: ElectronApplication | null = null
  try {
    firstApplication = await launchPeer(firstDatabasePath, 'First peer', firstUserDataDirectory)
    secondApplication = await launchPeer(secondDatabasePath, 'Second peer', secondUserDataDirectory)
    let firstWindow = await firstApplication.firstWindow()
    let secondWindow = await secondApplication.firstWindow()
    await Promise.all([waitForApplication(firstWindow), waitForApplication(secondWindow)])

    await pairPeers(firstWindow, secondWindow)
    await Promise.all([
      waitForSyncedPeer(firstWindow, 'Second peer'),
      waitForSyncedPeer(secondWindow, 'First peer'),
    ])

    await secondApplication.close()
    await createNote(firstWindow, 'Created while peer offline')
    await firstWindow.waitForTimeout(11_000)
    await expect(firstWindow.evaluate(() => (
      (window as unknown as P2pRendererWindow).desktop.p2p.getStatus()
    ))).resolves.toMatchObject({
      devices: [{ deviceName: 'Second peer', error: null, state: 'paused' }],
      error: null,
      state: 'ready',
    })
    secondApplication = await launchPeer(secondDatabasePath, 'Second peer', secondUserDataDirectory)
    secondWindow = await secondApplication.firstWindow()
    await waitForApplication(secondWindow)
    await Promise.all([
      waitForSyncedPeer(firstWindow, 'Second peer'),
      waitForSyncedPeer(secondWindow, 'First peer'),
    ])
    await secondWindow.locator('a[href*="/pages"]').click()
    await expect(secondWindow.locator('button[data-note-action="open"]').filter({ hasText: 'Created while peer offline' })).toBeVisible()

    await Promise.all([firstApplication.close(), secondApplication.close()])
    firstApplication = null
    secondApplication = null
    const [restartedFirstApplication, restartedSecondApplication] = await Promise.all([
      launchPeer(firstDatabasePath, 'First peer', firstUserDataDirectory),
      launchPeer(secondDatabasePath, 'Second peer', secondUserDataDirectory),
    ])
    firstApplication = restartedFirstApplication
    secondApplication = restartedSecondApplication
    firstWindow = await firstApplication.firstWindow()
    secondWindow = await secondApplication.firstWindow()
    await Promise.all([waitForApplication(firstWindow), waitForApplication(secondWindow)])
    await Promise.all([
      waitForSyncedPeer(firstWindow, 'Second peer'),
      waitForSyncedPeer(secondWindow, 'First peer'),
    ])
  }
  finally {
    await Promise.all([
      firstApplication?.close(),
      secondApplication?.close(),
    ])
    await rm(directory, { force: true, recursive: true })
  }
})
