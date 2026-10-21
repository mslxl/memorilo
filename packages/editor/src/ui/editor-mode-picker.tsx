import type { EditorSession } from '../common/editor-session'
import { Button } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { AlignLeft, ListTree } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EditorMode, editorModeName } from '../common/editor-mode'
import { editorModePickerStyles } from './editor-mode-picker.stylex'

export function EditorModePicker({
  onActivate,
  session,
}: {
  onActivate: () => void
  session: EditorSession
}) {
  const { t } = useTranslation('editor')
  const options = [
    { icon: AlignLeft, label: t('documentModeLabel'), mode: EditorMode.Document },
    { icon: ListTree, label: t('outlineModeLabel'), mode: EditorMode.Outline },
  ] as const

  return (
    <div {...stylex.props(editorModePickerStyles.overlay)} data-editor-mode-picker="">
      <div
        {...stylex.props(editorModePickerStyles.panel)}
        aria-label={t('modePickerLabel')}
        role="group"
      >
        {options.map(({ icon: Icon, label, mode: optionMode }) => (
          <Button
            key={optionMode}
            data-editor-mode={editorModeName(optionMode)}
            title={label}
            variant="secondary"
            xstyle={editorModePickerStyles.button}
            onClick={() => {
              onActivate()
              session.topicDocument.setMode(optionMode)
              session.editor.focus()
            }}
          >
            <Icon {...stylex.props(editorModePickerStyles.icon)} aria-hidden="true" strokeWidth={1.7} />
            <span {...stylex.props(editorModePickerStyles.label)}>{label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
