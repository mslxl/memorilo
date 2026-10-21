import type {
  DesktopJournalNote,
  DesktopJournalPage,
  DesktopJournalSummary,
  JournalDate,
} from '@memorilo/desktop-api'
import type { NoteExportFormat } from '../notes/note-export-menu'
import type { JournalFeedHandle } from './journal-feed'
import type { JournalRouteCoordinator } from './journal-route-coordinator'
import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify/unstyled'
import { desktopRequests } from '../../shared/desktop-requests'
import { desktopEffect, desktopEffectQuery } from '../../shared/effect-query'
import { errorMessage } from '../../shared/error-message'

import { createEditorNoteSessionCache } from '../notes/note-runtime'
import { runNoteExport } from '../notes/note-transfer-operation'
import { useFlushNotePersistence } from '../notes/persistence/note-persistence-hooks'
import { noteQueryKeys } from '../notes/query-keys'
import { useJournalCalendarTitlebar } from './journal-calendar-titlebar'
import { JournalFeed } from './journal-feed'
import {
  buildJournalFeed,
  formatJournalHeading,
  fromJournalDate,
  journalSummary,
} from './journal-model'
import { createJournalRouteCoordinator } from './journal-route-coordinator'
import { journalsPageStyles as journalRouteStyles } from './journals-page.stylex'
import { journalQueryKeys } from './query-keys'

const journalPageSize = 20
const journalSessionCacheCapacity = 8

