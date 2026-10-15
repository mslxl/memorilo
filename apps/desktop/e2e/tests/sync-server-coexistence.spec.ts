import type { DesktopP2pPairedDevice, DesktopP2pStatus, DesktopSyncServerStatus } from '@memorilo/desktop-api'
import type { Browser, ElectronApplication, Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { toError } from '@memorilo/effect-lifecycle'
import { _electron as electron, expect, test } from '@playwright/test'
import { Duration, Effect } from 'effect'

// Electron is reserved for the two desktop peers below. The server management
// console is always exercised in Playwright's standalone Chromium browser.
test.use({ browserName: 'chromium' })

interface P2pBridge {
  acceptInvitation: (invitation: string, dialTarget?: string) => Promise<string>
  completePairing: (response: string) => Promise<DesktopP2pPairedDevice>
  createInvitation: () => Promise<string>
  getServerStatus: () => Promise<DesktopSyncServerStatus>
  getStatus: () => Promise<DesktopP2pStatus>
}

interface MemoriloWindow extends Window {
  desktop: {
    p2p: P2pBridge
    subscribeP2pStatus: (listener: (status: DesktopP2pStatus) => void) => () => void
  }
  memoriloServerSyncStates?: string[]
}

interface RunningServer {
  readonly httpUrl: string
  readonly process: ChildProcess
  readonly wsUrl: string
}

interface SyncServerController {
  readonly httpUrl: string
  readonly wsUrl: string
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
}

interface ApplicationController {
  readonly close: (application: ElectronApplication) => Promise<void>
  readonly launch: (databasePath: string, deviceName: string, userDataDirectory: string) => Promise<ElectronApplication>
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop')
const syncServerEntry = resolve(repositoryRoot, 'apps/sync-server/src/index.ts')
const tsxEntry = resolve(repositoryRoot, 'apps/sync-server/node_modules/tsx/dist/cli.mjs')
const electronModule: unknown = createRequire(import.meta.url)('electron')
if (typeof electronModule !== 'string')
  throw new TypeError('Electron package did not resolve to an executable path')
const electronExecutablePath = electronModule

async function reservePort(): Promise<number> {
  const server = createServer()
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address !== 'object' || address === null)
        reject(new Error('Failed to reserve a TCP port'))
      else
        resolvePort(address.port)
    })
  })
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return port
}

async function waitForServer(url: string, child: ChildProcess, diagnostics: () => string): Promise<void> {
  await expect.poll(async () => {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Sync Server exited before readiness: ${diagnostics()}`)
    try {
      return (await fetch(`${url}/readyz`)).status
    }
    catch {
      return 0
    }
  }, { message: 'Sync Server did not become ready', timeout: 20_000 }).toBe(200)
}

async function startSyncServer(dataDirectory: string, port: number): Promise<RunningServer> {
  const child = spawn(process.execPath, [tsxEntry, syncServerEntry], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MEMORILO_SYNC_SERVER_DATA_DIR: dataDirectory,
      MEMORILO_SYNC_SERVER_HOST: '127.0.0.1',
      MEMORILO_SYNC_SERVER_PORT: String(port),
      MEMORILO_SYNC_SERVER_REGISTRATION: 'disabled',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stdout?.on('data', chunk => diagnostics += String(chunk))
  child.stderr?.on('data', chunk => diagnostics += String(chunk))
  const httpUrl = `http://127.0.0.1:${port}`
  try {
    await waitForServer(httpUrl, child, () => diagnostics)
    return { httpUrl, process: child, wsUrl: `ws://127.0.0.1:${port}` }
  }
  catch (error) {
    await stopProcess(child)
    throw error
  }
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  const awaitExit = Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void)
      return
    }
    const exited = (): void => resume(Effect.void)
    child.once('exit', exited)
    return Effect.sync(() => child.removeListener('exit', exited))
  })
  await Effect.runPromise(Effect.sync(() => child.kill('SIGTERM')).pipe(
    Effect.andThen(awaitExit),
    Effect.timeoutOrElse({
      duration: Duration.seconds(5),
      onTimeout: () => Effect.sync(() => child.kill('SIGKILL')).pipe(Effect.andThen(awaitExit)),
    }),
  ))
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

