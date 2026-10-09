import type { DesktopFavoriteNoteItem, DesktopRecentNoteItem } from '@memorilo/desktop-api'
import type { LucideIcon } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ReactNode } from 'react'
import type { DesktopClientError } from '../../shared/effect-query'
import { Sidebar } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Match } from 'effect'
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  Clock3,
  Files,
  GraduationCap,
  ListTodo,
  PanelLeft,
  Star,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatJournalHeading } from '../../features/journals/journal-model'

import { useFlushNotePersistence } from '../../features/notes/persistence/note-persistence-hooks'
import { noteQueryKeys } from '../../features/notes/query-keys'
import { useDesktopConfiguration } from '../../shared/configuration'
import { desktopRequests } from '../../shared/desktop-requests'
import {
  desktopEffect,
  desktopEffectQuery,
} from '../../shared/effect-query'
import { getPlatform } from '../../shared/platform'
import { router } from '../router'
import { P2pSidebarStatus } from './p2p-sidebar-status'
import { p2pSidebarStatusStyles } from './p2p-sidebar-status.stylex'
import { workspaceSidebarStyles } from './workspace-sidebar.stylex'

const sidebarSpring = {
  bounce: 0,
  duration: 0.3,
  type: 'spring',
} as const

const sidebarToggleSpring = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.3,
} as const

const disclosureSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.22,
} as const

interface SourceItemProps {
  destination: {
    journalDate: string
    kind: 'journal'
  } | {
    kind: 'note'
    noteId: string
    topicId: string
  } | {
    kind: 'route'
    to: '/journals' | '/learning' | '/pages' | '/shelf' | '/todo'
  }
  icon: LucideIcon
  label: string
  onBeforeNavigate?: () => Promise<void>
}

interface SourceItemContentProps {
  icon: LucideIcon
  label: string
  selected: boolean
}

function navigationItems(
  t: (key: string) => string,
  todoEnabled: boolean,
  learningEnabled: boolean,
): readonly SourceItemProps[] {
  const items: SourceItemProps[] = [
    { destination: { kind: 'route', to: '/journals' }, icon: CalendarDays, label: t('journals') },
    { destination: { kind: 'route', to: '/pages' }, icon: Files, label: t('pages') },
    { destination: { kind: 'route', to: '/shelf' }, icon: BookOpen, label: t('shelf') },
  ]
  if (todoEnabled)
    items.push({ destination: { kind: 'route', to: '/todo' }, icon: ListTodo, label: t('todo') })
  if (learningEnabled)
    items.push({ destination: { kind: 'route', to: '/learning' }, icon: GraduationCap, label: t('learning') })
  return items
}

const sourceRowHeight = 33
const sourceListMaxHeight = sourceRowHeight * 6
function favoriteNotesQueryOptions() {
  return desktopEffectQuery.queryOptions<readonly DesktopFavoriteNoteItem[], DesktopClientError, never>({
    queryFn: () => desktopEffect('notes.list-favorites', () => desktopRequests.listFavoriteNotes({ limit: 6 })),
    queryKey: noteQueryKeys.favorites,
  })
}

function recentNotesQueryOptions() {
  return desktopEffectQuery.queryOptions<readonly DesktopRecentNoteItem[], DesktopClientError, never>({
    queryFn: () => desktopEffect('notes.list-recent', () => desktopRequests.listRecentNotes({ limit: 6 })),
    queryKey: noteQueryKeys.recent,
  })
}

function estimateSourceRowSize() {
  return sourceRowHeight
}

function SourceItemContent({ icon: Icon, label, selected }: SourceItemContentProps) {
  return (
    <>
      <Sidebar.ItemIcon active={selected}>
        <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      </Sidebar.ItemIcon>
      <Sidebar.ItemLabel active={selected}>{label}</Sidebar.ItemLabel>
    </>
  )
}

