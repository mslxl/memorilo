import type { MessageBoxOptions, Rectangle } from 'electron'
import type { DesktopRuntime } from './desktop-runtime'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { memoriloProtocol } from '@memorilo/desktop-api/transport'
import { desktopCustomTitlebarArgument } from '@memorilo/desktop-preload'
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } from 'electron'

import { applicationIconPath } from './app-icon-paths'
import { applyPendingRestore } from './backup/restore-state'
import { createDesktopRuntime } from './desktop-runtime'
import { flushRendererNotes } from './lifecycle/note-save-handshake'
import { createShutdownStateMachine } from './lifecycle/shutdown-state-machine'
import {
  isRendererUrl,
  rendererIndexUrl,
} from './renderer-protocol'
import { acquireSingleInstance, showPrimaryWindow } from './single-instance'
import { applicationDataDirectory, mainDatabasePath } from './storage/workspace-paths'
import { initialPanelToggleState, panelBlur, settleTrayInteraction, trayClick, trayMouseDown } from './tray/panel-toggle-state'
import { createTrayController } from './tray/tray-controller'
import { mainWindowChromeOptions, usesCustomWindowChrome } from './windows/main-window-chrome'

let desktopRuntime: DesktopRuntime | null = null
let trayController: ReturnType<typeof createTrayController> | null = null
let mainWindow: BrowserWindow | null = null
let redrawMainTitlebar = true
let panelWindow: BrowserWindow | null = null
let panelReady = false
let panelToggleState = initialPanelToggleState
let settlePanelInteractionTimer: NodeJS.Timeout | null = null
let panelBlurTimer: NodeJS.Timeout | null = null
const mainDirectory = dirname(fileURLToPath(import.meta.url))

app.setName('Memorilo')
const isPrimaryInstance = acquireSingleInstance(app)
if (isPrimaryInstance) {
  app.on('second-instance', () => {
    const window = mainWindow
    if (window)
      showPrimaryWindow(window)
  })
}
protocol.registerSchemesAsPrivileged([{
  scheme: memoriloProtocol,
  privileges: {
    corsEnabled: true,
    secure: true,
    standard: true,
    supportFetchAPI: true,
  },
}])

const shutdown = createShutdownStateMachine({
  closeRuntime: async () => {
    await desktopRuntime?.close()
    desktopRuntime = null
  },
  getWindows: () => BrowserWindow.getAllWindows(),
  onError: (message, error) => console.error(message, error),
  quit: () => app.quit(),
  saveWindow: window => requestRendererSave([window.webContents], window),
})

function isAllowedNavigation(target: string, rendererUrl: string | undefined) {
  if (rendererUrl)
    return new URL(target).origin === new URL(rendererUrl).origin

  return isRendererUrl(target)
}

function shouldShowWindow(): boolean {
  return process.env.MEMORILO_E2E_HIDE_WINDOW !== '1'
    && !process.argv.includes('--hidden')
    && !process.argv.includes('--daemon')
}

function createWindow(redrawTitlebar = redrawMainTitlebar) {
  if (mainWindow !== null && !mainWindow.isDestroyed())
    return
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  redrawMainTitlebar = redrawTitlebar
  const customTitlebar = usesCustomWindowChrome(process.platform, redrawTitlebar)
  const window = new BrowserWindow({
    autoHideMenuBar: false,
    backgroundColor: '#ffffff',
    height: 800,
    icon: applicationIconPath,
    minHeight: 640,
    minWidth: 720,
    show: false,
    title: 'Memorilo',
    ...mainWindowChromeOptions(process.platform, redrawTitlebar),
    webPreferences: {
      additionalArguments: customTitlebar ? [desktopCustomTitlebarArgument] : [],
      backgroundThrottling: shouldShowWindow(),
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(mainDirectory, '../preload/index.cjs'),
      sandbox: true,
    },
    width: 1200,
  })
  mainWindow = window
  // Keep the application menu attached for native roles and accelerators;
  // its visible entry points live in the custom Windows/Linux title bar.
  if (customTitlebar)
    window.setMenuBarVisibility(false)

  if (shouldShowWindow())
    window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://'))
      void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, rendererUrl))
      event.preventDefault()
  })
  window.on('close', (event) => {
    if (process.platform === 'win32' && trayController !== null && !shutdown.isQuitting()) {
      event.preventDefault()
      window.hide()
      return
    }
    shutdown.handleWindowClose(window, event)
  })
  window.once('closed', () => {
    if (mainWindow === window)
      mainWindow = null
  })

  if (rendererUrl)
    void window.loadURL(rendererUrl)
  else
    void window.loadURL(rendererIndexUrl)
}