async function createSyncServerController(dataDirectory: string): Promise<SyncServerController> {
  const port = await reservePort()
  let server: RunningServer | null = null
  const start = async (): Promise<void> => {
    if (server !== null)
      return
    server = await startSyncServer(dataDirectory, port)
  }
  const stop = async (): Promise<void> => {
    const current = server
    server = null
    if (current !== null)
      await stopProcess(current.process)
  }
  await start()
  return {
    httpUrl: `http://127.0.0.1:${port}`,
    start,
    stop,
    wsUrl: `ws://127.0.0.1:${port}`,
  }
}

function withSyncServerFixture<Result>(
  operation: (fixture: {
    readonly applications: ApplicationController
    readonly directory: string
    readonly server: SyncServerController
  }) => Promise<Result>,
): Promise<Result> {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise({ catch: toError, try: () => mkdtemp(resolve(tmpdir(), 'memorilo-sync-server-e2e-')) }),
      path => Effect.tryPromise({ catch: toError, try: () => rm(path, { force: true, recursive: true }) }).pipe(Effect.orDie),
    )
    const server = yield* Effect.acquireRelease(
      Effect.tryPromise({ catch: toError, try: () => createSyncServerController(resolve(directory, 'server')) }),
      current => Effect.tryPromise({ catch: toError, try: current.stop }).pipe(Effect.orDie),
    )
    const runningApplications = yield* Effect.acquireRelease(
      Effect.sync(() => new Set<ElectronApplication>()),
      applications => Effect.tryPromise({
        catch: toError,
        try: () => Promise.allSettled([...applications].map(application => application.close())).then(() => undefined),
      }).pipe(Effect.orDie),
    )
    const applications: ApplicationController = {
      close: async (application) => {
        runningApplications.delete(application)
        await application.close()
      },
      launch: async (databasePath, deviceName, userDataDirectory) => {
        const application = await launchPeer(databasePath, deviceName, userDataDirectory)
        runningApplications.add(application)
        return application
      },
    }
    return yield* Effect.tryPromise({
      catch: toError,
      try: () => operation({ applications, directory, server }),
    })
  })))
}

async function waitForApplication(window: Page): Promise<void> {
  await window.getByRole('link', { name: 'Journals' }).waitFor()
}

async function createNote(window: Page, title: string): Promise<void> {
  await window.keyboard.press('Meta+P')
  await window.getByRole('combobox', { name: 'Search commands and Notes' }).fill(title)
  await window.getByRole('option').filter({ hasText: `Create Note “${title}”` }).click()
  await expect(window.getByRole('button', { name: `Rename Note: ${title}` })).toBeVisible()
}

async function openSettings(application: ElectronApplication, _mainWindow: Page): Promise<Page> {
  const previous = new Set(application.windows())
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('settings')
    if (!item)
      throw new Error('Settings menu item is unavailable')
    item.click()
  })
  await expect.poll(() => application.windows().length, { timeout: 10_000 }).toBeGreaterThan(previous.size)
  const settings = application.windows().find(window => !previous.has(window))
  if (!settings)
    throw new Error('Settings window did not open')
  await settings.getByRole('button', { name: 'Sync' }).click()
  return settings
}

async function openManagementPage(browser: Browser, url: string): Promise<Page> {
  const management = await browser.newPage()
  await management.goto(url)
  return management
}