function SourceItem({ destination, icon, label, onBeforeNavigate }: SourceItemProps) {
  if (destination.kind === 'journal') {
    return (
      <Sidebar.Item asChild>
        <Link
          activeProps={{ 'data-state': 'active' }}
          search={{ date: destination.journalDate }}
          title={label}
          to="/journals"
        >
          {({ isActive }) => <SourceItemContent icon={icon} label={label} selected={isActive} />}
        </Link>
      </Sidebar.Item>
    )
  }

  if (destination.kind === 'note') {
    return (
      <Sidebar.Item asChild>
        <Link
          activeProps={{ 'data-state': 'active' }}
          params={{ noteId: destination.noteId, topicId: destination.topicId }}
          preload="intent"
          title={label}
          to="/note/$noteId/$topicId"
        >
          {({ isActive }) => <SourceItemContent icon={icon} label={label} selected={isActive} />}
        </Link>
      </Sidebar.Item>
    )
  }

  const handleRouteClick = (event: ReactMouseEvent<HTMLAnchorElement>): void => {
    if (!onBeforeNavigate
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.altKey
      || event.ctrlKey
      || event.shiftKey) {
      return
    }
    event.preventDefault()
    void onBeforeNavigate()
      .then(() => router.navigate({ to: destination.to }))
      .catch(error => console.error(`Failed to flush Note changes before opening ${destination.to}`, error))
  }

  return (
    <Sidebar.Item asChild>
      <Link
        activeOptions={{ exact: destination.to !== '/learning', includeSearch: false }}
        activeProps={{ 'data-state': 'active' }}
        onClick={handleRouteClick}
        preload="intent"
        to={destination.to}
      >
        {({ isActive }) => <SourceItemContent icon={icon} label={label} selected={isActive} />}
      </Link>
    </Sidebar.Item>
  )
}

