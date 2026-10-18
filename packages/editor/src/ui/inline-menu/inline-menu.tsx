'use client'

import type { BasicExtension } from 'prosekit/basic'
import type { Editor } from 'prosekit/core'
import type { LinkAttrs } from 'prosekit/extensions/link'
import type { EditorState } from 'prosekit/pm/state'
import type { CardExtension } from '../../card/card-extension'
import { Button as PublicButton, Surface, TextField, Toolbar } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Bold, Brackets, Code2, Highlighter, Italic, Link2, Strikethrough, Underline } from 'lucide-react'
import { useEditor, useEditorDerivedValue } from 'prosekit/react'
import { InlinePopoverPopup, InlinePopoverPositioner, InlinePopoverRoot } from 'prosekit/react/inline-popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSelectedCardDefinitionId } from '../../card/card-extension'

import { Button } from '../button/index.ts'
import { getEditorActions } from '../editor-actions/index.ts'
import { editorPositionerAdapterStyles } from '../floating-surface/editor-positioner-adapter.stylex'
import HeadingDropdown from './heading-dropdown.tsx'
import { inlineMenuStyles } from './inline-menu.stylex'

function getLinkState(editor: Editor<BasicExtension>) {
  return {
    isActive: editor.marks.link.isActive(),
    canExec: editor.commands.addLink.canExec({ href: '' }),
    command: () => editor.commands.expandLink(),
    currentLink: getCurrentLink(editor.state) ?? '',
  }
}

function getCurrentLink(state: EditorState): string | undefined {
  const { $from } = state.selection
  const marks = $from.marksAcross($from)
  if (!marks) {
    return
  }
  for (const mark of marks) {
    if (mark.type.name === 'link') {
      return (mark.attrs as LinkAttrs).href
    }
  }
}

type InlineMenuExtension = BasicExtension & CardExtension

function getCardSelectionState(editor: Editor<InlineMenuExtension>) {
  const cloze = editor.marks.cloze.isActive()
  const highlight = editor.marks.inlineHighlight.isActive()
  const canAddMathCloze = editor.commands.addCloze.canExec({ anchorKind: 'math-source' })
  const canAddRichCloze = editor.commands.addCloze.canExec({ anchorKind: 'rich-content' })
  return {
    cardUiSelected: getSelectedCardDefinitionId(editor.state) !== null,
    canCloze: cloze || canAddMathCloze || canAddRichCloze,
    canHighlight: highlight || editor.commands.setInlineHighlight.canExec({ color: 'yellow' }),
    cloze,
    clozeAnchorKind: canAddMathCloze ? 'math-source' as const : 'rich-content' as const,
    highlight,
    mathSourceSelection: canAddMathCloze,
  }
}

function getLearningDisabledSelectionState(editor: Editor<InlineMenuExtension>) {
  const highlight = editor.marks.inlineHighlight.isActive()
  return {
    cardUiSelected: false,
    canCloze: false,
    canHighlight: highlight || editor.commands.setInlineHighlight.canExec({ color: 'yellow' }),
    cloze: false,
    clozeAnchorKind: 'rich-content' as const,
    highlight,
    mathSourceSelection: false,
  }
}