async function pairDirectPeers(firstWindow: Page, secondWindow: Page): Promise<void> {
  const [firstStatus, secondStatus] = await Promise.all([
    firstWindow.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getStatus()),
    secondWindow.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getStatus()),
  ])
  if (firstStatus.peerId === null || secondStatus.peerId === null)
    throw new Error('P2P peers did not start')
  const [inviter, acceptor] = firstStatus.peerId < secondStatus.peerId
    ? [firstWindow, secondWindow]
    : [secondWindow, firstWindow]
  const invitation = await inviter.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.createInvitation())
  const response = await acceptor.evaluate(code => (window as unknown as MemoriloWindow).desktop.p2p.acceptInvitation(code), invitation)
  await inviter.evaluate(code => (window as unknown as MemoriloWindow).desktop.p2p.completePairing(code), response)
}

async function waitForPeer(window: Page, deviceName: string): Promise<void> {
  await expect.poll(() => window.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getStatus()), { timeout: 30_000 }).toMatchObject({
    devices: expect.arrayContaining([expect.objectContaining({ deviceName, state: 'synced' })]),
    state: 'ready',
  })
}

test('pairs through the management page, coexists with direct P2P, and restores from the authoritative server', async ({ browser }) => {
  test.setTimeout(150_000)
  await withSyncServerFixture(async ({ applications, directory, server }) => {
    const firstDatabase = resolve(directory, 'first.sqlite')
    const secondDatabase = resolve(directory, 'second.sqlite')
    const firstUserData = resolve(directory, 'first-user-data')
    const secondUserData = resolve(directory, 'second-user-data')
    let firstApplication = await applications.launch(firstDatabase, 'Server and direct peer', firstUserData)
    let firstWindow = await firstApplication.firstWindow()
    await waitForApplication(firstWindow)
    const management = await openManagementPage(browser, server.httpUrl)

    await management.getByLabel('Username').fill('owner')
    await management.getByLabel('Password').fill('correct-horse-battery-staple')
    await management.getByRole('button', { name: 'Create account' }).click()
    await expect(management.getByRole('alert')).toContainText('Account created')
    await management.getByRole('button', { name: 'Sign in' }).click()
    await expect(management.getByRole('navigation', { name: 'Management' })).toBeVisible()
    await expect(management.getByRole('button', { name: 'Pair a device' })).toHaveCSS('border-radius', '0px')
    await expect(management.getByText('The server stores plaintext synchronized data for this account.')).toBeVisible()

    await management.getByRole('button', { name: 'Devices' }).click()
    await management.getByRole('button', { name: 'Create invitation' }).click()
    const invitation = await management.getByLabel('Invitation').inputValue()

    const settings = await openSettings(firstApplication, firstWindow)
    const serverUrl = settings.getByRole('textbox', { name: 'Sync Server URL' })
    await serverUrl.fill(server.wsUrl)
    await serverUrl.blur()
    await settings.getByLabel('Sync Server invitation').fill(invitation)
    await settings.getByRole('button', { name: 'Create response' }).click()
    const response = await settings.getByLabel('Client pairing response').inputValue()

    await management.getByLabel('Client response').fill(response)
    await management.getByRole('button', { name: 'Complete pairing' }).click()
    const credential = await management.getByLabel('Device credential (copy into the client)').inputValue()
    await settings.getByLabel('Issued device credential').fill(credential)
    await settings.getByRole('button', { name: 'Finish pairing' }).click()
    await expect(settings.getByText('Sync Server paired. Restart Memorilo to apply the server connection.')).toBeVisible()
    expect(await readFile(resolve(firstUserData, 'configuration.json'), 'utf8')).not.toContain(credential)
    expect(await readFile(resolve(firstUserData, 'sync-server/device-credential.enc'), 'utf8')).not.toContain(credential)

    await applications.close(firstApplication)
    firstApplication = await applications.launch(firstDatabase, 'Server and direct peer', firstUserData)
    firstWindow = await firstApplication.firstWindow()
    await waitForApplication(firstWindow)
    await expect.poll(() => firstWindow.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getServerStatus()), { timeout: 30_000 }).toMatchObject({ state: 'synced' })

    const secondApplication = await applications.launch(secondDatabase, 'Direct peer', secondUserData)
    const secondWindow = await secondApplication.firstWindow()
    await waitForApplication(secondWindow)
    await pairDirectPeers(firstWindow, secondWindow)
    await Promise.all([
      waitForPeer(firstWindow, 'Direct peer'),
      waitForPeer(secondWindow, 'Server and direct peer'),
    ])

    await firstWindow.evaluate(() => {
      const current = window as unknown as MemoriloWindow
      current.memoriloServerSyncStates = []
      current.desktop.subscribeP2pStatus((status) => {
        const serverPeerId = status.devices.find(device => device.deviceName === 'Memorilo Sync Server')?.peerId
        const server = status.devices.find(device => device.peerId === serverPeerId)
        if (server)
          current.memoriloServerSyncStates?.push(`${server.state}:${server.error ?? ''}`)
      })
    })
    await createNote(firstWindow, 'Server coexistence note')
    await secondWindow.getByRole('link', { name: 'Pages' }).click()
    await expect(secondWindow.getByRole('button', { name: 'Open Note: Server coexistence note' })).toHaveCount(1, { timeout: 30_000 })
    await firstWindow.getByRole('link', { name: 'Pages' }).click()
    await expect(firstWindow.getByRole('button', { name: 'Open Note: Server coexistence note' })).toHaveCount(1)
    await expect.poll(() => firstWindow.evaluate(() => (window as unknown as MemoriloWindow).memoriloServerSyncStates ?? []), { timeout: 30_000 }).toEqual(expect.arrayContaining([
      expect.stringMatching(/^syncing:/u),
      expect.stringMatching(/^synced:/u),
    ]))

    await server.stop()
    await expect.poll(() => firstWindow.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getServerStatus()), { timeout: 30_000 }).toMatchObject({ state: 'offline' })
    await server.start()
    await expect.poll(() => firstWindow.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getServerStatus()), { timeout: 30_000 }).toMatchObject({ state: 'synced' })
    await management.reload()
    await expect(management.getByRole('navigation', { name: 'Management' })).toBeVisible()

    const eventSettings = await openSettings(firstApplication, firstWindow)
    await management.getByRole('button', { name: 'Sync policy', exact: true }).click()
    await management.getByRole('button', { name: 'Relay enabled' }).click()
    await management.getByLabel('Current password').fill('correct-horse-battery-staple')
    await management.getByRole('button', { name: 'Confirm change' }).click()
    await expect(eventSettings.getByRole('status')).toContainText('The Sync Server policy changed', { timeout: 30_000 })

    await management.getByRole('button', { name: 'Server data', exact: true }).click()
    await management.getByLabel('Current password').fill('correct-horse-battery-staple')
    await management.getByLabel('Type CLEAR SERVER DATA to confirm').fill('CLEAR SERVER DATA')
    await management.getByRole('button', { name: 'Clear server data' }).click()
    await expect(eventSettings.getByRole('status')).toContainText('The Sync Server data was cleared', { timeout: 30_000 })
    await expect.poll(() => firstWindow.evaluate(() => (window as unknown as MemoriloWindow).desktop.p2p.getServerStatus()), { timeout: 30_000 }).toMatchObject({ state: 'synced' })

    await Promise.all([applications.close(firstApplication), applications.close(secondApplication)])
    await Promise.all([
      rm(firstDatabase, { force: true }),
      rm(`${firstDatabase}-shm`, { force: true }),
      rm(`${firstDatabase}-wal`, { force: true }),
      rm(resolve(firstUserData, 'p2p/sync-journal.bin'), { force: true }),
    ])

    firstApplication = await applications.launch(firstDatabase, 'Server and direct peer', firstUserData)
    firstWindow = await firstApplication.firstWindow()
    await waitForApplication(firstWindow)
    await firstWindow.getByRole('link', { name: 'Pages' }).click()
    await expect(firstWindow.getByRole('button', { name: 'Open Note: Server coexistence note' })).toHaveCount(1, { timeout: 30_000 })
  })
})
