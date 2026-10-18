import type { RefObject } from 'react'
import type { ShelfCatalog } from './shelf-catalog'
import type { ShelfSourceManagementHandle } from './source/shelf-source-management'
import { DropdownMenu } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import {
  AlertCircle,
  ArrowDown,
  ChevronDown,
  Globe2,
  LibraryBig,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import {
  startTransition,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { usePageTitlebar } from '../../shared/page-titlebar'
import { shelfBrowseIssueTranslation } from './publication/shelf-publication-collection'
import { VirtualShelf } from './publication/shelf-publication-grid-view'
import { AllSourcesOverview, SourceOverview } from './publication/shelf-publication-overview'
import { useShelfCatalog } from './shelf-catalog'
import { shelfPageStyles } from './shelf-page.stylex'
import { shelfErrorMessage } from './shelf-query'
import { shelfSharedStyles } from './shelf-shared.stylex'
import { ShelfSourceManagement } from './source/shelf-source-management'
import { ShelfSourceMenu } from './source/shelf-source-menu'

export interface ShelfSearch {
  page?: string
  q?: string
  source?: string
}

function shelfRelativeUpdateTime(timestamp: number, language: string): string {
  const relativeTime = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  if (Math.abs(seconds) < 60)
    return relativeTime.format(0, 'second')
  const minutes = Math.round(seconds / 60)
  return Math.abs(minutes) < 60
    ? relativeTime.format(minutes, 'minute')
    : relativeTime.format(Math.round(minutes / 60), 'hour')
}

function ShelfContent({
  catalog,
  onAddSource,
  onBrowseCategory,
  onBrowseSource,
  query,
  scrollElementRef,
}: {
  catalog: ShelfCatalog
  onAddSource: () => void
  onBrowseCategory: (sourceId: string, categoryUrl: string) => void
  onBrowseSource: (sourceId: string) => void
  query: string
  scrollElementRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation('app')
  const contentIssueTranslation = catalog.content?.kind === 'books' && catalog.content.issue
    ? shelfBrowseIssueTranslation(catalog.content.issue)
    : null

  if (catalog.sourcesState === 'opening') {
    return (
      <div {...stylex.props(shelfPageStyles.loadingState)} role="status">
        <LoaderCircle {...stylex.props(shelfSharedStyles.spinner)} size={22} strokeWidth={1.6} aria-hidden="true" />
        <span>{t('shelfOpening')}</span>
      </div>
    )
  }
  if (catalog.sourcesState === 'failed') {
    return (
      <div {...stylex.props(shelfPageStyles.emptyState)} role="alert">
        <AlertCircle {...stylex.props(shelfPageStyles.emptyIcon)} aria-hidden="true" strokeWidth={1.5} />
        <h1 {...stylex.props(shelfPageStyles.emptyTitle)}>{t('shelfCouldNotOpen')}</h1>
        <p {...stylex.props(shelfPageStyles.emptyText)}>{shelfErrorMessage(catalog.sourcesError)}</p>
        <button {...stylex.props(shelfSharedStyles.secondaryButton)} type="button" onClick={catalog.retrySources}>{t('shelfTryAgain')}</button>
      </div>
    )
  }
  if (catalog.sourcesState === 'empty') {
    return (
      <div {...stylex.props(shelfPageStyles.emptyState)}>
        <LibraryBig {...stylex.props(shelfPageStyles.emptyIcon)} size={30} strokeWidth={1.4} aria-hidden="true" />
        <h1 {...stylex.props(shelfPageStyles.emptyTitle)}>{t('shelfNoBookSources')}</h1>
        <p {...stylex.props(shelfPageStyles.emptyText)}>{t('shelfAddSourceHint')}</p>
        <button {...stylex.props(shelfSharedStyles.primaryButton)} data-shelf-action="add-source" type="button" onClick={onAddSource}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          {t('shelfAddBookSource')}
        </button>
      </div>
    )
  }
  if (!catalog.content) {
    return (
      <div {...stylex.props(shelfPageStyles.loadingState)} role="status">
        <LoaderCircle {...stylex.props(shelfSharedStyles.spinner)} size={22} strokeWidth={1.6} aria-hidden="true" />
        <span>{t('shelfLoadingSavedBooks')}</span>
      </div>
    )
  }
  if (catalog.content.kind === 'books'
    && catalog.content.matchingPublicationCount === 0
    && query.length > 0) {
    return (
      <div {...stylex.props(shelfPageStyles.emptyState)} role="status">
        <Search {...stylex.props(shelfPageStyles.emptyIcon)} aria-hidden="true" strokeWidth={1.5} />
        <h1 {...stylex.props(shelfPageStyles.emptyTitle)}>{t('shelfNoMatchingBooks')}</h1>
        <p {...stylex.props(shelfPageStyles.emptyText)}>{t('shelfTryAnotherSearch')}</p>
      </div>
    )
  }

  return (
    <>
      {contentIssueTranslation
        ? (
            <div {...stylex.props(shelfPageStyles.selectedSourceIssue)} role="status">
              <AlertCircle size={15} strokeWidth={1.9} aria-hidden="true" />
              <span>{t(contentIssueTranslation.key, contentIssueTranslation.options)}</span>
            </div>
          )
        : null}
      {catalog.content.kind === 'all-sources'
        ? (
            <AllSourcesOverview
              groups={catalog.content.groups}
              query={query}
              scrollElementRef={scrollElementRef}
              onBrowseSource={onBrowseSource}
            />
          )
        : catalog.content.kind === 'source-navigation'
          ? (
              <SourceOverview
                group={catalog.content.group}
                query={query}
                scrollElementRef={scrollElementRef}
                onBrowseCategory={onBrowseCategory}
              />
            )
          : <VirtualShelf groups={catalog.content.groups} query={query} scrollElementRef={scrollElementRef} showGroupHeadings={false} />}
      {catalog.canLoadMore
        ? (
            <footer {...stylex.props(shelfPageStyles.loadMoreFooter)}>
              <button {...stylex.props(shelfSharedStyles.secondaryButton)} disabled={catalog.paginationFetching} type="button" onClick={catalog.loadMore}>
                {catalog.paginationFetching ? <LoaderCircle {...stylex.props(shelfSharedStyles.spinner)} size={16} strokeWidth={1.9} aria-hidden="true" /> : <ArrowDown size={16} strokeWidth={1.9} aria-hidden="true" />}
                {catalog.paginationFetching ? t('shelfLoading') : t('shelfLoadMoreBooks')}
              </button>
            </footer>
          )
        : null}
    </>
  )
}

export function ShelfPage({
  pushSearch,
  replaceSearch,
  search: routeSearch,
}: {
  pushSearch: (search: ShelfSearch) => Promise<void>
  replaceSearch: (search: ShelfSearch) => Promise<void>
  search: ShelfSearch
}) {
  const { i18n, t } = useTranslation('app')
  const shelfTitle = t('shelf')
  const titlebar = useMemo(() => ({ title: shelfTitle }), [shelfTitle])
  usePageTitlebar(titlebar)
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const sourceManagementRef = useRef<ShelfSourceManagementHandle>(null)
  const sourceTriggerRef = useRef<HTMLButtonElement>(null)
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const searchQuery = routeSearch.q ?? ''
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const catalog = useShelfCatalog(routeSearch, deferredSearchQuery)
  const refreshStatusLabel = catalog.refreshing
    ? t('shelfRefreshing')
    : catalog.refreshedAt === null
      ? t('shelfShowingSavedBooks')
      : t('shelfUpdatedAt', {
          time: shelfRelativeUpdateTime(catalog.refreshedAt, i18n.resolvedLanguage ?? i18n.language),
        })

  const scrollToTop = () => scrollElementRef.current?.scrollTo({ behavior: 'auto', top: 0 })
  const selectSource = (sourceId: string | null) => {
    startTransition(() => {
      void pushSearch(sourceId ? { source: sourceId } : {})
    })
    setSourceMenuOpen(false)
    requestAnimationFrame(() => sourceTriggerRef.current?.focus())
    scrollToTop()
  }
  const browseSource = (sourceId: string) => {
    void pushSearch({ ...routeSearch, page: undefined, source: sourceId })
    scrollToTop()
  }
  const browseCategory = (sourceId: string, categoryUrl: string) => {
    void pushSearch({ ...routeSearch, page: categoryUrl, source: sourceId })
    scrollToTop()
  }

  return (
    <main {...stylex.props(shelfPageStyles.page)} aria-label={t('shelf')}>
      {catalog.sources.length > 0
        ? (
            <div {...stylex.props(shelfPageStyles.toolbarWrap)}>
              <div {...stylex.props(shelfPageStyles.toolbar)}>
                <DropdownMenu.Root
                  open={sourceMenuOpen}
                  onOpenChange={(open) => {
                    setSourceMenuOpen(open)
                    if (!open)
                      requestAnimationFrame(() => sourceTriggerRef.current?.focus())
                  }}
                >
                  <div {...stylex.props(shelfPageStyles.sourceSwitcher)}>
                    <DropdownMenu.Trigger asChild>
                      <button ref={sourceTriggerRef} {...stylex.props(shelfPageStyles.sourceTrigger)} data-ui="shelf-source-trigger" type="button">
                        <span {...stylex.props(shelfPageStyles.sourceTriggerIcon)} aria-hidden="true">
                          {catalog.selectedSource ? <Globe2 size={16} strokeWidth={1.8} /> : <LibraryBig size={16} strokeWidth={1.8} />}
                        </span>
                        <span {...stylex.props(shelfPageStyles.sourceTriggerLabel)}>{catalog.selectedSource?.name ?? t('shelfAllSources')}</span>
                        <ChevronDown size={14} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </DropdownMenu.Trigger>
                    <ShelfSourceMenu
                      open={sourceMenuOpen}
                      selectedSourceId={catalog.activeSourceId}
                      sources={catalog.sources}
                      onClose={() => {
                        setSourceMenuOpen(false)
                        requestAnimationFrame(() => sourceTriggerRef.current?.focus())
                      }}
                      onManage={() => {
                        setSourceMenuOpen(false)
                        sourceManagementRef.current?.openManagerAfterMenu()
                      }}
                      onSelect={selectSource}
                    />
                  </div>
                </DropdownMenu.Root>
                <div {...stylex.props(shelfPageStyles.toolbarTrailing)}>
                  <label {...stylex.props(shelfPageStyles.searchBox)} data-ui="shelf-search">
                    <Search size={15} strokeWidth={1.8} aria-hidden="true" />
                    <input
                      {...stylex.props(shelfPageStyles.searchInput)}
                      aria-label={t('shelfSearchBooks')}
                      placeholder={t('shelfSearchPlaceholder')}
                      type="search"
                      value={searchQuery}
                      onChange={event => void replaceSearch({
                        ...routeSearch,
                        q: event.target.value || undefined,
                      })}
                    />
                    {searchQuery.length > 0
                      ? (
                          <button {...stylex.props(shelfPageStyles.clearSearch)} aria-label={t('shelfClearSearch')} data-ui="shelf-search-clear" type="button" onClick={() => void replaceSearch({ ...routeSearch, q: undefined })}>
                            <X size={13} strokeWidth={2} aria-hidden="true" />
                          </button>
                        )
                      : null}
                  </label>
                  <button
                    {...stylex.props(shelfSharedStyles.iconButton)}
                    aria-label={t('shelfRefreshWithStatus', { status: refreshStatusLabel })}
                    disabled={catalog.refreshDisabled}
                    title={refreshStatusLabel}
                    type="button"
                    onClick={catalog.refresh}
                  >
                    <RefreshCw {...stylex.props(catalog.refreshing && shelfSharedStyles.spinner)} size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )
        : null}

      <div
        ref={scrollElementRef}
        {...stylex.props(
          shelfPageStyles.scrollViewport,
          catalog.sources.length > 0 ? shelfPageStyles.scrollViewportWithToolbar : shelfPageStyles.scrollViewportEmpty,
        )}
        data-shelf-collection=""
        aria-label={t('shelfBookCollection')}
        role="region"
      >
        <ShelfContent
          catalog={catalog}
          query={deferredSearchQuery}
          scrollElementRef={scrollElementRef}
          onAddSource={() => sourceManagementRef.current?.openAdd()}
          onBrowseCategory={browseCategory}
          onBrowseSource={browseSource}
        />
      </div>

      <ShelfSourceManagement
        ref={sourceManagementRef}
        pushSearch={pushSearch}
        replaceSearch={replaceSearch}
        routeSearch={routeSearch}
        selectedSourceId={routeSearch.source ?? null}
        sources={catalog.sources}
      />
    </main>
  )
}