function VirtualizedSourceList({
  headingId,
  items,
}: {
  headingId: string
  items: readonly SourceItemProps[]
}) {
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const getItemKey = useCallback((index: number) => {
    const item = items[index]
    if (!item)
      throw new RangeError(`Virtual source item ${index} is outside the list`)
    return item.label
  }, [items])
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: estimateSourceRowSize,
    getItemKey,
    getScrollElement: () => scrollElementRef.current,
    overscan: 3,
  })

  return (
    <div
      ref={scrollElementRef}
      {...stylex.props(workspaceSidebarStyles.virtualSourceViewport)}
      aria-labelledby={headingId}
      role="list"
      style={{ height: Math.min(items.length * sourceRowHeight, sourceListMaxHeight) }}
    >
      <div
        {...stylex.props(workspaceSidebarStyles.virtualSourceSizer)}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index]
          if (!item)
            throw new RangeError(`Virtual source item ${virtualItem.index} is outside the list`)
          return (
            <div
              key={virtualItem.key}
              {...stylex.props(workspaceSidebarStyles.virtualSourceItem)}
              role="listitem"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <SourceItem {...item} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SourceGroup({
  emptyLabel,
  items,
  label,
  pending,
  t,
}: {
  emptyLabel: string
  items: readonly SourceItemProps[]
  label: string
  pending: boolean
  t: (key: string) => string
}) {
  const [expanded, setExpanded] = useState(true)
  const shouldReduceMotion = useReducedMotion()
  const headingId = useId()
  const transition = shouldReduceMotion ? { duration: 0 } : disclosureSpring

  return (
    <Sidebar.Group>
      <button
        id={headingId}
        {...stylex.props(workspaceSidebarStyles.groupHeading)}
        aria-expanded={expanded}
        type="button"
        onClick={() => setExpanded(current => !current)}
      >
        <span>{label}</span>
        <motion.span
          {...stylex.props(workspaceSidebarStyles.disclosureIcon)}
          animate={{ rotate: expanded ? 0 : -90 }}
          initial={false}
          transition={transition}
        >
          <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {expanded
          ? (
              <motion.div
                {...stylex.props(workspaceSidebarStyles.animatedSourceList)}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={transition}
              >
                {items.length > 0
                  ? <VirtualizedSourceList headingId={headingId} items={items} />
                  : (
                      <p {...stylex.props(workspaceSidebarStyles.emptySourceList)} role={pending ? 'status' : undefined}>
                        {pending ? t('sidebarLoading') : emptyLabel}
                      </p>
                    )}
              </motion.div>
            )
          : null}
      </AnimatePresence>
    </Sidebar.Group>
  )
}

export function WorkspaceSidebarMotion({
  compactCollapsed,
  children,
  onToggle,
  visible,
}: {
  children: ReactNode
  compactCollapsed?: boolean
  onToggle: () => void
  visible: boolean
}) {
  const { t } = useTranslation('app')
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : sidebarSpring
  const toggleTransition = shouldReduceMotion ? { duration: 0 } : sidebarToggleSpring
  const toggleLeft = Match.value({
    compactCollapsed,
    platform: getPlatform(),
    visible,
  }).pipe(
    Match.when(({ visible }) => visible, () => 217),
    Match.when(({ compactCollapsed }) => compactCollapsed === true, () => 14),
    Match.when(({ platform }) => platform === 'macos', () => 120),
    Match.orElse(() => 14),
  )
  const [sidebarMounted, setSidebarMounted] = useState(visible)
  useEffect(() => {
    if (visible && !sidebarMounted)
      queueMicrotask(() => setSidebarMounted(true))
  }, [sidebarMounted, visible])

  return (
    <>
      {sidebarMounted
        ? (
            <Sidebar.Root asChild aria-label={t('sidebarLabel')} variant="workspace">
              <motion.aside
                animate={visible
                  ? { opacity: 1, width: 248, x: 0 }
                  : { opacity: 0, width: 0, x: -18 }}
                initial={false}
                onAnimationComplete={(definition) => {
                  if (typeof definition === 'object' && !Array.isArray(definition) && definition.width === 0)
                    setSidebarMounted(false)
                }}
                transition={transition}
              >
                {children}
              </motion.aside>
            </Sidebar.Root>
          )
        : null}
      <motion.button
        {...stylex.props(workspaceSidebarStyles.toggle)}
        animate={{
          left: toggleLeft,
        }}
        aria-label={visible ? t('hideSidebar') : t('showSidebar')}
        data-sidebar-toggle=""
        data-window-no-drag=""
        initial={false}
        title={visible ? t('hideSidebar') : t('showSidebar')}
        transition={toggleTransition}
        type="button"
        onClick={onToggle}
      >
        <PanelLeft aria-hidden="true" size={17} strokeWidth={1.8} />
      </motion.button>
    </>
  )
}

export function WorkspaceSidebar({ compactCollapsed, onToggle, visible }: {
  compactCollapsed?: boolean
  onToggle: () => void
  visible: boolean
}) {
  const { t } = useTranslation('app')
  const configuration = useDesktopConfiguration()
  const flushNotePersistence = useFlushNotePersistence()
  const favoritesQuery = useQuery(favoriteNotesQueryOptions())
  const recentQuery = useQuery(recentNotesQueryOptions())
  const flushBeforeRouteNavigation = useCallback(async () => {
    await flushNotePersistence()
  }, [flushNotePersistence])
  const favoriteItems = (favoritesQuery.data ?? []).map(item => ({
    destination: item.kind === 'journal'
      ? { journalDate: item.journalDate, kind: 'journal' as const }
      : { kind: 'note' as const, noteId: item.noteId, topicId: item.topicId },
    icon: Star,
    label: item.kind === 'journal' ? formatJournalHeading(item.journalDate) : item.noteTitle,
  }))
  const recentItems = (recentQuery.data ?? []).map(item => ({
    destination: item.kind === 'journal'
      ? { journalDate: item.journalDate, kind: 'journal' as const }
      : { kind: 'note' as const, noteId: item.noteId, topicId: item.topicId },
    icon: Clock3,
    label: item.kind === 'journal' ? formatJournalHeading(item.journalDate) : item.noteTitle,
  }))

  return (
    <WorkspaceSidebarMotion compactCollapsed={compactCollapsed} visible={visible} onToggle={onToggle}>
      <Sidebar.Navigation xstyle={p2pSidebarStatusStyles.navigation}>
        <Sidebar.Group>
          <Sidebar.Header asChild>
            <h2>{t('navigation')}</h2>
          </Sidebar.Header>
          <div {...stylex.props(workspaceSidebarStyles.sourceList)}>
            {navigationItems(t, configuration.todo.enabled, configuration.learning.enabled).map(item => (
              <SourceItem
                key={item.label}
                {...item}
                onBeforeNavigate={item.destination.kind === 'route'
                  ? flushBeforeRouteNavigation
                  : undefined}
              />
            ))}
          </div>
        </Sidebar.Group>
        <SourceGroup
          emptyLabel={favoritesQuery.isError ? t('favoritesEmptyError') : t('favoritesEmpty')}
          items={favoriteItems}
          label={t('favorites')}
          pending={favoritesQuery.isPending}
          t={t}
        />
        <SourceGroup
          emptyLabel={recentQuery.isError ? t('recentEmptyError') : t('recentEmpty')}
          items={recentItems}
          label={t('recent')}
          pending={recentQuery.isPending}
          t={t}
        />
      </Sidebar.Navigation>
      <P2pSidebarStatus />
    </WorkspaceSidebarMotion>
  )
}