export function JournalsPage({
  requestedDate,
  requestedFocus,
}: {
  requestedDate?: JournalDate
  requestedFocus?: string
}) {
  const { t } = useTranslation(['app', 'common'])
  const flushNotePersistence = useFlushNotePersistence()
  const queryClient = useQueryClient()
  const sessionCache = useMemo(
    () => createEditorNoteSessionCache(journalSessionCacheCapacity),
    [],
  )
  const feedRef = useRef<JournalFeedHandle>(null)
  const recordedJournalIdRef = useRef<string | null>(null)
  const requestedDateRef = useRef<JournalDate | null>(null)
  const selectJournalDateRef = useRef<(journalDate: JournalDate) => void>(() => undefined)
  const routeCoordinatorRef = useRef<JournalRouteCoordinator | null>(null)
  const [selectedDate, setSelectedDate] = useState<JournalDate | null>(null)
  const [selectedJournal, setSelectedJournal] = useState<DesktopJournalSummary | null>(null)
  const [selectingDate, setSelectingDate] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [transferOperationId, setTransferOperationId] = useState<string | null>(null)

  const todayQuery = useQuery(desktopEffectQuery.queryOptions({
    gcTime: 0,
    queryFn: () => desktopEffect('journals.open-today', async () => {
      await flushNotePersistence()
      const pruned = await desktopRequests.prunePastEmptyJournals()
      pruned.deletedNoteIds.forEach(noteId => sessionCache.delete(noteId))
      return desktopRequests.openJournal()
    }),
    queryKey: journalQueryKeys.today,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  }))
  const today = todayQuery.data
  const todayDate = today?.journalDate
  const retryInitialLoad = todayQuery.refetch
  const pastQuery = useInfiniteQuery(desktopEffectQuery.infiniteQueryOptions({
    enabled: today !== undefined,
    getNextPageParam: (lastPage: DesktopJournalPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as JournalDate | null,
    queryFn: ({ pageParam }) => desktopEffect('journals.list-past', () => (
      desktopRequests.listPastJournals({
        ...(pageParam === null ? {} : { before: pageParam }),
        limit: journalPageSize,
      })
    )),
    queryKey: journalQueryKeys.feed,
  }))
  useEffect(() => {
    const coordinator = createJournalRouteCoordinator({
      flush: flushNotePersistence,
    })
    routeCoordinatorRef.current = coordinator
    return () => {
      if (routeCoordinatorRef.current === coordinator)
        routeCoordinatorRef.current = null
      sessionCache.clear()
      void coordinator.close().catch((error) => {
        console.error('Failed to flush Journal changes while closing the route', error)
      })
    }
  }, [flushNotePersistence, sessionCache])

  const feedItems = useMemo(
    () => buildJournalFeed(today, pastQuery.data?.pages ?? [], selectedJournal),
    [pastQuery.data?.pages, selectedJournal, today],
  )
  const exportDate = selectedDate ?? today?.journalDate
  const exportJournal = exportDate === undefined || today === undefined
    ? null
    : feedItems.find(item => item.journalDate === exportDate) ?? journalSummary(today)
  const handleExport = useCallback(async (format: NoteExportFormat) => {
    if (exporting || exportJournal === null)
      return
    setExporting(true)
    try {
      const result = await runNoteExport(format, exportJournal.noteId, undefined, undefined, setTransferOperationId)
      if (result.phase === 'saved') {
        if (result.result.diagnostics.length > 0)
          toast.warning(`${result.result.path}\n${result.result.diagnostics.map(diagnostic => diagnostic.message).join('\n')}`, { autoClose: 10_000 })
        else
          toast.success(result.result.path, { autoClose: 5_000 })
      }
      else if (result.phase === 'failed') {
        throw new Error(result.error.message)
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    finally {
      setTransferOperationId(null)
      setExporting(false)
    }
  }, [exportJournal, exporting])
  const cancelExport = useCallback(() => {
    if (transferOperationId === null)
      return
    void desktopRequests.cancelNoteTransfer(transferOperationId).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }, [transferOperationId])
  const fetchNextPage = pastQuery.fetchNextPage
  const handleFetchNextPage = useCallback(() => {
    void fetchNextPage()
  }, [fetchNextPage])

  const handleJournalSaved = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: journalQueryKeys.feed })
  }, [queryClient])
  const recordJournalOpened = useCallback((summary: DesktopJournalSummary) => {
    if (recordedJournalIdRef.current === summary.noteId)
      return
    recordedJournalIdRef.current = summary.noteId
    void desktopRequests.recordNoteOpened({
      noteId: summary.noteId,
      topicId: summary.topicId,
    }).then(
      () => queryClient.invalidateQueries({ queryKey: noteQueryKeys.recent }),
      (error) => {
        if (recordedJournalIdRef.current === summary.noteId)
          recordedJournalIdRef.current = null
        console.error(`Failed to record Journal ${summary.journalDate} as opened`, error)
      },
    )
  }, [queryClient])
  const selectJournalDate = useCallback((journalDate: JournalDate) => {
    if (!today)
      return
    if (journalDate > today.journalDate) {
      toast.error(t('couldNotOpenFutureJournal'))
      return
    }
    const existingItem = feedItems.find(summary => summary.journalDate === journalDate)
    const coordinator = routeCoordinatorRef.current
    if (!coordinator)
      return
    setSelectingDate(true)
    void coordinator.select({
      commit: (summary) => {
        setSelectedDate(summary.journalDate)
        setSelectedJournal(current => existingItem
          ? (current?.journalDate === summary.journalDate ? current : null)
          : summary)
        recordJournalOpened(summary)
        feedRef.current?.scrollToDate(summary.journalDate)
        setSelectingDate(false)
        if (!existingItem) {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: journalQueryKeys.feed }),
            queryClient.invalidateQueries({ queryKey: journalQueryKeys.datesAll }),
          ]).catch(error => console.error(`Failed to refresh Journal ${journalDate} queries`, error))
        }
      },
      fail: (error) => {
        setSelectingDate(false)
        console.error(`Failed to open Journal ${journalDate}`, error)
        toast.error(t('couldNotOpenJournal', {
          date: formatJournalHeading(journalDate),
          message: errorMessage(error),
        }))
      },
      load: async () => {
        if (existingItem)
          return existingItem
        const note = await desktopRequests.openJournal({ journalDate })
        return journalSummary(note)
      },
    }).catch(() => undefined)
  }, [feedItems, queryClient, recordJournalOpened, t, today])
  selectJournalDateRef.current = selectJournalDate
  useJournalCalendarTitlebar({
    exporting,
    onCancelExport: cancelExport,
    onExport: handleExport,
    onSelectDate: selectJournalDate,
    selectedDate,
    selectingDate,
    today: todayDate,
  })

  useEffect(() => {
    if (!requestedDate || !today || requestedDateRef.current === requestedDate)
      return
    requestedDateRef.current = requestedDate
    selectJournalDateRef.current(requestedDate)
  }, [requestedDate, today])

  useEffect(() => {
    if (!today || (requestedDate && requestedDate !== today.journalDate))
      return
    recordJournalOpened(journalSummary(today))
  }, [recordJournalOpened, requestedDate, today])

  useEffect(() => {
    if (!todayDate)
      return
    void queryClient.invalidateQueries({ queryKey: journalQueryKeys.feed })
  }, [queryClient, todayDate])

  useEffect(() => {
    if (!todayDate)
      return
    const recheckToday = () => {
      if (document.visibilityState !== 'visible')
        return
      const coordinator = routeCoordinatorRef.current
      if (!coordinator)
        return
      void coordinator.refreshToday({
        commit: (note) => {
          const previous = queryClient.getQueryData<DesktopJournalNote>(journalQueryKeys.today)
          if (previous?.journalDate === note.journalDate)
            return
          if (previous)
            feedRef.current?.preserveViewportForRollover()
          queryClient.setQueryData(journalQueryKeys.today, note)
        },
        fail: error => console.error('Failed to refresh today\'s Journal', error),
        load: () => desktopRequests.openJournal(),
        prepare: async (note) => {
          const previous = queryClient.getQueryData<DesktopJournalNote>(journalQueryKeys.today)
          if (previous?.journalDate === note.journalDate) {
            if (previous.id !== note.id)
              throw new Error(`Journal ${note.journalDate} changed its Note identity`)
            return
          }
          if (previous) {
            await queryClient.refetchQueries({
              queryKey: journalQueryKeys.feed,
              type: 'active',
            })
          }
        },
      }).catch(() => undefined)
    }
    const nextMidnight = fromJournalDate(todayDate)
    nextMidnight.setDate(nextMidnight.getDate() + 1)
    nextMidnight.setHours(0, 0, 1, 0)
    const timeout = window.setTimeout(recheckToday, Math.max(nextMidnight.getTime() - Date.now(), 1_000))
    window.addEventListener('focus', recheckToday)
    document.addEventListener('visibilitychange', recheckToday)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', recheckToday)
      document.removeEventListener('visibilitychange', recheckToday)
    }
  }, [queryClient, todayDate])

  if (todayQuery.isPending) {
    return (
      <main {...stylex.props(journalRouteStyles.initialStatus)} aria-label={t('journals')} data-page="journals">
        <LoaderCircle
          {...stylex.props(journalRouteStyles.statusIcon, journalRouteStyles.loadingIcon)}
          aria-hidden="true"
          strokeWidth={1.7}
        />
        <span role="status">{t('loadingJournals')}</span>
      </main>
    )
  }

  if (todayQuery.isError || !today) {
    return (
      <main {...stylex.props(journalRouteStyles.initialStatus)} aria-label={t('journals')} data-page="journals">
        <TriangleAlert
          {...stylex.props(journalRouteStyles.statusIcon)}
          aria-hidden="true"
          strokeWidth={1.7}
        />
        <span role="alert">{t('couldNotLoadJournals')}</span>
        <button
          {...stylex.props(journalRouteStyles.retryButton)}
          type="button"
          onClick={() => void retryInitialLoad()}
        >
          {t('tryAgain', { ns: 'common' })}
        </button>
      </main>
    )
  }

  return (
    <main {...stylex.props(journalRouteStyles.page)} aria-label={t('journals')} data-page="journals">
      <JournalFeed
        ref={feedRef}
        cache={sessionCache}
        hasNextPage={pastQuery.hasNextPage}
        isFetchNextPageError={pastQuery.isFetchNextPageError}
        isFetchingNextPage={pastQuery.isFetchingNextPage}
        items={feedItems}
        focusBlockId={requestedFocus}
        focusJournalDate={requestedDate}
        today={today.journalDate}
        onFetchNextPage={handleFetchNextPage}
        onJournalSaved={handleJournalSaved}
      />
    </main>
  )
}
