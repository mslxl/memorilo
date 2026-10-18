import type {
  DeleteDesktopNoteImpact,
  DesktopNoteFavoriteState,
  DesktopNoteSummary,
  RenameDesktopNoteInput,
  RenameDesktopNoteResult,
  SetDesktopNoteFavoriteInput,
} from '@memorilo/desktop-api'
import type { SortingState, VisibilityState } from '@tanstack/react-table'
import type { TFunction } from 'i18next'
import type { NoteLibraryColumnId } from './note-library-model'
import { AlertDialog, Button, ContextMenu } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery } from '@tanstack/react-query'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import dayjs from 'dayjs'
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  FileUp,
  LoaderCircle,
  Pencil,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { usePageTitlebar } from '../../../shared/page-titlebar'
import { PagesTitleCell } from './note-library-columns'
import {
  noteLibraryColumnIds,
  noteLibraryColumnLabel,
  noteLibraryQueryOptions,
  resolveNoteLibrarySort,
} from './note-library-model'
import { noteLibraryPageStyles as pagesRouteStyles } from './note-library-page.stylex'
import { NoteLibraryViewMenu } from './note-library-view-menu'

const rowHeight = 46
const columnHelper = createColumnHelper<DesktopNoteSummary>()

export interface NoteLibraryCommands {
  favorite: (input: SetDesktopNoteFavoriteInput) => Promise<DesktopNoteFavoriteState>
  open: (noteId: string) => Promise<void>
  rename: (input: RenameDesktopNoteInput) => Promise<RenameDesktopNoteResult>
  getDeleteImpact: (input: { noteId: string }) => Promise<DeleteDesktopNoteImpact>
  delete: (input: { noteId: string }) => Promise<DeleteDesktopNoteImpact>
  importNote: () => Promise<void>
  exportNote: (format: 'memo' | 'pdf', noteId: string) => Promise<void>
}

function estimateRowSize() {
  return rowHeight
}

const columnStyles = {
  createdAt: pagesRouteStyles.createdColumn,
  title: pagesRouteStyles.titleColumn,
  updatedAt: pagesRouteStyles.dateColumn,
} as const

function columnStyle(columnId: string) {
  const style = columnStyles[columnId as NoteLibraryColumnId]
  if (style === undefined)
    throw new Error(`Unknown Pages table column: ${columnId}`)
  return style
}

function noteCountLabel(totalItems: number, t: TFunction) {
  return t('noteCount', { count: totalItems })
}

function formatDate(value: unknown): string {
  return dayjs(value as Date).format('lll')
}

function createPagesColumns(commands: NoteLibraryCommands, t: TFunction, renameRequestedId: string | null) {
  return [
    columnHelper.accessor('title', {
      cell: info => <PagesTitleCell key={`${info.row.original.id}:${renameRequestedId === info.row.original.id}`} commands={commands} note={info.row.original} renameRequested={renameRequestedId === info.row.original.id} t={t} />,
      header: t('titleColumn'),
      sortDescFirst: false,
    }),
    columnHelper.accessor('createdAt', {
      cell: info => formatDate(info.getValue()),
      header: t('createdColumn'),
      sortDescFirst: true,
    }),
    columnHelper.accessor('updatedAt', {
      cell: info => formatDate(info.getValue()),
      header: t('modifiedColumn'),
      sortDescFirst: true,
    }),
  ]
}

