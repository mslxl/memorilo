import type { DesktopTopicNode } from '@memorilo/desktop-api'
import type { FormEvent } from 'react'
import { parseMarkdownImport } from '@memorilo/editor'
import { Dialog, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { FileUp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { desktopRequests } from '../../shared/desktop-requests'
import { errorMessage } from '../../shared/error-message'
import { noteEditorDialogStyles } from './editor/note-editor-dialogs.stylex'

export interface MarkdownImportValues {
  diagnostics: ReturnType<typeof parseMarkdownImport>['diagnostics']
  document: DesktopTopicNode
  flavor: 'commonmark' | 'gfm'
  mapTasks: boolean
  noteTitle: string
  topicTitle: string
}

interface MarkdownImportDialogProps {
  fileName: string
  onClose: () => void
  onConfirm: (values: MarkdownImportValues) => Promise<void> | void
  source: string
  target: 'new-note' | 'topic'
}

async function importNetworkImages(
  node: DesktopTopicNode,
  diagnostics: Array<{ line: number, message: string, severity: 'warning' }>,
): Promise<DesktopTopicNode> {
  const attrs = node.attrs
  if (node.type === 'image' && typeof attrs?.src === 'string') {
    try {
      const url = new URL(attrs.src)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        const imported = await desktopRequests.importNetworkImage({ source: url.toString() })
        return { ...node, attrs: { ...attrs, src: imported.src } }
      }
    }
    catch (error) {
      diagnostics.push({
        line: 1,
        message: `Image could not be imported: ${errorMessage(error)}`,
        severity: 'warning',
      })
    }
  }
  if (!node.content || node.content.length === 0)
    return node
  return { ...node, content: await Promise.all(node.content.map(child => importNetworkImages(child, diagnostics))) }
}

export function MarkdownImportDialog({ fileName, onClose, onConfirm, source, target }: MarkdownImportDialogProps) {
  const { t } = useTranslation('editor')
  const [flavor, setFlavor] = useState<'commonmark' | 'gfm'>('gfm')
  const [mapTasks, setMapTasks] = useState(true)
  const parsed = useMemo(() => parseMarkdownImport(source, fileName, { flavor, mapTasks }), [fileName, flavor, mapTasks, source])
  const [noteTitle, setNoteTitle] = useState(parsed.noteTitleCandidate)
  const [topicTitle, setTopicTitle] = useState(parsed.topicTitleCandidate)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextNoteTitle = noteTitle.trim()
    const nextTopicTitle = topicTitle.trim()
    if (nextNoteTitle.length === 0 || nextTopicTitle.length === 0) {
      setError(t('markdownImport.titleRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    const diagnostics = [...parsed.diagnostics]
    try {
      const document = await importNetworkImages(parsed.document as DesktopTopicNode, diagnostics)
      await onConfirm({
        diagnostics,
        document,
        flavor,
        mapTasks,
        noteTitle: nextNoteTitle,
        topicTitle: nextTopicTitle,
      })
    }
    catch (cause) {
      setError(errorMessage(cause))
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root defaultOpen onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay variant="note" />
        <Dialog.Content aria-describedby="markdown-import-description" aria-labelledby="markdown-import-title" asChild variant="compact" xstyle={noteEditorDialogStyles.markdownImportDialog}>
          <form data-markdown-import-dialog="" onSubmit={submit}>
            <header {...stylex.props(noteEditorDialogStyles.bookPickerHeader)}>
              <div>
                <h1 id="markdown-import-title" {...stylex.props(noteEditorDialogStyles.bookPickerTitle)}>
                  <FileUp aria-hidden="true" size={16} strokeWidth={1.8} />
                  {t('markdownImport.title')}
                </h1>
                <p id="markdown-import-description" {...stylex.props(noteEditorDialogStyles.bookPickerDescription)}>{fileName}</p>
              </div>
              <Dialog.Close asChild>
                <button {...stylex.props(noteEditorDialogStyles.inspectorCloseButton)} aria-label={t('markdownImport.close')} title={t('markdownImport.close')} type="button">
                  <X aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              </Dialog.Close>
            </header>
            <div {...stylex.props(noteEditorDialogStyles.markdownImportBody)}>
              {target === 'new-note'
                ? (
                    <label {...stylex.props(noteEditorDialogStyles.entryCreationField)}>
                      <span>{t('markdownImport.noteTitle')}</span>
                      <TextField autoFocus data-markdown-import-field="note-title" value={noteTitle} xstyle={noteEditorDialogStyles.entryCreationInput} onChange={event => setNoteTitle(event.target.value)} />
                    </label>
                  )
                : null}
              <label {...stylex.props(noteEditorDialogStyles.entryCreationField)}>
                <span>{t('markdownImport.topicTitle')}</span>
                <TextField autoFocus={target !== 'new-note'} data-markdown-import-field="topic-title" value={topicTitle} xstyle={noteEditorDialogStyles.entryCreationInput} onChange={event => setTopicTitle(event.target.value)} />
              </label>
              <label {...stylex.props(noteEditorDialogStyles.entryCreationField)}>
                <span>{t('markdownImport.flavor')}</span>
                <select data-markdown-import-field="flavor" value={flavor} {...stylex.props(noteEditorDialogStyles.markdownImportSelect)} onChange={event => setFlavor(event.target.value as 'commonmark' | 'gfm')}>
                  <option value="gfm">GFM</option>
                  <option value="commonmark">CommonMark</option>
                </select>
              </label>
              <label {...stylex.props(noteEditorDialogStyles.markdownImportCheckbox)}>
                <input checked={mapTasks} data-markdown-import-field="map-tasks" type="checkbox" onChange={event => setMapTasks(event.target.checked)} />
                <span>{t('markdownImport.mapTasks')}</span>
              </label>
              {parsed.diagnostics.length > 0
                ? (
                    <div {...stylex.props(noteEditorDialogStyles.markdownImportDiagnostics)} data-markdown-import-diagnostics="" role="status">
                      <strong>{t('markdownImport.warnings', { count: parsed.diagnostics.length })}</strong>
                      <ul>
                        {parsed.diagnostics.map(diagnostic => <li key={`${diagnostic.line}:${diagnostic.message}`}>{t('markdownImport.lineWarning', { line: diagnostic.line, message: diagnostic.message })}</li>)}
                      </ul>
                    </div>
                  )
                : null}
              {error ? <p {...stylex.props(noteEditorDialogStyles.bookPickerError)} role="alert">{error}</p> : null}
            </div>
            <footer {...stylex.props(noteEditorDialogStyles.bookPickerFooter)}>
              <Dialog.Close asChild><button {...stylex.props(noteEditorDialogStyles.bookPickerCancel)} disabled={submitting} type="button">{t('cancel')}</button></Dialog.Close>
              <button data-markdown-import-action="submit" {...stylex.props(noteEditorDialogStyles.bookPickerCreate)} disabled={submitting || noteTitle.trim().length === 0 || topicTitle.trim().length === 0} type="submit">
                {submitting ? t('markdownImport.importing') : t('markdownImport.import')}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
