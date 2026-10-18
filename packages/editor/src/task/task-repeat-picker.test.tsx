import type { RenderResult } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskRepeatPicker } from './task-repeat-picker'

const translations: Readonly<Record<string, string>> = {
  repeatNone: 'None',
  repeatPresetDaily: 'Daily',
}

const t = ((key: string) => translations[key] ?? key) as TFunction

function repeatButton(rendered: RenderResult, preset: string): HTMLButtonElement {
  const button = rendered.container.querySelector<HTMLButtonElement>(`button[data-task-repeat-preset="${preset}"]`)
  if (!(button instanceof HTMLButtonElement))
    throw new Error(`Repeat option ${preset} was not rendered as a button`)
  return button
}

function renderPicker(draft: Parameters<typeof TaskRepeatPicker>[0]['draft']) {
  return render(
    <TaskRepeatPicker
      baseDate="2026-08-19"
      calendarEvents={[]}
      calendarSubscriptions={[]}
      chinaRegion={false}
      draft={draft}
      floatingStyle={{}}
      mode="presets"
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onClose={vi.fn()}
      onDisable={vi.fn()}
      onEditCustom={vi.fn()}
      onFloatingRef={vi.fn()}
      t={t}
    />,
  )
}

describe('task repeat picker', () => {
  it('marks the persisted repeat state instead of the default editing template', () => {
    const disabled = renderPicker(null)
    expect(repeatButton(disabled, 'none').querySelector('svg')).not.toBeNull()
    expect(repeatButton(disabled, 'day').querySelector('svg')).toBeNull()
    disabled.unmount()

    const daily = renderPicker({ interval: 1, mode: 'due', unit: 'day' })
    expect(repeatButton(daily, 'none').querySelector('svg')).toBeNull()
    expect(repeatButton(daily, 'day').querySelector('svg')).not.toBeNull()
  })
})
