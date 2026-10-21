import type { Rectangle } from 'electron'
import process from 'node:process'

import { Menu, nativeImage, Tray } from 'electron'
import { applicationIconPath, trayTemplatePath, trayTemplateRetinaPath } from '../app-icon-paths'

function createTrayIcon() {
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(trayTemplatePath)
    // Vite hashes both filenames, so the Retina representation must be loaded explicitly.
    icon.addRepresentation({
      buffer: nativeImage.createFromPath(trayTemplateRetinaPath).toPNG(),
      scaleFactor: 2,
    })
    icon.setTemplateImage(true)
    return icon
  }

  const icon = nativeImage.createFromPath(applicationIconPath)
  return icon.resize({ height: 16, width: 16 })
}

export interface TrayController {
  close: () => void
}

export interface TrayControllerOptions {
  onOpenMainWindow: () => void
  onTrayMouseDown: () => void
  onTogglePanel: (trayBounds: Rectangle) => void
  onQuit: () => void
}

export function createTrayController({ onOpenMainWindow, onQuit, onTogglePanel, onTrayMouseDown }: TrayControllerOptions): TrayController {
  const tray = new Tray(createTrayIcon())
  tray.setToolTip('Memorilo')

  const contextMenu = Menu.buildFromTemplate([
    { click: onOpenMainWindow, label: 'Open Memorilo' },
    { type: 'separator' },
    { click: onQuit, label: 'Quit Memorilo' },
  ])
  tray.on('mouse-down', onTrayMouseDown)
  tray.on('click', () => onTogglePanel(tray.getBounds()))
  tray.on('double-click', onOpenMainWindow)
  tray.on('right-click', () => tray.popUpContextMenu(contextMenu))

  return {
    close: () => tray.destroy(),
  }
}
