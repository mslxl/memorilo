import type { AddShelfSourceInput, ShelfSource, UpdateShelfSourceInput } from '@memorilo/shelf'
import type { FormEvent, RefObject } from 'react'
import { Button, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { AlertCircle, Check, KeyRound, LoaderCircle, Plus } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shelfSharedStyles } from '../shelf-shared.stylex'
import { shelfSourceManagerStyles } from './shelf-source-manager-sheet.stylex'

const accountFieldsSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.2,
} as const

export function ShelfSourceEditor({
  editor,
  errorMessage,
  isPending,
  onAdd,
  onCancel,
  onComplete,
  onUpdate,
  urlInputRef,
}: {
  editor: 'add' | ShelfSource
  errorMessage: string | null
  isPending: boolean
  onAdd: (input: AddShelfSourceInput) => Promise<void>
  onCancel: () => void
  onComplete: () => void
  onUpdate: (input: UpdateShelfSourceInput) => Promise<void>
  urlInputRef: RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation('app')
  const editorSource = editor === 'add' ? null : editor
  const [showAccount, setShowAccount] = useState(editorSource?.auth === 'basic')
  const shouldReduceMotion = useReducedMotion()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const url = data.get('url')
    const name = data.get('name')
    const username = data.get('username')
    const password = data.get('password')
    if (typeof url !== 'string' || typeof name !== 'string')
      throw new TypeError('Shelf source URL is missing')
    const credentials = {
      ...(showAccount && typeof password === 'string' && password.length > 0 ? { password } : {}),
      ...(showAccount && typeof username === 'string' ? { username } : {}),
    }
    try {
      if (editor === 'add') {
        await onAdd({
          ...(name.trim().length > 0 ? { name } : {}),
          ...credentials,
          url,
        })
      }
      else {
        await onUpdate({
          clearCredentials: !showAccount,
          id: editor.id,
          name,
          ...credentials,
          url,
        })
      }
    }
    catch {
      return
    }
    onComplete()
  }

  return (
    <form
      key={editor === 'add' ? 'add' : editor.id}
      data-shelf-source-editor={editor === 'add' ? 'add' : 'edit'}
      {...stylex.props(shelfSourceManagerStyles.sourceForm)}
      onSubmit={event => void submit(event)}
    >
      <label {...stylex.props(shelfSourceManagerStyles.field)}>
        <span>{t('shelfOpdsAddress')}</span>
        <TextField
          ref={urlInputRef}
          autoComplete="url"
          defaultValue={editorSource?.url}
          name="url"
          data-shelf-field="url"
          placeholder="https://example.com/opds"
          required
          type="url"
          variant="default"
          xstyle={shelfSourceManagerStyles.textInput}
        />
      </label>
      <label {...stylex.props(shelfSourceManagerStyles.field)}>
        <span>
          {t('shelfSourceName')}
          {editor === 'add' ? <small {...stylex.props(shelfSourceManagerStyles.fieldOptional)}>{t('shelfOptional')}</small> : null}
        </span>
        <TextField
          defaultValue={editorSource?.name}
          name="name"
          data-shelf-field="name"
          placeholder={t('shelfUsesSourceTitle')}
          required={editor !== 'add'}
          type="text"
          xstyle={shelfSourceManagerStyles.textInput}
        />
      </label>
      <Button
        aria-expanded={showAccount}
        variant="plain"
        xstyle={shelfSourceManagerStyles.accountDisclosure}
        onClick={() => setShowAccount(current => !current)}
      >
        <span {...stylex.props(shelfSourceManagerStyles.accountLabel)}>
          <KeyRound size={15} strokeWidth={1.8} aria-hidden="true" />
          {t('shelfAccount')}
        </span>
        <span>{showAccount ? t('shelfRemoveSignIn') : t('shelfAddSignIn')}</span>
      </Button>
      <AnimatePresence initial={false}>
        {showAccount
          ? (
              <motion.div
                {...stylex.props(shelfSourceManagerStyles.accountFields)}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={shouldReduceMotion ? { duration: 0.12 } : accountFieldsSpring}
              >
                <label {...stylex.props(shelfSourceManagerStyles.field)}>
                  <span>{t('shelfUsername')}</span>
                  <TextField autoComplete="username" data-shelf-field="username" defaultValue={editorSource?.username ?? ''} name="username" required type="text" xstyle={shelfSourceManagerStyles.textInput} />
                </label>
                <label {...stylex.props(shelfSourceManagerStyles.field)}>
                  <span>
                    {t('shelfPassword')}
                    {editorSource?.auth === 'basic' ? <small {...stylex.props(shelfSourceManagerStyles.fieldOptional)}>{t('shelfLeaveBlankToKeep')}</small> : null}
                  </span>
                  <TextField
                    autoComplete="current-password"
                    data-shelf-field="password"
                    name="password"
                    required={editorSource?.auth !== 'basic'}
                    type="password"
                    xstyle={shelfSourceManagerStyles.textInput}
                  />
                </label>
                <p {...stylex.props(shelfSourceManagerStyles.privacyNote)}>{t('shelfPasswordPrivacy')}</p>
              </motion.div>
            )
          : null}
      </AnimatePresence>
      {errorMessage
        ? (
            <div {...stylex.props(shelfSourceManagerStyles.formError)} role="alert">
              <AlertCircle size={15} strokeWidth={1.9} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )
        : null}
      <footer {...stylex.props(shelfSourceManagerStyles.sheetActions)}>
        <Button disabled={isPending} variant="secondary" xstyle={shelfSharedStyles.secondaryButton} onClick={onCancel}>{t('shelfCancel')}</Button>
        <Button data-shelf-action="submit-source" disabled={isPending} type="submit" variant="primary" xstyle={shelfSharedStyles.primaryButton}>
          {isPending ? <LoaderCircle {...stylex.props(shelfSharedStyles.spinner)} size={16} strokeWidth={1.9} aria-hidden="true" /> : editor === 'add' ? <Plus size={16} strokeWidth={1.9} aria-hidden="true" /> : <Check size={16} strokeWidth={1.9} aria-hidden="true" />}
          {isPending ? t('shelfChecking') : editor === 'add' ? t('shelfAddSource') : t('shelfSaveChanges')}
        </Button>
      </footer>
    </form>
  )
}