export default function InlineMenu({ learningEnabled = true }: { learningEnabled?: boolean }) {
  const editor = useEditor<InlineMenuExtension>()
  const actions = useEditorDerivedValue(getEditorActions)
  const link = useEditorDerivedValue(getLinkState)
  const cardSelection = useEditorDerivedValue(
    learningEnabled ? getCardSelectionState : getLearningDisabledSelectionState,
  )
  const { t } = useTranslation('editor')

  const [linkMenuOpen, setLinkMenuOpen] = useState(false)
  const toggleLinkMenuOpen = () => setLinkMenuOpen(open => !open)

  const handleLinkUpdate = (href?: string) => {
    if (href) {
      editor.commands.addLink({ href })
    }
    else {
      editor.commands.removeLink()
    }

    setLinkMenuOpen(false)
    editor.focus()
  }

  if (cardSelection.cardUiSelected || cardSelection.mathSourceSelection)
    return null

  return (
    <>
      <InlinePopoverRoot
        onOpenChange={(event) => {
          if (!event.detail) {
            setLinkMenuOpen(false)
          }
        }}
      >
        <InlinePopoverPositioner {...stylex.props(editorPositionerAdapterStyles.positioner)}>
          <Toolbar.Root asChild variant="floating" xstyle={inlineMenuStyles.mainPopup}>
            <InlinePopoverPopup
              {...stylex.props(editorPositionerAdapterStyles.motion)}
              data-inline-menu="main"
            >
              <HeadingDropdown actions={actions.heading} />
              <Button
                data-editor-action="bold"
                pressed={actions.mark.bold.active}
                disabled={!actions.mark.bold.canExec}
                onClick={actions.mark.bold.run}
                tooltip={t('ui.bold')}
              >
                <Bold size={16} />
              </Button>
              <Button
                data-editor-action="italic"
                pressed={actions.mark.italic.active}
                disabled={!actions.mark.italic.canExec}
                onClick={actions.mark.italic.run}
                tooltip={t('ui.italic')}
              >
                <Italic size={16} />
              </Button>
              <Button
                data-editor-action="underline"
                pressed={actions.mark.underline.active}
                disabled={!actions.mark.underline.canExec}
                onClick={actions.mark.underline.run}
                tooltip={t('ui.underline')}
              >
                <Underline size={16} />
              </Button>
              <Button
                data-editor-action="strikethrough"
                pressed={actions.mark.strike.active}
                disabled={!actions.mark.strike.canExec}
                onClick={actions.mark.strike.run}
                tooltip={t('ui.strikethrough')}
              >
                <Strikethrough size={16} />
              </Button>
              <Button
                data-editor-action="code"
                pressed={actions.mark.code.active}
                disabled={!actions.mark.code.canExec}
                onClick={actions.mark.code.run}
                tooltip={t('ui.code')}
              >
                <Code2 size={16} />
              </Button>
              {learningEnabled
                ? (
                    <Button
                      data-editor-action="cloze"
                      pressed={cardSelection.cloze}
                      disabled={!cardSelection.canCloze}
                      onClick={() => {
                        if (cardSelection.cloze)
                          editor.commands.removeCloze()
                        else
                          editor.commands.addCloze({ anchorKind: cardSelection.clozeAnchorKind })
                      }}
                      tooltip={cardSelection.cloze ? t('ui.removeCloze') : t('ui.cloze')}
                    >
                      <Brackets size={16} />
                    </Button>
                  )
                : null}
              <Button
                data-editor-action="highlight"
                pressed={cardSelection.highlight}
                disabled={!cardSelection.canHighlight}
                onClick={() => {
                  if (cardSelection.highlight)
                    editor.commands.removeInlineHighlight()
                  else
                    editor.commands.setInlineHighlight({ color: 'yellow' })
                }}
                tooltip={cardSelection.highlight ? t('ui.removeHighlight') : t('ui.highlight')}
              >
                <Highlighter size={16} />
              </Button>
              {link.canExec && (
                <Button
                  data-editor-action="link"
                  pressed={link.isActive}
                  onClick={() => {
                    link.command()
                    toggleLinkMenuOpen()
                  }}
                  tooltip={t('ui.link')}
                >
                  <Link2 size={16} />
                </Button>
              )}
            </InlinePopoverPopup>
          </Toolbar.Root>
        </InlinePopoverPositioner>
      </InlinePopoverRoot>

      <InlinePopoverRoot
        defaultOpen={false}
        open={linkMenuOpen}
        onOpenChange={event => setLinkMenuOpen(event.detail)}
      >
        <InlinePopoverPositioner {...stylex.props(editorPositionerAdapterStyles.positioner)} placement="bottom">
          <InlinePopoverPopup
            {...stylex.props(editorPositionerAdapterStyles.motion)}
            data-inline-menu="link"
          >
            <Surface variant="popover" xstyle={inlineMenuStyles.linkPopup}>
              {linkMenuOpen && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const target = event.target as HTMLFormElement | null
                    const href = target?.querySelector('input')?.value?.trim()
                    handleLinkUpdate(href)
                  }}
                >
                  <TextField
                    placeholder={t('ui.pasteLinkPlaceholder')}
                    defaultValue={link.currentLink}
                  />
                </form>
              )}
              {link.isActive && (
                <PublicButton
                  variant="primary"
                  xstyle={inlineMenuStyles.removeButton}
                  type="button"
                  onClick={() => handleLinkUpdate()}
                  onMouseDown={event => event.preventDefault()}
                >
                  {t('ui.removeLink')}
                </PublicButton>
              )}
            </Surface>
          </InlinePopoverPopup>
        </InlinePopoverPositioner>
      </InlinePopoverRoot>
    </>
  )
}