function createPanel(): BrowserWindow {
  if (panelWindow !== null && !panelWindow.isDestroyed())
    return panelWindow

  const panel = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: '#ffffff',
    frame: false,
    height: 560,
    icon: applicationIconPath,
    resizable: false,
    roundedCorners: true,
    show: false,
    skipTaskbar: true,
    title: 'Memorilo',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(mainDirectory, '../preload/index.cjs'),
      sandbox: true,
    },
    width: 420,
  })
  panelWindow = panel
  panelReady = false
  panel.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin')
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const hide = (): void => {
    if (!panel.isDestroyed() && !shutdown.isQuitting())
      panel.hide()
  }
  panel.once('ready-to-show', () => {
    panelReady = true
    if (panelToggleState.open && !panel.isDestroyed()) {
      panel.show()
      panel.focus()
    }
  })
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://'))
      void shell.openExternal(url)
    return { action: 'deny' }
  })
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  panel.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, rendererUrl))
      event.preventDefault()
  })
  panel.on('blur', () => {
    if (panelToggleState.suppressBlur)
      return
    if (panelBlurTimer !== null)
      clearTimeout(panelBlurTimer)
    panelBlurTimer = setTimeout(() => {
      panelBlurTimer = null
      panelToggleState = panelBlur(panelToggleState)
      if (!panelToggleState.open)
        hide()
    }, 0)
  })
  panel.on('close', (event) => {
    if (!shutdown.isQuitting()) {
      event.preventDefault()
      panel.hide()
    }
  })
  panel.once('closed', () => {
    if (settlePanelInteractionTimer !== null)
      clearTimeout(settlePanelInteractionTimer)
    if (panelBlurTimer !== null)
      clearTimeout(panelBlurTimer)
    if (panelWindow === panel)
      panelWindow = null
    panelReady = false
  })
  if (rendererUrl) {
    const baseUrl = rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`
    const panelUrl = new URL('index.html', baseUrl)
    panelUrl.hash = '/panel'
    void panel.loadURL(panelUrl.toString())
  }
  else {
    void panel.loadURL(`${rendererIndexUrl}#/panel`)
  }
  return panel
}

function togglePanel(trayBounds: Rectangle): void {
  if (panelBlurTimer !== null) {
    clearTimeout(panelBlurTimer)
    panelBlurTimer = null
  }
  panelToggleState = trayClick(panelToggleState)
  if (settlePanelInteractionTimer !== null)
    clearTimeout(settlePanelInteractionTimer)
  settlePanelInteractionTimer = setTimeout(() => {
    settlePanelInteractionTimer = null
    panelToggleState = settleTrayInteraction(panelToggleState)
  }, 50)
  const panel = createPanel()
  if (!panelToggleState.open) {
    panel.hide()
    return
  }
  const trayCenter = {
    x: trayBounds.x + trayBounds.width / 2,
    y: trayBounds.y + trayBounds.height / 2,
  }
  const display = screen.getDisplayNearestPoint(trayCenter)
  const workArea = display.workArea
  const panelBounds = panel.getBounds()
  const gap = 8
  const minX = workArea.x + gap
  const maxX = Math.max(minX, workArea.x + workArea.width - panelBounds.width - gap)
  const x = Math.min(maxX, Math.max(minX, Math.round(trayCenter.x - panelBounds.width / 2)))
  const below = trayCenter.y < workArea.y + workArea.height / 2
  const preferredY = below
    ? trayBounds.y + trayBounds.height + gap
    : trayBounds.y - panelBounds.height - gap
  const minY = workArea.y + gap
  const maxY = Math.max(minY, workArea.y + workArea.height - panelBounds.height - gap)
  const y = Math.min(maxY, Math.max(minY, preferredY))
  panel.setPosition(x, y)
  if (panelReady) {
    panel.show()
    panel.focus()
  }
}

function openMainWindow(): void {
  panelToggleState = { open: false, suppressBlur: false }
  if (panelWindow !== null && !panelWindow.isDestroyed())
    panelWindow.hide()
  createWindow()
  if (mainWindow)
    showPrimaryWindow(mainWindow)
}

async function startApplication(): Promise<void> {
  if (process.platform === 'darwin')
    app.dock?.setIcon(applicationIconPath)
  const dataDirectory = applicationDataDirectory(app.getPath('userData'), resolve(mainDirectory, '../../../../.dev'), app.isPackaged)
  const database = mainDatabasePath(dataDirectory)
  const restore = await applyPendingRestore(database)
  try {
    trayController = createTrayController({
      onOpenMainWindow: openMainWindow,
      onTrayMouseDown: () => {
        panelToggleState = trayMouseDown(panelToggleState)
        if (settlePanelInteractionTimer !== null)
          clearTimeout(settlePanelInteractionTimer)
      },
      onTogglePanel: togglePanel,
      onQuit: () => void shutdown.requestApplicationQuit(),
    })
    desktopRuntime = await createDesktopRuntime({
      allowTestClock: process.env.MEMORILO_E2E_NOW_MS !== undefined,
      createWindow,
      flushRenderer: () => requestRendererSave(),
      mainDirectory,
      requestRestart: () => {
        app.relaunch()
        app.quit()
      },
    })
    await restore?.commit()
  }
  catch (error) {
    trayController?.close()
    trayController = null
    if (restore)
      await restore.rollback()
    throw error
  }
}

void app.whenReady()
  .then(async () => {
    if (isPrimaryInstance)
      await startApplication()
  })
  .catch((error) => {
    console.error('Failed to start Memorilo', error)
    app.quit()
  })

async function requestRendererSave(
  targets = BrowserWindow.getAllWindows().map(window => window.webContents),
  owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
): Promise<boolean> {
  while (true) {
    const outcome = await flushRendererNotes({ ipcMain, targets })
    if (outcome.status === 'saved')
      return true
    const detail = outcome.status === 'failed'
      ? `Memorilo could not save the latest Note changes.\n\n${outcome.message}`
      : 'Memorilo did not receive confirmation that the latest Note changes were saved before the timeout.'
    const options: MessageBoxOptions = {
      buttons: ['Retry', 'Keep Open'],
      cancelId: 1,
      defaultId: 0,
      detail: `${detail}\n\nRetry saving, or keep the window open so your changes remain available.`,
      message: 'Couldn\'t Confirm Changes Were Saved',
      noLink: true,
      type: 'warning',
    }
    const response = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    if (response.response !== 0)
      return false
  }
}

app.on('before-quit', (event) => {
  shutdown.handleBeforeQuit(event)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && trayController === null)
    app.quit()
})

app.on('will-quit', () => {
  trayController?.close()
  trayController = null
})
