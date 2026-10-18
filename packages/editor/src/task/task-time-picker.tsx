import type { TFunction } from 'i18next'
import type { CSSProperties } from 'react'
import { Button, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { X } from 'lucide-react'
import { taskTimePickerStyles as styles } from './task-time-picker.stylex'

export interface TaskTimePickerProps {
  floatingStyle: CSSProperties
  floatingOwnerId?: string
  onChange: (value: string) => void
  onClear: () => void
  onClose: () => void
  onFloatingRef: (element: HTMLDivElement | null) => void
  t: TFunction
  value: string
}

export function TaskTimePicker({
  floatingStyle,
  floatingOwnerId,
  onChange,
  onClear,
  onClose,
  onFloatingRef,
  t,
  value,
}: TaskTimePickerProps) {
  return (
    <div ref={onFloatingRef} {...stylex.props(styles.popover)} data-task-action-floating-owner={floatingOwnerId} data-task-time-picker="" style={floatingStyle} role="dialog" aria-label={t('time')}>
      <div {...stylex.props(styles.heading)}>
        <span>{t('time')}</span>
        <Button variant="icon" xstyle={styles.closeButton} aria-label={t('close')} title={t('close')} type="button" onClick={onClose}>
          <X aria-hidden="true" size={14} strokeWidth={1.9} />
        </Button>
      </div>
      <TextField
        xstyle={styles.input}
        aria-label={t('time')}
        type="time"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      <Button variant="plain" xstyle={styles.clearButton} type="button" onClick={onClear}>{t('clearTime')}</Button>
    </div>
  )
}
