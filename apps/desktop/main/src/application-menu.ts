import type { MenuItemConstructorOptions } from 'electron'
import process from 'node:process'
import { app, Menu } from 'electron'

export function installApplicationMenu(openSettings: () => void): () => void {
  const settingsItem: MenuItemConstructorOptions = {
    accelerator: 'CmdOrCtrl+,',
    click: openSettings,
    id: 'settings',
    label: 'Settings…',
  }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            settingsItem,
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : [{
          id: 'file',
          label: 'File',
          submenu: [settingsItem, { type: 'separator' as const }, { role: 'quit' as const }],
        }]),
    { id: 'edit', role: 'editMenu' },
    { id: 'view', role: 'viewMenu' },
    { id: 'window', role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  return () => Menu.setApplicationMenu(null)
}
