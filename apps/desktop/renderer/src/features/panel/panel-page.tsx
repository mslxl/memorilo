import type { DesktopTodoTask } from '@memorilo/desktop-api'
import type { DesktopPanelTabOrder } from '@memorilo/desktop-config'
import { Tabs } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDesktopConfiguration } from '../../shared/configuration'
import { desktopRequests } from '../../shared/desktop-requests'
import { errorMessage } from '../../shared/error-message'
import { JournalDay } from '../journals/journal-day'
import { journalSummary } from '../journals/journal-model'
import { journalQueryKeys } from '../journals/query-keys'
import { createEditorNoteSessionCache } from '../notes/note-runtime'
import { todoQueryKeys } from '../todo/query-keys'
import { filterTodoListTasks, formatTaskScheduleDate, sortTodoTasks, todoTaskQueryOptions } from '../todo/todo-model'
import { panelStyles } from './panel-page.stylex'
import './panel-editor-overrides.stylex'

type PanelTab = 'journal' | 'todo'

function tabOrder(order: DesktopPanelTabOrder): readonly [PanelTab, PanelTab] {
  return order === 'journal-todo' ? ['journal', 'todo'] : ['todo', 'journal']
}

function TodoPanel() {
  const { i18n, t } = useTranslation(['panel', 'todo'])
  const queryClient = useQueryClient()
  const [completing, setCompleting] = useState<ReadonlySet<string>>(() => new Set())
  const [updateError, setUpdateError] = useState<string | null>(null)
  const tasksQuery = useInfiniteQuery(todoTaskQueryOptions())
  const tasks = useMemo(() => sortTodoTasks(tasksQuery.data
    ? tasksQuery.data.pages.flatMap(page => [...page.items])
    : []), [tasksQuery.data])
  const today = dayjs().format('YYYY-MM-DD')
  const todayTasks = useMemo(
    () => filterTodoListTasks(tasks, { id: 'today', kind: 'scope' }, today),
    [tasks, today],
  )
  const completeTask = useMutation({
    mutationFn: (task: DesktopTodoTask) => desktopRequests.updateTodoTask({
      blockId: task.blockId,
      noteId: task.noteId,
      status: 'done',
      topicId: task.topicId,
    }),
    onError: error => setUpdateError(errorMessage(error)),
    onMutate: (task) => {
      setUpdateError(null)
      setCompleting(current => new Set(current).add(task.blockId))
    },
    onSettled: (_data, _error, task) => {
      setCompleting((current) => {
        const next = new Set(current)
        next.delete(task.blockId)
        return next
      })
      void queryClient.invalidateQueries({ queryKey: todoQueryKeys.all })
    },
  })

  useEffect(() => {
    if (tasksQuery.isPending
      || todayTasks.length > 0
      || !tasksQuery.hasNextPage
      || tasksQuery.isFetchingNextPage
      || tasksQuery.isFetchNextPageError) {
      return
    }
    void tasksQuery.fetchNextPage()
  }, [
    tasksQuery,
    todayTasks.length,
  ])

  const waitingForTodayTasks = tasksQuery.isPending
    || (todayTasks.length === 0 && Boolean(tasksQuery.hasNextPage) && !tasksQuery.isFetchNextPageError)
  const failedToLoadTodayTasks = (tasksQuery.isError && tasks.length === 0)
    || (todayTasks.length === 0 && tasksQuery.isFetchNextPageError)

  return (
    <section id="panel-content-todo" {...stylex.props(panelStyles.tabPanel)} aria-labelledby="panel-tab-todo" role="tabpanel">
      <header {...stylex.props(panelStyles.sectionHeader)}>
        <div {...stylex.props(panelStyles.sectionHeading)}>
          <h1 {...stylex.props(panelStyles.sectionTitle)}>{t('todayTasks')}</h1>
          {!waitingForTodayTasks && !failedToLoadTodayTasks
            ? <span {...stylex.props(panelStyles.count)}>{t('taskCount', { count: todayTasks.length })}</span>
            : null}
        </div>
        <button
          {...stylex.props(panelStyles.iconButton)}
          aria-label={t('refreshTasks')}
          disabled={tasksQuery.isFetching}
          title={t('refreshTasks')}
          type="button"
          onClick={() => void tasksQuery.refetch()}
        >
          <RefreshCw
            {...stylex.props(tasksQuery.isFetching && panelStyles.spinningIcon)}
            aria-hidden="true"
            size={16}
            strokeWidth={1.8}
          />
        </button>
      </header>

      {updateError
        ? (
            <div {...stylex.props(panelStyles.inlineError)} role="status">
              <TriangleAlert aria-hidden="true" size={15} strokeWidth={1.8} />
              <span>{t('taskUpdateFailed', { message: updateError })}</span>
            </div>
          )
        : null}

      {waitingForTodayTasks
        ? (
            <div {...stylex.props(panelStyles.status)} role="status">
              <LoaderCircle {...stylex.props(panelStyles.spinningIcon)} aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{t('loadingTasks')}</span>
            </div>
          )
        : failedToLoadTodayTasks
          ? (
              <div {...stylex.props(panelStyles.status)} role="alert">
                <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{t('couldNotLoadTasks')}</span>
                <button
                  {...stylex.props(panelStyles.retryButton)}
                  type="button"
                  onClick={() => void (tasks.length === 0 ? tasksQuery.refetch() : tasksQuery.fetchNextPage())}
                >
                  {t('retry')}
                </button>
              </div>
            )
          : todayTasks.length === 0
            ? <div {...stylex.props(panelStyles.empty)}>{t('noTodayTasks')}</div>
            : (
                <div {...stylex.props(panelStyles.taskList)}>
                  {todayTasks.map((task) => {
                    const pending = completing.has(task.blockId)
                    const scheduleDate = task.schedule.kind === 'deadline'
                      ? task.schedule.date
                      : task.schedule.kind === 'span' ? task.schedule.start.slice(0, 10) : null
                    const due = scheduleDate === null
                      ? null
                      : [
                          formatTaskScheduleDate(scheduleDate, i18n.resolvedLanguage ?? i18n.language, Date.now()),
                          task.schedule.kind === 'deadline' ? task.schedule.time : task.schedule.kind === 'span' && !task.schedule.allDay ? task.schedule.start.slice(11) : null,
                        ].filter(Boolean).join(' · ')
                    const taskText = task.text.trim() || t('untitledTask')
                    return (
                      <div key={`${task.noteId}:${task.topicId}:${task.blockId}`} {...stylex.props(panelStyles.taskRow)}>
                        <input
                          {...stylex.props(panelStyles.taskCheckbox)}
                          aria-label={pending
                            ? t('completingTask', { task: taskText })
                            : t('completeTask', { task: taskText })}
                          checked={pending}
                          disabled={pending}
                          type="checkbox"
                          onChange={() => completeTask.mutate(task)}
                        />
                        <div {...stylex.props(panelStyles.taskContent)}>
                          <div {...stylex.props(panelStyles.taskText)}>{taskText}</div>
                          <div {...stylex.props(panelStyles.taskMetadata)}>
                            {task.status === 'doing'
                              ? <span {...stylex.props(panelStyles.doingLabel)}>{t('statusDoing', { ns: 'todo' })}</span>
                              : null}
                            {due ? <span>{t('due', { date: due })}</span> : null}
                            <span {...stylex.props(panelStyles.taskSource)}>{task.noteTitle}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {tasksQuery.hasNextPage
                    ? (
                        <div {...stylex.props(panelStyles.loadMore)}>
                          {tasksQuery.isFetchNextPageError
                            ? (
                                <button {...stylex.props(panelStyles.retryButton)} type="button" onClick={() => void tasksQuery.fetchNextPage()}>
                                  {t('retry')}
                                </button>
                              )
                            : (
                                <button
                                  {...stylex.props(panelStyles.retryButton)}
                                  disabled={tasksQuery.isFetchingNextPage}
                                  type="button"
                                  onClick={() => void tasksQuery.fetchNextPage()}
                                >
                                  {tasksQuery.isFetchingNextPage ? t('loadingMoreTasks') : t('loadMoreTasks')}
                                </button>
                              )}
                        </div>
                      )
                    : null}
                </div>
              )}
    </section>
  )
}

function JournalPanel() {
  const { t } = useTranslation('panel')
  const queryClient = useQueryClient()
  const sessionCache = useMemo(() => createEditorNoteSessionCache(1), [])
  const journalQuery = useQuery({
    gcTime: 0,
    queryFn: () => desktopRequests.openJournal(),
    queryKey: journalQueryKeys.today,
    refetchOnMount: 'always',
    staleTime: 0,
  })
  const handleSaved = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: journalQueryKeys.today })
  }, [queryClient])

  useEffect(() => () => sessionCache.clear(), [sessionCache])

  if (journalQuery.isPending) {
    return (
      <section id="panel-content-journal" {...stylex.props(panelStyles.tabPanel)} aria-labelledby="panel-tab-journal" role="tabpanel">
        <div {...stylex.props(panelStyles.status)} role="status">
          <LoaderCircle {...stylex.props(panelStyles.spinningIcon)} aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>{t('loadingJournal')}</span>
        </div>
      </section>
    )
  }

  if (journalQuery.isError) {
    return (
      <section id="panel-content-journal" {...stylex.props(panelStyles.tabPanel)} aria-labelledby="panel-tab-journal" role="tabpanel">
        <div {...stylex.props(panelStyles.status)} role="alert">
          <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>{t('couldNotLoadJournal')}</span>
          <button {...stylex.props(panelStyles.retryButton)} type="button" onClick={() => void journalQuery.refetch()}>
            {t('refreshJournal')}
          </button>
        </div>
      </section>
    )
  }

  const summary = journalSummary(journalQuery.data)
  return (
    <section id="panel-content-journal" {...stylex.props(panelStyles.tabPanel)} aria-labelledby="panel-tab-journal" role="tabpanel">
      <JournalDay
        compact
        cache={sessionCache}
        first
        summary={summary}
        today={summary.journalDate}
        onJournalSaved={handleSaved}
      />
    </section>
  )
}

export function PanelPage() {
  const { t } = useTranslation('panel')
  const configuration = useDesktopConfiguration()
  const tabs = tabOrder(configuration.panel.tabOrder)
  const [activeTab, setActiveTab] = useState<PanelTab>(tabs[0])

  return (
    <main {...stylex.props(panelStyles.panel)} data-panel-root="">
      <header {...stylex.props(panelStyles.tabBar)}>
        <Tabs.Root value={activeTab} onValueChange={value => setActiveTab(value as PanelTab)}>
          <Tabs.List aria-label={t('panelTabs')} xstyle={panelStyles.tabList}>
            {tabs.map(tab => (
              <Tabs.Trigger
                key={tab}
                id={`panel-tab-${tab}`}
                aria-controls={`panel-content-${tab}`}
                value={tab}
                xstyle={panelStyles.tabTrigger}
              >
                {tab === 'todo' ? t('todoTab') : t('journalTab')}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </header>
      <div {...stylex.props(panelStyles.content)}>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={activeTab}
            {...stylex.props(panelStyles.contentMotion)}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            {activeTab === 'todo' ? <TodoPanel /> : <JournalPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}
