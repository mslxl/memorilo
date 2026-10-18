'use client'

import * as stylex from '@stylexjs/stylex'
import { AutocompleteItem } from 'prosekit/react/autocomplete'

import { autocompleteMenuStyles } from '../autocomplete-menu/autocomplete-menu.stylex'

export default function SlashMenuItem(props: {
  aliases?: readonly string[]
  command: string
  label: string
  kbd?: string
  onSelect: () => void
}) {
  const searchValue = [props.label, props.kbd, ...(props.aliases ? props.aliases : [])]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')

  return (
    <AutocompleteItem
      {...stylex.props(autocompleteMenuStyles.item)}
      data-slash-command={props.command}
      onSelect={props.onSelect}
      value={searchValue}
    >
      <span>{props.label}</span>
      {props.kbd && <kbd {...stylex.props(autocompleteMenuStyles.keyboard)}>{props.kbd}</kbd>}
    </AutocompleteItem>
  )
}
