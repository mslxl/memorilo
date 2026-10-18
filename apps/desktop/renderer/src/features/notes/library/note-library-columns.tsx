import type {
  DesktopNoteFavoriteState,
  DesktopNoteSummary,
  RenameDesktopNoteInput,
  RenameDesktopNoteResult,
  SetDesktopNoteFavoriteInput,
} from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import * as stylex from '@stylexjs/stylex'
import { Pencil, Star } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { formatJournalHeading } from '../../journals/journal-model'
import { noteLibraryColumnStyles as pagesRouteStyles } from './note-library-columns.stylex'

export interface PagesNoteCommands {
  favorite: (input: SetDesktopNoteFavoriteInput) => Promise<DesktopNoteFavoriteState>
  open: (noteId: string) => Promise<void>
  rename: (input: RenameDesktopNoteInput) => Promise<RenameDesktopNoteResult>
}

function displayedNoteTitle(note: DesktopNoteSummary): string {
  return note.kind === 'journal' ? formatJournalHeading(note.journalDate) : note.title
}

export function PagesTitleCell({ commands, note, renameRequested, t }: {
  commands: PagesNoteCommands
  note: DesktopNoteSummary
  renameRequested?: boolean
  t: TFunction
}) {
  const [draft, setDraft] = useState(note.title)
  const [editing, setEditing] = useState(() => renameRequested === true && note.kind === 'regular')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [favoritePending, setFavoritePending] = useState(false)
  const [opening, setOpening] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(false)
  const focusFrameRef = useRef<number | null>(null)
  const activeCommandRef = useRef<'favorite' | 'opening' | 'saving' | null>(null)
  const displayedTitle = displayedNoteTitle(note)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (focusFrameRef.current !== null)
        cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!editing)
      return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const focusInput = useCallback(() => {
    if (focusFrameRef.current !== null)
      cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!mountedRef.current)
        return
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const cancel = useCallback(() => {
    if (activeCommandRef.current === 'saving')
      return
    setDraft(note.title)
    setError(null)
    setEditing(false)
  }, [note.title])

  const commit = useCallback(async () => {
    const title = draft.trim()
    if (title.length === 0) {
      setError(t('noteTitleCannotBeEmpty'))
      inputRef.current?.focus()
      inputRef.current?.select()
      return
    }
    if (title === note.title) {
      setDraft(title)
      setError(null)
      setEditing(false)
      return
    }
    if (activeCommandRef.current !== null)
      return
    activeCommandRef.current = 'saving'

    setSaving(true)
    setError(null)
    try {
      const result = await commands.rename({ noteId: note.id, title })
      if (!mountedRef.current)
        return
      if (result.status === 'duplicate-title') {
        setError(t('duplicateTitle'))
        focusInput()
        return
      }
      if (result.status === 'journal-title-immutable')
        throw new Error(`Pages attempted to rename Journal ${result.journalDate}`)
      setDraft(result.note.title)
      setEditing(false)
    }
    catch {
      if (mountedRef.current) {
        setError(t('couldNotRename'))
        focusInput()
      }
    }
    finally {
      activeCommandRef.current = null
      if (mountedRef.current)
        setSaving(false)
    }
  }, [commands, draft, focusInput, note.id, note.title, t])

  const toggleFavorite = useCallback(() => {
    if (activeCommandRef.current !== null)
      return
    activeCommandRef.current = 'favorite'
    setFavoritePending(true)
    setActionError(null)
    void Promise.resolve().then(
      () => commands.favorite({ favorite: !note.favorite, noteId: note.id }),
    ).then(
      () => {
        activeCommandRef.current = null
        if (mountedRef.current)
          setFavoritePending(false)
      },
      () => {
        activeCommandRef.current = null
        if (mountedRef.current) {
          setActionError(t('couldNotUpdateFavorite'))
          setFavoritePending(false)
        }
      },
    )
  }, [commands, note.favorite, note.id, t])

  const openSelectedNote = useCallback(() => {
    if (activeCommandRef.current !== null)
      return
    activeCommandRef.current = 'opening'
    setOpening(true)
    setActionError(null)
    void Promise.resolve().then(() => commands.open(note.id)).then(
      () => {
        activeCommandRef.current = null
        if (mountedRef.current)
          setOpening(false)
      },
      () => {
        activeCommandRef.current = null
        if (mountedRef.current) {
          setActionError(t('couldNotOpenNote'))
          setOpening(false)
        }
      },
    )
  }, [commands, note.id, t])

  const favoriteControl = (
    <button
      {...stylex.props(
        pagesRouteStyles.titleIconButton,
        note.favorite && pagesRouteStyles.favoriteButtonActive,
      )}
      aria-label={t('addRemoveFavoritesFor', {
        name: note.favorite ? t('removeFrom') : t('addTo'),
        title: displayedTitle,
      })}
      aria-pressed={note.favorite}
      data-note-action="favorite"
      data-note-id={note.id}
      disabled={favoritePending}
      title={note.favorite ? t('removeFromFavorites') : t('addToFavorites')}
      type="button"
      onClick={toggleFavorite}
    >
      <Star aria-hidden="true" fill={note.favorite ? 'currentColor' : 'none'} size={15} strokeWidth={1.8} />
    </button>
  )

  const actionStatus = actionError
    ? <span {...stylex.props(pagesRouteStyles.visuallyHidden)} role="status">{actionError}</span>
    : null

  if (!editing) {
    return (
      <div {...stylex.props(pagesRouteStyles.titleCellControls)}>
        {favoriteControl}
        <button
          {...stylex.props(pagesRouteStyles.titleOpenButton)}
          aria-label={t('openNoteFor', { title: displayedTitle })}
          aria-busy={opening}
          data-note-action="open"
          data-note-id={note.id}
          disabled={opening}
          title={t('openTitle', { title: displayedTitle })}
          type="button"
          onClick={openSelectedNote}
        >
          <span {...stylex.props(pagesRouteStyles.titleOpenLabel)}>{displayedTitle}</span>
        </button>
        {note.kind === 'regular'
          ? (
              <button
                {...stylex.props(pagesRouteStyles.titleIconButton)}
                aria-label={t('renameNoteFor', { title: displayedTitle })}
                data-note-action="rename"
                data-note-id={note.id}
                title={t('renameNote')}
                type="button"
                onClick={() => {
                  setDraft(note.title)
                  setError(null)
                  setEditing(true)
                }}
              >
                <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
                <span {...stylex.props(pagesRouteStyles.visuallyHidden)}>{displayedTitle}</span>
              </button>
            )
          : <span {...stylex.props(pagesRouteStyles.titleEditSpacer)} />}
        {actionStatus}
      </div>
    )
  }

  return (
    <div {...stylex.props(pagesRouteStyles.titleCellControls)}>
      {favoriteControl}
      <div {...stylex.props(pagesRouteStyles.titleEditor)}>
        <input
          ref={inputRef}
          {...stylex.props(pagesRouteStyles.titleInput)}
          aria-busy={saving}
          aria-invalid={error !== null}
          aria-label={error ?? t('titleFor', { title: note.title })}
          data-note-action="rename-input"
          data-note-id={note.id}
          readOnly={saving}
          title={error ?? t('renameNote')}
          value={draft}
          onBlur={() => {
            if (activeCommandRef.current === 'saving')
              return
            if (draft.trim().length === 0)
              cancel()
            else
              void commit()
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            if (event.target.value.trim().length > 0)
              setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            }
            else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
        />
        {error
          ? <span {...stylex.props(pagesRouteStyles.visuallyHidden)} role="status">{error}</span>
          : null}
      </div>
      <span {...stylex.props(pagesRouteStyles.titleEditSpacer)} />
      {actionStatus}
    </div>
  )
}
