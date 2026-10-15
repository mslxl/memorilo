import type { DesktopApplicationMenu } from '@memorilo/desktop-api'
import { Button } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Effect, Fiber } from 'effect'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'
import { hasCustomWindowTitlebar } from './window-chrome'
import { loadWindowApplicationIcon, opaqueHexColor, openWindowTitlebarMenu, updateWindowTitlebarAppearance } from './window-titlebar-service'
import { windowTitlebarStyles as styles } from './window-titlebar.stylex'

const menus = [
  { id: 'file', key: 'fileMenu', shortcut: 'f' },
  { id: 'edit', key: 'editMenu', shortcut: 'e' },
  { id: 'view', key: 'viewMenu', shortcut: 'v' },
  { id: 'window', key: 'windowMenu', shortcut: 'w' },
] as const

function CustomWindowTitlebar() {
  const { t } = useTranslation('app')
  const bar = useRef<HTMLElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const opening = useRef(false)
  const mounted = useRef(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [activeMenu, setActiveMenu] = useState<DesktopApplicationMenu | null>(null)
  const [applicationIcon, setApplicationIcon] = useState<string | null>(null)

  useEffect(() => {
    const fiber = Effect.runFork(loadWindowApplicationIcon().pipe(
      Effect.tap(icon => Effect.sync(() => setApplicationIcon(icon))),
      Effect.catch(error => Effect.sync(() => console.error('Could not load the application icon', error))),
    ))
    return () => {
      void Effect.runPromise(Fiber.interrupt(fiber))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (typeof window.desktop === 'undefined')
      return
    const synchronize = () => {
      if (!bar.current)
        return
      const computed = getComputedStyle(bar.current)
      const backgroundColor = opaqueHexColor(computed.backgroundColor)
      const symbolColor = opaqueHexColor(computed.color)
      if (backgroundColor && symbolColor) {
        void Effect.runPromise(updateWindowTitlebarAppearance({ backgroundColor, symbolColor }))
          .catch(error => console.error('Could not update native title bar appearance', error))
      }
    }
    synchronize()
    // Theme presets and system appearance update the root tokens in place.
    // Observe their owning boundary so native caption buttons match the bar.
    const observer = new MutationObserver(synchronize)
    observer.observe(document.documentElement, { attributeFilter: ['class', 'style'], attributes: true })
    window.addEventListener('resize', synchronize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', synchronize)
    }
  }, [])

  const focusMenu = useCallback((index: number) => {
    setFocusedIndex(index)
    buttons.current[index]?.focus({ preventScroll: true })
  }, [])

  const openMenu = useCallback(async (index: number, keyboard = false) => {
    const button = buttons.current[index]
    const menu = menus[index]
    if (!button || !menu || opening.current)
      return
    const bounds = button.getBoundingClientRect()
    opening.current = true
    setActiveMenu(menu.id)
    try {
      await Effect.runPromise(openWindowTitlebarMenu({
        anchor: { x: Math.round(bounds.left), y: Math.round(bounds.bottom + 4) },
        menu: menu.id,
      }))
    }
    catch (error) {
      console.error('Could not open application menu', error)
      if (mounted.current)
        toast.error(t('couldNotOpenApplicationMenu'))
    }
    finally {
      opening.current = false
      if (mounted.current) {
        setActiveMenu(null)
        if (keyboard && document.hasFocus())
          button.focus({ preventScroll: true })
      }
    }
  }, [t])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat)
        return
      if (event.key === 'F10' && !event.altKey) {
        event.preventDefault()
        focusMenu(0)
      }
      else if (event.altKey) {
        const index = menus.findIndex(menu => menu.shortcut === event.key.toLowerCase())
        if (index >= 0) {
          event.preventDefault()
          focusMenu(index)
          void openMenu(index, true)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusMenu, openMenu])

  return (
    <header ref={bar} {...stylex.props(styles.bar)} data-window-drag="" data-window-titlebar="">
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.brand)}>
          {applicationIcon && (
            <span {...stylex.props(styles.mark)} data-window-app-icon="">
              <img alt="" draggable={false} height={16} src={applicationIcon} width={16} />
            </span>
          )}
          <span data-window-app-name="">Memorilo</span>
        </div>
        <nav {...stylex.props(styles.menus)} aria-label={t('applicationMenu')} data-window-no-drag="" role="menubar">
          {menus.map((menu, index) => (
            <Button
              key={menu.id}
              ref={(element) => { buttons.current[index] = element }}
              aria-expanded={activeMenu === menu.id}
              aria-haspopup="menu"
              aria-keyshortcuts={`Alt+${menu.shortcut.toUpperCase()}`}
              data-application-menu={menu.id}
              data-state={activeMenu === menu.id ? 'open' : 'closed'}
              role="menuitem"
              tabIndex={focusedIndex === index ? 0 : -1}
              variant="plain"
              xstyle={[styles.menu, activeMenu === menu.id && styles.menuOpen]}
              onClick={() => void openMenu(index)}
              onFocus={() => setFocusedIndex(index)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  focusMenu((index + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length)
                }
                else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  focusMenu(event.key === 'Home' ? 0 : menus.length - 1)
                }
                else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                  event.preventDefault()
                  void openMenu(index, true)
                }
                else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
              onMouseDown={event => event.preventDefault()}
            >
              {t(menu.key)}
            </Button>
          ))}
        </nav>
      </div>
    </header>
  )
}

export function WindowTitlebar() {
  return hasCustomWindowTitlebar() ? <CustomWindowTitlebar /> : null
}
