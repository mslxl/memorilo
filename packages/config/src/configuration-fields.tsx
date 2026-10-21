import type { ChangeEvent, KeyboardEvent } from 'react'
import type { ConfigurationField } from './configuration-definition'
import type { ConfigurationStore } from './configuration-store'
import { toError } from '@memorilo/effect-lifecycle'
import { SegmentedControl, Switch, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useState, useSyncExternalStore } from 'react'

import { configurationFieldStyles } from './configuration-fields.stylex'
import { getConfigurationValue } from './configuration-path'
import { ShortcutInput } from './shortcut-input'

function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

function FieldControl<T extends object>({
  field,
  store,
  value,
}: {
  field: ConfigurationField
  store: ConfigurationStore<T>
  value: unknown
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const update = useCallback(async (next: unknown) => {
    setPending(true)
    setError(null)
    try {
      await store.setValue(field.path, next)
    }
    catch (cause) {
      setError(toError(cause).message)
    }
    finally {
      setPending(false)
    }
  }, [field.path, store])

  let control
  switch (field.control) {
    case 'number': {
      if (typeof value !== 'number')
        throw new TypeError(`Number field ${field.path} received a non-number value`)
      const commit = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.value.length === 0) {
          setError(`${field.label} requires a number`)
          return
        }
        void update(Number(event.target.value))
      }
      const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter')
          event.currentTarget.blur()
      }
      control = (
        <>
          <TextField
            key={`${field.path}:${value}`}
            aria-label={field.label}
            defaultValue={value}
            disabled={pending}
            max={field.max}
            min={field.min}
            step={field.step}
            type="number"
            variant="settings"
            xstyle={configurationFieldStyles.numberInput}
            onBlur={commit}
            onKeyDown={commitOnEnter}
          />
          {field.unit ? <span {...stylex.props(configurationFieldStyles.unit)}>{field.unit}</span> : null}
        </>
      )
      break
    }
    case 'select':
      if (typeof value !== 'string')
        throw new TypeError(`Select field ${field.path} received a non-string value`)
      control = (
        <select
          {...stylex.props(configurationFieldStyles.input)}
          aria-label={field.label}
          disabled={pending}
          value={value}
          onChange={event => void update(event.target.value)}
        >
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
      break
    case 'segmented':
      if (typeof value !== 'string')
        throw new TypeError(`Segmented field ${field.path} received a non-string value`)
      control = (
        <SegmentedControl.Root aria-label={field.label} disabled={pending} value={value} onValueChange={next => void update(next)}>
          {field.options.map(option => (
            <SegmentedControl.Item key={option.value} value={option.value}>{option.label}</SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      )
      break
    case 'text': {
      if (typeof value !== 'string')
        throw new TypeError(`Text field ${field.path} received a non-string value`)
      const commit = (event: ChangeEvent<HTMLInputElement>) => void update(event.target.value)
      control = (
        <TextField
          key={`${field.path}:${value}`}
          aria-label={field.label}
          autoComplete={field.sensitive ? 'off' : undefined}
          defaultValue={value}
          disabled={pending}
          placeholder={field.placeholder}
          type={field.sensitive ? 'password' : 'text'}
          variant="settings"
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              event.currentTarget.blur()
          }}
        />
      )
      break
    }
    case 'shortcut': {
      if (typeof value !== 'string')
        throw new TypeError(`Shortcut field ${field.path} received a non-string value`)
      control = <ShortcutInput disabled={pending} label={field.label} placeholder={field.placeholder} value={value} onChange={next => void update(next)} />
      break
    }
    case 'time': {
      if (typeof value !== 'number' || !Number.isInteger(value))
        throw new TypeError(`Time field ${field.path} received a non-integer minute value`)
      const commit = (event: ChangeEvent<HTMLInputElement>) => {
        const [hourText, minuteText] = event.target.value.split(':')
        const hour = Number(hourText)
        const minute = Number(minuteText)
        if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
          setError(`${field.label} requires a valid time`)
          return
        }
        void update(hour * 60 + minute)
      }
      control = (
        <TextField
          aria-label={field.label}
          disabled={pending}
          max={field.max === undefined ? undefined : formatTime(field.max)}
          min={field.min === undefined ? undefined : formatTime(field.min)}
          step={60}
          type="time"
          value={formatTime(value)}
          variant="settings"
          xstyle={configurationFieldStyles.timeInput}
          onChange={commit}
        />
      )
      break
    }
    case 'toggle':
      if (typeof value !== 'boolean')
        throw new TypeError(`Toggle field ${field.path} received a non-boolean value`)
      control = (
        <Switch
          aria-label={field.label}
          checked={value}
          disabled={pending}
          onCheckedChange={next => void update(next)}
        />
      )
      break
  }

  const rowStyles = stylex.props(
    configurationFieldStyles.row,
    field.control === 'select' && configurationFieldStyles.selectRow,
    pending && configurationFieldStyles.pending,
  )

  return (
    <div {...rowStyles} data-configuration-field={field.path}>
      <div {...stylex.props(configurationFieldStyles.copy)}>
        <span {...stylex.props(configurationFieldStyles.label)}>{field.label}</span>
        {field.description
          ? <p {...stylex.props(configurationFieldStyles.description)}>{field.description}</p>
          : null}
      </div>
      <div {...stylex.props(configurationFieldStyles.controlSlot)}>{control}</div>
      {error ? <p {...stylex.props(configurationFieldStyles.error)} role="alert">{error}</p> : null}
    </div>
  )
}

export function ConfigurationFields<T extends object>({
  fields,
  store,
}: {
  fields: readonly ConfigurationField[]
  store: ConfigurationStore<T>
}) {
  const configuration = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return (
    <div {...stylex.props(configurationFieldStyles.list)}>
      {fields.map(field => (
        <FieldControl
          key={field.path}
          field={field}
          store={store}
          value={getConfigurationValue(configuration, field.path)}
        />
      ))}
    </div>
  )
}
