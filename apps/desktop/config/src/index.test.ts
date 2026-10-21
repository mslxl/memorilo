import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import {
  desktopConfigurationDefinition,
  DesktopConfigurationSchema,
  migrateDesktopConfiguration,
} from './index'

const decode = Schema.decodeUnknownSync(DesktopConfigurationSchema)
const token = '0123456789abcdef0123456789abcdef'

function configuration(mcp: { accessToken: string, enabled: boolean, port: number }) {
  return {
    backup: desktopConfigurationDefinition.defaults.backup,
    defaultNoteLearningEnabled: true,
    editor: desktopConfigurationDefinition.defaults.editor,
    flashcards: desktopConfigurationDefinition.defaults.flashcards,
    goals: desktopConfigurationDefinition.defaults.goals,
    learning: desktopConfigurationDefinition.defaults.learning,
    language: 'system',
    panel: desktopConfigurationDefinition.defaults.panel,
    theme: desktopConfigurationDefinition.defaults.theme,
    mcp,
    networkImagePasteBehavior: 'download',
    outdentBehavior: 'logical',
    readerArrowKeyPageTurning: true,
    readerAnnotationCopyFormat: 'text',
    readerEpubPresentationMode: 'publisher',
    readerPageMode: 'continuous',
    redrawTitlebar: true,
    reduceMotion: false,
    shortcuts: desktopConfigurationDefinition.defaults.shortcuts,
    syncServer: desktopConfigurationDefinition.defaults.syncServer,
    tiffConversionFormat: 'webp',
    todo: desktopConfigurationDefinition.defaults.todo,
    weekStart: 'sunday',
  }
}

describe('desktop MCP configuration', () => {
  it('migrates the title bar preference without replacing a saved native-frame choice', () => {
    const current = configuration({ accessToken: '', enabled: false, port: 8765 })
    const legacy = Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'redrawTitlebar'))
    expect(decode(migrateDesktopConfiguration(legacy)).redrawTitlebar).toBe(true)
    expect(decode(migrateDesktopConfiguration({ ...current, redrawTitlebar: false })).redrawTitlebar).toBe(false)
    expect(() => decode({ ...current, redrawTitlebar: 'false' })).toThrow()
  })
  it('uses Neovide cursor timing with smooth blink enabled by default', () => {
    expect(desktopConfigurationDefinition.defaults.editor.cursor).toMatchObject({
      animationLength: 0.15,
      shortAnimationLength: 0.04,
      smoothBlink: true,
    })
  })

  it('copies only highlighted text by default and validates every copy format', () => {
    expect(desktopConfigurationDefinition.defaults.readerAnnotationCopyFormat).toBe('text')
    expect(desktopConfigurationDefinition.defaults.readerPageMode).toBe('continuous')
    expect(decode({
      ...configuration({ accessToken: '', enabled: false, port: 8765 }),
      readerAnnotationCopyFormat: 'text-book-location',
    }).readerAnnotationCopyFormat).toBe('text-book-location')
    expect(() => decode({
      ...configuration({ accessToken: '', enabled: false, port: 8765 }),
      readerAnnotationCopyFormat: 'html',
    })).toThrow()
  })

  it('is disabled by default on the loopback MCP port', () => {
    expect(desktopConfigurationDefinition.defaults.mcp).toEqual({
      accessToken: '',
      enabled: false,
      port: 8765,
    })
  })

  it('requires a strong token only when enabled and validates the port range', () => {
    expect(decode(configuration({ accessToken: '', enabled: false, port: 8765 }))).toEqual(configuration({ accessToken: '', enabled: false, port: 8765 }))
    expect(() => decode(configuration({ accessToken: 'short', enabled: true, port: 8765 }))).toThrow('at least 32 characters')
    expect(decode(configuration({ accessToken: token, enabled: true, port: 1024 })).mcp.port).toBe(1024)
    expect(decode(configuration({ accessToken: token, enabled: true, port: 65535 })).mcp.port).toBe(65535)
    expect(() => decode(configuration({ accessToken: token, enabled: true, port: 1023 }))).toThrow()
    expect(() => decode(configuration({ accessToken: token, enabled: true, port: 65536 }))).toThrow()
    expect(() => decode(configuration({ accessToken: token, enabled: true, port: 8765.5 }))).toThrow()
  })

  it('does not change configurations that already include Todo settings', () => {
    const current = configuration({ accessToken: token, enabled: true, port: 9000 })
    expect(migrateDesktopConfiguration(current)).toBe(current)
  })

  it('enables the Todo workspace when migrating an older configuration', () => {
    const current = configuration({ accessToken: '', enabled: false, port: 8765 })
    const legacy = Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'todo'))
    expect(migrateDesktopConfiguration(legacy)).toEqual({
      ...legacy,
      shortcuts: desktopConfigurationDefinition.defaults.shortcuts,
      todo: desktopConfigurationDefinition.defaults.todo,
    })
  })

  it('fills all missing Todo settings while preserving existing values', () => {
    const current = configuration({ accessToken: '', enabled: false, port: 8765 })
    expect(migrateDesktopConfiguration({
      ...current,
      todo: { enabled: false },
    })).toEqual({
      ...current,
      todo: {
        ...desktopConfigurationDefinition.defaults.todo,
        autoCompleteParentTasks: true,
        enabled: false,
        recurringTaskCompletionAction: 'archive-completed-to-today',
      },
    })
  })

  it('fills missing shortcut values while preserving customized and cleared bindings', () => {
    const current = configuration({ accessToken: '', enabled: false, port: 8765 })
    const migrated = migrateDesktopConfiguration({
      ...current,
      shortcuts: {
        back: 'Ctrl+Alt+Left',
        highlight: '',
      },
    })

    expect(migrated).toMatchObject({
      shortcuts: {
        back: 'Ctrl+Alt+Left',
        highlight: '',
        forward: 'Alt+Right',
        addBasicCard: 'Alt+A',
        addCloze: 'Alt+Z',
        bold: desktopConfigurationDefinition.defaults.shortcuts.bold,
        code: desktopConfigurationDefinition.defaults.shortcuts.code,
        italic: desktopConfigurationDefinition.defaults.shortcuts.italic,
        strike: desktopConfigurationDefinition.defaults.shortcuts.strike,
        underline: desktopConfigurationDefinition.defaults.shortcuts.underline,
      },
    })
  })

  it('exposes configurable formatting shortcut defaults', () => {
    expect(desktopConfigurationDefinition.defaults.shortcuts).toMatchObject({
      bold: expect.stringMatching(/^(Mod|Ctrl)\+B$/u),
      code: expect.stringMatching(/^(Mod|Ctrl)\+E$/u),
      italic: expect.stringMatching(/^(Mod|Ctrl)\+I$/u),
      strike: expect.stringMatching(/^(Mod|Ctrl)\+S$/u),
      underline: expect.stringMatching(/^(Mod|Ctrl)\+U$/u),
    })
  })
})
