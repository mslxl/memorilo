import { fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'

import { WorkspaceSidebarMotion } from './workspace-sidebar'

function SidebarMotionHarness() {
  const [visible, setVisible] = useState(true)
  return (
    <div style={{ display: 'flex', height: 400, position: 'relative', width: 800 }}>
      <WorkspaceSidebarMotion visible={visible} onToggle={() => setVisible(current => !current)}>
        <nav aria-label="Test navigation" />
      </WorkspaceSidebarMotion>
      <main style={{ flex: 1 }} />
    </div>
  )
}

function readInlineWidth(style: string | null): number | undefined {
  const match = style?.match(/(?:^|;)\s*width:\s*(-?\d+(?:\.\d+)?)px(?:;|$)/)
  if (!match?.[1])
    return undefined
  return Number.parseFloat(match[1])
}

it('moves adjacent content through intermediate positions while collapsing', async () => {
  const rendered = render(<SidebarMotionHarness />)
  const content = rendered.container.querySelector<HTMLElement>('main')
  if (!content)
    throw new Error('Workspace content was not rendered')
  const sidebar = rendered.getByRole('complementary', { name: 'Workspace navigation' })
  const start = content.getBoundingClientRect().left
  const animatedWidths: number[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const previousWidth = readInlineWidth(record.oldValue)
      if (previousWidth !== undefined)
        animatedWidths.push(previousWidth)
    }
    const currentWidth = readInlineWidth(sidebar.getAttribute('style'))
    if (currentWidth !== undefined)
      animatedWidths.push(currentWidth)
  })
  observer.observe(sidebar, { attributeFilter: ['style'], attributeOldValue: true, attributes: true })

  fireEvent.click(rendered.getByRole('button', { name: 'Hide Sidebar' }))
  await waitFor(() => {
    expect(rendered.queryByRole('complementary', { name: 'Workspace navigation' })).not.toBeInTheDocument()
  })
  observer.disconnect()

  const end = content.getBoundingClientRect().left
  expect(end).toBeLessThan(start - 200)
  expect(animatedWidths.some(width => width > 24.8 && width < 223.2)).toBe(true)
})
