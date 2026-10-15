import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopConfigurationEnvironment } from '../app/configuration/configuration-environment'
import { createRendererConfigurationStore } from '../app/configuration/configuration-store'
import { Settings } from './settings'

const platform = vi.hoisted(() => ({ value: 'windows' }))
vi.mock('../shared/platform', () => ({ getPlatform: () => platform.value }))

describe('title bar preference', () => {
  beforeEach(() => {
    platform.value = 'windows'
  })

  it.each(['windows', 'linux'])('saves the switch directly below reduced motion on %s', async (value) => {
    platform.value = value
    const store = await createRendererConfigurationStore()
    await store.setValue('language', 'en')
    try {
      const rendered = render(
        <DesktopConfigurationEnvironment store={store}>
          <Settings store={store} />
        </DesktopConfigurationEnvironment>,
      )
      const reducedMotion = rendered.getByRole('switch', { name: 'Reduce motion' })
      const titlebar = rendered.getByRole('switch', { name: 'Enable redrawn title bar' })
      const switches = rendered.getAllByRole('switch')
      expect(switches.indexOf(titlebar)).toBe(switches.indexOf(reducedMotion) + 1)
      expect(titlebar).toBeChecked()
      expect(rendered.getByText(/Takes effect after restarting the app/)).toBeInTheDocument()
      fireEvent.click(titlebar)
      await waitFor(() => expect(store.getSnapshot().redrawTitlebar).toBe(false))
      expect(titlebar).not.toBeChecked()
      fireEvent.click(titlebar)
      await waitFor(() => expect(store.getSnapshot().redrawTitlebar).toBe(true))
    }
    finally {
      await store.close()
    }
  })

  it.each(['macos', 'other'])('hides this platform-specific setting on %s', async (value) => {
    platform.value = value
    const store = await createRendererConfigurationStore()
    await store.setValue('language', 'en')
    try {
      const rendered = render(
        <DesktopConfigurationEnvironment store={store}>
          <Settings store={store} />
        </DesktopConfigurationEnvironment>,
      )
      expect(rendered.getByRole('switch', { name: 'Reduce motion' })).toBeInTheDocument()
      expect(rendered.queryByRole('switch', { name: 'Enable redrawn title bar' })).not.toBeInTheDocument()
    }
    finally {
      await store.close()
    }
  })
})
