import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopRequestHandlers } from '../desktop-request-handlers'
import { Effect } from 'effect'
import { BrowserWindow, Menu } from 'electron'
import { withDesktopRequestContext } from '../desktop-request-handlers'
import { setTitlebarAppearance, showApplicationMenu } from '../windows/window-chrome-service'

export interface ColumnVisibilityMenuItem {
  canToggle: boolean
  id: string
  label: string
  visible: boolean
}

export interface ShowColumnVisibilityMenuInput {
  anchor: {
    x: number
    y: number
  }
  columns: readonly ColumnVisibilityMenuItem[]
}

export interface ColumnVisibilityMenuSelection {
  columnId: string
}

interface CaptureReaderRegionInput {
  height: number
  width: number
  x: number
  y: number
}

function validateCaptureRegion(input: CaptureReaderRegionInput): void {
  for (const [field, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value))
      throw new TypeError(`Reader capture ${field} must be an integer`)
  }
  if (input.x < 0 || input.y < 0)
    throw new RangeError('Reader capture origin must not be negative')
  if (input.width < 1 || input.height < 1)
    throw new RangeError('Reader capture dimensions must be positive')
}

function validateColumns(columns: readonly ColumnVisibilityMenuItem[]): void {
  if (columns.length === 0)
    throw new TypeError('Column visibility menu requires at least one column')

  const columnIds = new Set<string>()
  for (const column of columns) {
    if (column.id.trim().length === 0)
      throw new TypeError('Column visibility menu item id must not be empty')
    if (column.label.trim().length === 0)
      throw new TypeError(`Column visibility menu item ${column.id} must have a label`)
    if (columnIds.has(column.id))
      throw new TypeError(`Duplicate column visibility menu item id: ${column.id}`)
    columnIds.add(column.id)
  }
}

function validateAnchor(anchor: ShowColumnVisibilityMenuInput['anchor']): void {
  if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y))
    throw new TypeError('Column visibility menu anchor coordinates must be integers')
}

export function createWindowHandlers(): DesktopRequestHandlers['window'] {
  return {
    setTitlebarAppearance: withDesktopRequestContext((context, input) => Effect.runPromise(setTitlebarAppearance(context.sender, input))),
    showApplicationMenu: withDesktopRequestContext((context, input) => {
      validateAnchor(input.anchor)
      return Effect.runPromise(showApplicationMenu(context.sender, input))
    }),
    captureReaderRegion: withDesktopRequestContext(async (context, input: CaptureReaderRegionInput) => {
      validateCaptureRegion(input)
      const image = await context.sender.capturePage(input)
      const png = image.toPNG()
      if (png.byteLength === 0)
        throw new Error('Reader region capture produced an empty PNG')
      return Uint8Array.from(png)
    }),
    showColumnVisibilityMenu: withDesktopRequestContext((context, input: ShowColumnVisibilityMenuInput) => {
      validateAnchor(input.anchor)
      validateColumns(input.columns)
      const browserWindow = BrowserWindow.fromWebContents(context.sender)
      if (!browserWindow)
        throw new Error('Cannot show a native menu without an owning BrowserWindow')

      return new Promise((resolve) => {
        let selectedColumnId: string | null = null
        const columnItems: MenuItemConstructorOptions[] = input.columns.map(column => ({
          checked: column.visible,
          click: () => {
            selectedColumnId = column.id
          },
          enabled: column.canToggle,
          label: column.label,
          type: 'checkbox',
        }))
        const menu = Menu.buildFromTemplate([{
          label: 'Columns visibility',
          submenu: columnItems,
        }])
        menu.popup({
          callback: () => resolve(selectedColumnId === null ? null : { columnId: selectedColumnId }),
          window: browserWindow,
          x: input.anchor.x,
          y: input.anchor.y,
        })
      })
    }),
  }
}