export function NoteLibraryView({ commands, onCancelTransfer, transferBusy }: { commands: NoteLibraryCommands, onCancelTransfer: () => void, transferBusy: boolean }) {
  const { t } = useTranslation('pages')
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const [sorting, setSorting] = useState<SortingState>(() => [{ desc: true, id: 'updatedAt' }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [renameRequestedId, setRenameRequestedId] = useState<string | null>(null)
  const [context, setContext] = useState<{ note: DesktopNoteSummary, x: number, y: number } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DesktopNoteSummary | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<DeleteDesktopNoteImpact | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const { sortBy, sortDirection } = resolveNoteLibrarySort(sorting)
  const notesQuery = useInfiniteQuery(noteLibraryQueryOptions(sortBy, sortDirection))
  const columns = useMemo(() => createPagesColumns(commands, t, renameRequestedId), [commands, renameRequestedId, t])
  const notes = useMemo(() => notesQuery.data
    ? notesQuery.data.pages.flatMap(page => [...page.items])
    : [], [notesQuery.data])
  const firstPage = notesQuery.data?.pages[0]
  if (notesQuery.data && !firstPage)
    throw new Error('The Notes infinite query returned no first page')

  const table = useReactTable({
    columns,
    data: notes,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: note => note.id,
    manualSorting: true,
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: setSorting,
    state: { columnVisibility, sorting },
  })
  const rows = table.getRowModel().rows
  const visibleColumnCount = table.getVisibleLeafColumns().length
  if (visibleColumnCount < 1)
    throw new Error('Pages table must keep at least one visible column')

  const toggleColumnVisibility = useCallback((columnId: NoteLibraryColumnId) => {
    setColumnVisibility((current) => {
      const visible = current[columnId] !== false
      const visibleCount = noteLibraryColumnIds.filter(id => current[id] !== false).length
      if (visible && visibleCount === 1)
        return current
      return { ...current, [columnId]: !visible }
    })
  }, [])
  const openDeleteConfirmation = useCallback(async (note: DesktopNoteSummary) => {
    setContext(null)
    setDeleteLoading(true)
    try {
      setDeleteImpact(await commands.getDeleteImpact({ noteId: note.id }))
      setDeleteTarget(note)
    }
    finally {
      setDeleteLoading(false)
    }
  }, [commands])
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget)
      return
    setDeleteLoading(true)
    try {
      await commands.delete({ noteId: deleteTarget.id })
      setDeleteTarget(null)
      setDeleteImpact(null)
      await notesQuery.refetch()
    }
    finally {
      setDeleteLoading(false)
    }
  }, [commands, deleteTarget, notesQuery])
  const titlebar = useMemo(() => ({
    title: t('pageLabel'),
    trailing: (
      <>
        <Button aria-busy={transferBusy} aria-label={t('importNote')} data-note-action="import" data-window-no-drag="" disabled={transferBusy} title={t('importNote')} variant="titlebar" onClick={() => void commands.importNote()}>
          <FileUp aria-hidden="true" size={17} strokeWidth={1.9} />
        </Button>
        {transferBusy
          ? (
              <Button aria-label={t('cancel')} data-window-no-drag="" title={t('cancel')} variant="titlebar" onClick={onCancelTransfer}>
                <X aria-hidden="true" size={16} strokeWidth={1.9} />
              </Button>
            )
          : null}
        <NoteLibraryViewMenu
          columnVisibility={columnVisibility}
          onToggleColumn={toggleColumnVisibility}
          t={t}
        />
      </>
    ),
  }), [commands, columnVisibility, onCancelTransfer, t, toggleColumnVisibility, transferBusy])
  usePageTitlebar(titlebar)

  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = notesQuery
  const virtualCount = rows.length + (hasNextPage ? 1 : 0)
  const getVirtualRowKey = useCallback((index: number) => {
    const row = rows[index]
    if (row)
      return row.id
    if (index === rows.length && hasNextPage)
      return 'load-next-note-page'
    throw new RangeError(`Virtual Note row ${index} is outside the table`)
  }, [hasNextPage, rows])
  const rowVirtualizer = useVirtualizer({
    count: virtualCount,
    estimateSize: estimateRowSize,
    getItemKey: getVirtualRowKey,
    getScrollElement: () => scrollElementRef.current,
    overscan: 10,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastVirtualRow = virtualRows.at(-1)

  useEffect(() => {
    const scrollElement = scrollElementRef.current
    if (scrollElement)
      scrollElement.scrollTop = 0
  }, [sortBy, sortDirection])

  useEffect(() => {
    if (!lastVirtualRow
      || lastVirtualRow.index !== rows.length
      || !hasNextPage
      || isFetchingNextPage
      || isFetchNextPageError) {
      return
    }
    void fetchNextPage()
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    lastVirtualRow,
    rows.length,
  ])

  const totalItems = firstPage?.totalItems

  return (
    <main {...stylex.props(pagesRouteStyles.page)} aria-label={t('pageLabel')} data-page="pages">
      <section {...stylex.props(pagesRouteStyles.content)} aria-label={t('libraryLabel')}>
        <div {...stylex.props(pagesRouteStyles.summary)}>
          <p {...stylex.props(pagesRouteStyles.resultCount)} aria-live="polite" data-note-count={totalItems === undefined ? undefined : String(totalItems)}>
            {totalItems === undefined ? t('notes') : noteCountLabel(totalItems, t)}
          </p>
        </div>

        <div {...stylex.props(pagesRouteStyles.tableRegion)}>
          <div ref={scrollElementRef} {...stylex.props(pagesRouteStyles.tableViewport)}>
            <table
              {...stylex.props(pagesRouteStyles.table)}
              aria-busy={isFetchingNextPage}
              aria-rowcount={totalItems}
              data-note-library=""
            >
              <thead {...stylex.props(pagesRouteStyles.tableHead)}>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id} {...stylex.props(pagesRouteStyles.headerRow)}>
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted()
                      const label = noteLibraryColumnLabel(
                        header.column.id as NoteLibraryColumnId,
                        t,
                      )
                      return (
                        <th
                          key={header.id}
                          {...stylex.props(
                            pagesRouteStyles.headerCell,
                            columnStyle(header.column.id),
                          )}
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                          data-column-id={header.column.id}
                          scope="col"
                        >
                          <button
                            {...stylex.props(
                              pagesRouteStyles.headerButton,
                              sorted !== false && pagesRouteStyles.headerButtonSorted,
                            )}
                            aria-label={sorted
                              ? t('sortByCurrent', { direction: sorted === 'asc' ? t('ascending', { ns: 'common' }) : t('descending', { ns: 'common' }), label })
                              : t('sortBy', { label })}
                            data-column-id={header.column.id}
                            title={t('sortBy', { label })}
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <span>
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {sorted === 'asc'
                              ? <ArrowUp {...stylex.props(pagesRouteStyles.sortIcon)} aria-hidden="true" />
                              : sorted === 'desc'
                                ? <ArrowDown {...stylex.props(pagesRouteStyles.sortIcon)} aria-hidden="true" />
                                : null}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>

              {notesQuery.isPending
                ? (
                    <tbody {...stylex.props(pagesRouteStyles.statusBody)}>
                      <tr {...stylex.props(pagesRouteStyles.statusRow)}>
                        <td {...stylex.props(pagesRouteStyles.statusCell)} colSpan={visibleColumnCount}>
                          <LoaderCircle
                            {...stylex.props(pagesRouteStyles.statusIcon, pagesRouteStyles.loadingIcon)}
                            aria-hidden="true"
                            strokeWidth={1.7}
                          />
                          <span role="status">{t('loadingNotes')}</span>
                        </td>
                      </tr>
                    </tbody>
                  )
                : notesQuery.isError && rows.length === 0
                  ? (
                      <tbody {...stylex.props(pagesRouteStyles.statusBody)}>
                        <tr {...stylex.props(pagesRouteStyles.statusRow)}>
                          <td {...stylex.props(pagesRouteStyles.statusCell)} colSpan={visibleColumnCount}>
                            <TriangleAlert {...stylex.props(pagesRouteStyles.errorIcon)} aria-hidden="true" strokeWidth={1.7} />
                            <span>{t('couldNotLoadNotes')}</span>
                            <button
                              {...stylex.props(pagesRouteStyles.retryButton)}
                              type="button"
                              onClick={() => void notesQuery.refetch()}
                            >
                              {t('tryAgain', { ns: 'common' })}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    )
                  : rows.length === 0
                    ? (
                        <tbody {...stylex.props(pagesRouteStyles.statusBody)}>
                          <tr {...stylex.props(pagesRouteStyles.statusRow)}>
                            <td {...stylex.props(pagesRouteStyles.statusCell)} colSpan={visibleColumnCount}>
                              <FileText {...stylex.props(pagesRouteStyles.statusIcon)} aria-hidden="true" strokeWidth={1.5} />
                              <span>{t('noNotes')}</span>
                            </td>
                          </tr>
                        </tbody>
                      )
                    : (
                        <tbody
                          {...stylex.props(pagesRouteStyles.tableBody)}
                          style={{ height: rowVirtualizer.getTotalSize() }}
                        >
                          {virtualRows.map((virtualRow) => {
                            const row = rows[virtualRow.index]
                            if (!row) {
                              if (virtualRow.index !== rows.length || !hasNextPage)
                                throw new RangeError(`Virtual Note row ${virtualRow.index} is outside the table`)
                              return (
                                <tr
                                  key={virtualRow.key}
                                  {...stylex.props(pagesRouteStyles.loadingRow)}
                                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                                >
                                  <td {...stylex.props(pagesRouteStyles.loadingCell)} colSpan={visibleColumnCount}>
                                    {isFetchNextPageError
                                      ? (
                                          <button
                                            {...stylex.props(pagesRouteStyles.retryButton)}
                                            type="button"
                                            onClick={() => void fetchNextPage()}
                                          >
                                            {t('tryAgain', { ns: 'common' })}
                                          </button>
                                        )
                                      : (
                                          <>
                                            <LoaderCircle
                                              {...stylex.props(pagesRouteStyles.loadingMoreIcon, pagesRouteStyles.loadingIcon)}
                                              aria-hidden="true"
                                              strokeWidth={1.8}
                                            />
                                            <span>{t('loadingMore')}</span>
                                          </>
                                        )}
                                  </td>
                                </tr>
                              )
                            }
                            return (
                              <tr
                                key={row.id}
                                {...stylex.props(pagesRouteStyles.tableRow)}
                                aria-rowindex={virtualRow.index + 2}
                                style={{ transform: `translateY(${virtualRow.start}px)` }}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  setRenameRequestedId(null)
                                  setContext({ note: row.original, x: event.clientX, y: event.clientY })
                                }}
                              >
                                {row.getVisibleCells().map(cell => (
                                  <td
                                    key={cell.id}
                                    {...stylex.props(
                                      pagesRouteStyles.tableCell,
                                      columnStyle(cell.column.id),
                                      cell.column.id === 'title' && pagesRouteStyles.titleCell,
                                    )}
                                  >
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </td>
                                ))}
                              </tr>
                            )
                          })}
                        </tbody>
                      )}
            </table>
          </div>
        </div>
      </section>
      {context
        ? (
            <ContextMenu.Root open position={{ x: context.x, y: context.y }} onOpenChange={open => !open && setContext(null)}>
              <ContextMenu.Portal>
                <ContextMenu.Content variant="context" aria-label={context.note.title} xstyle={pagesRouteStyles.contextMenu}>
                  <ContextMenu.Item xstyle={pagesRouteStyles.contextMenuItem} onSelect={() => void commands.open(context.note.id)}>
                    <FileText {...stylex.props(pagesRouteStyles.contextMenuIcon)} aria-hidden="true" />
                    {t('openNote')}
                  </ContextMenu.Item>
                  <ContextMenu.Item disabled={transferBusy} xstyle={pagesRouteStyles.contextMenuItem} onSelect={() => void commands.exportNote('pdf', context.note.id)}>
                    <Download {...stylex.props(pagesRouteStyles.contextMenuIcon)} aria-hidden="true" />
                    {t('exportPdf')}
                  </ContextMenu.Item>
                  {context.note.kind === 'regular'
                    ? (
                        <ContextMenu.Item xstyle={pagesRouteStyles.contextMenuItem} onSelect={() => setRenameRequestedId(context.note.id)}>
                          <Pencil {...stylex.props(pagesRouteStyles.contextMenuIcon)} aria-hidden="true" />
                          {t('renameNote')}
                        </ContextMenu.Item>
                      )
                    : null}
                  <ContextMenu.Item xstyle={pagesRouteStyles.contextMenuItem} onSelect={() => void commands.favorite({ favorite: !context.note.favorite, noteId: context.note.id })}>
                    <Star {...stylex.props(pagesRouteStyles.contextMenuIcon)} aria-hidden="true" />
                    {context.note.favorite ? t('removeFromFavorites') : t('addToFavorites')}
                  </ContextMenu.Item>
                  <ContextMenu.Item xstyle={pagesRouteStyles.contextMenuItem} disabled={deleteLoading} onSelect={() => void openDeleteConfirmation(context.note)}>
                    <Trash2 {...stylex.props(pagesRouteStyles.contextMenuIcon)} aria-hidden="true" />
                    {t('deleteNote')}
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          )
        : null}
      {deleteTarget && deleteImpact
        ? (
            <AlertDialog.Root open onOpenChange={open => !open && !deleteLoading && setDeleteTarget(null)}>
              <AlertDialog.Portal>
                <AlertDialog.Overlay />
                <AlertDialog.Content variant="alert" xstyle={pagesRouteStyles.deleteDialogContent}>
                  <AlertDialog.Header xstyle={pagesRouteStyles.deleteDialogHeader}>
                    <AlertDialog.Title xstyle={pagesRouteStyles.deleteDialogTitle}>{t('deleteNoteTitle', { title: deleteTarget.title })}</AlertDialog.Title>
                  </AlertDialog.Header>
                  <AlertDialog.Body xstyle={pagesRouteStyles.deleteDialogBody}>
                    <AlertDialog.Description xstyle={pagesRouteStyles.deleteDialogDescription}>{t('deleteNoteDescription')}</AlertDialog.Description>
                    <ul {...stylex.props(pagesRouteStyles.deleteImpactList)}>
                      <li {...stylex.props(pagesRouteStyles.deleteImpactItem)}>{t('deleteImpactCards', { count: deleteImpact.cardCount })}</li>
                      <li {...stylex.props(pagesRouteStyles.deleteImpactItem)}>{t('deleteImpactTopics', { count: deleteImpact.topicCount })}</li>
                      <li {...stylex.props(pagesRouteStyles.deleteImpactItem)}>{t('deleteImpactBlocks', { count: deleteImpact.topicBlockCount })}</li>
                      <li {...stylex.props(pagesRouteStyles.deleteImpactItem)}>{t('deleteImpactAssets', { count: deleteImpact.assetCount, references: deleteImpact.assetReferenceCount })}</li>
                    </ul>
                  </AlertDialog.Body>
                  <AlertDialog.Footer xstyle={pagesRouteStyles.deleteDialogFooter}>
                    <AlertDialog.Cancel asChild>
                      <Button xstyle={pagesRouteStyles.deleteDialogCancel} disabled={deleteLoading}>{t('cancel')}</Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <Button
                        xstyle={pagesRouteStyles.deleteDialogAction}
                        disabled={deleteLoading}
                        onClick={(event) => {
                          event.preventDefault()
                          void confirmDelete()
                        }}
                      >
                        {t('deleteNote')}
                      </Button>
                    </AlertDialog.Action>
                  </AlertDialog.Footer>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          )
        : null}
    </main>
  )
}
