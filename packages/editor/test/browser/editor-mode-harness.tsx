import type { EditorModeValue } from '../../src/common/editor-mode'
import type { EditorTestHarnessProps } from './editor-test-harness'
import { useState } from 'react'

import { EditorMode } from '../../src/common/editor-mode'
import { EditorTestHarness } from './editor-test-harness'

export interface EditorModeHarnessProps extends Omit<EditorTestHarnessProps, 'mode'> {
  initialMode?: EditorModeValue
}

export function EditorModeHarness({ initialMode = EditorMode.Document, ...editorProps }: EditorModeHarnessProps) {
  const [mode, setMode] = useState<EditorModeValue>(initialMode)

  return (
    <>
      <div aria-label="Editor mode" role="group">
        <button aria-label="Document mode" aria-pressed={mode === EditorMode.Document} data-editor-mode-control="document" type="button" onClick={() => setMode(EditorMode.Document)}>
          Document
        </button>
        <button aria-label="Outline mode" aria-pressed={mode === EditorMode.Outline} data-editor-mode-control="outline" type="button" onClick={() => setMode(EditorMode.Outline)}>
          Outline
        </button>
      </div>
      <EditorTestHarness {...editorProps} mode={mode} />
    </>
  )
}
