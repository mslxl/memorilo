import type { ShelfBrowseGroup, ShelfNavigationItem } from '@memorilo/shelf'
import type { RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Globe2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { desktopRequests } from '../../../shared/desktop-requests'
import { desktopEffect, shelfEffectQuery } from '../shelf-query'
import {
  HorizontalPublicationShelf,
  ShelfPreviewState,
} from './shelf-publication-horizontal'
import { useLoadWhenVisible } from './shelf-publication-layout'
import { shelfPublicationStyles } from './shelf-publication.stylex'

function useShelfPreview(sourceId: string, pageUrl: string | null, enabled: boolean) {
  return useQuery(shelfEffectQuery.queryOptions({
    enabled: enabled && pageUrl !== null,
    queryFn: () => desktopEffect('shelf.refresh-preview', () => {
      if (pageUrl === null)
        throw new Error('Shelf preview page URL is missing')
      return desktopRequests.refreshShelfView({ pageUrl, sourceId })
    }),
    queryKey: ['shelf-view', 'preview', sourceId, pageUrl],
    retry: false,
    staleTime: 60_000,
  }))
}

function CategoryPreviewContent({
  ariaLabel,
  isVisible,
  pageUrl,
  query,
  scrollElementRef,
  sourceId,
}: {
  ariaLabel: string
  isVisible: boolean
  pageUrl: string
  query: string
  scrollElementRef: RefObject<HTMLDivElement | null>
  sourceId: string
}) {
  const previewQuery = useShelfPreview(sourceId, pageUrl, isVisible)
  const group = previewQuery.data?.groups.find(candidate => candidate.source.id === sourceId)

  if (!isVisible || previewQuery.isPending)
    return <ShelfPreviewState isLoading issue={null} publications={[]} query={query} />

  if (!group)
    throw new Error(`Shelf preview is missing source ${sourceId}`)

  if (group.page === null)
    return <ShelfPreviewState isLoading={false} issue={group.issue} publications={[]} query={query} />

  return (
    <HorizontalPublicationShelf
      ariaLabel={ariaLabel}
      includeNavigation
      initialGroup={group}
      isVisible={isVisible}
      query={query}
      scrollElementRef={scrollElementRef}
    />
  )
}

function SourcePreviewSection({
  group,
  onBrowseSource,
  query,
  scrollElementRef,
}: {
  group: ShelfBrowseGroup
  onBrowseSource: (sourceId: string) => void
  query: string
  scrollElementRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation('app')
  const [visibilityRef, isVisible] = useLoadWhenVisible(scrollElementRef)

  return (
    <div ref={visibilityRef}>
      <section {...stylex.props(shelfPublicationStyles.overviewSection)} data-shelf-source-preview="" aria-label={group.source.name} role="region">
        <header {...stylex.props(shelfPublicationStyles.overviewHeader)}>
          <button
            {...stylex.props(shelfPublicationStyles.overviewHeadingAction)}
            aria-label={t('shelfOpenSource', { name: group.source.name })}
            data-shelf-action="open-source"
            type="button"
            onClick={() => onBrowseSource(group.source.id)}
          >
            <span {...stylex.props(shelfPublicationStyles.sourceGlyph)} aria-hidden="true">
              <Globe2 size={15} strokeWidth={1.8} />
            </span>
            <div {...stylex.props(shelfPublicationStyles.overviewTitleStack)}>
              <h2 {...stylex.props(shelfPublicationStyles.overviewTitle)}>{group.source.name}</h2>
            </div>
            <ChevronRight {...stylex.props(shelfPublicationStyles.catalogChevron)} size={14} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </header>
        {group.page
          ? (
              <HorizontalPublicationShelf
                ariaLabel={t('shelfBooksFrom', { name: group.source.name })}
                includeNavigation
                initialGroup={group}
                isVisible={isVisible}
                query={query}
                scrollElementRef={scrollElementRef}
              />
            )
          : <ShelfPreviewState isLoading={false} issue={group.issue} publications={[]} query={query} />}
      </section>
    </div>
  )
}

function CategoryPreviewSection({
  category,
  onBrowseCategory,
  query,
  scrollElementRef,
  sourceId,
}: {
  category: ShelfNavigationItem
  onBrowseCategory: (sourceId: string, pageUrl: string) => void
  query: string
  scrollElementRef: RefObject<HTMLDivElement | null>
  sourceId: string
}) {
  const { t } = useTranslation('app')
  const [visibilityRef, isVisible] = useLoadWhenVisible(scrollElementRef)

  return (
    <div ref={visibilityRef}>
      <section {...stylex.props(shelfPublicationStyles.overviewSection)} aria-label={category.title} role="region">
        <button {...stylex.props(shelfPublicationStyles.catalogSectionHeader)} type="button" onClick={() => onBrowseCategory(sourceId, category.href)}>
          <span {...stylex.props(shelfPublicationStyles.overviewTitleStack)}>
            <span {...stylex.props(shelfPublicationStyles.overviewTitle)}>{category.title}</span>
            {category.subtitle ? <span {...stylex.props(shelfPublicationStyles.overviewSubtitle)}>{category.subtitle}</span> : null}
          </span>
          <ChevronRight {...stylex.props(shelfPublicationStyles.catalogChevron)} size={14} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <CategoryPreviewContent
          ariaLabel={t('shelfBooksIn', { title: category.title })}
          isVisible={isVisible}
          pageUrl={category.href}
          query={query}
          scrollElementRef={scrollElementRef}
          sourceId={sourceId}
        />
      </section>
    </div>
  )
}

export function AllSourcesOverview({
  groups,
  onBrowseSource,
  query,
  scrollElementRef,
}: {
  groups: readonly ShelfBrowseGroup[]
  onBrowseSource: (sourceId: string) => void
  query: string
  scrollElementRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div {...stylex.props(shelfPublicationStyles.overviewCollection)}>
      {groups.map(group => (
        <SourcePreviewSection
          key={group.source.id}
          group={group}
          onBrowseSource={onBrowseSource}
          query={query}
          scrollElementRef={scrollElementRef}
        />
      ))}
    </div>
  )
}

export function SourceOverview({
  group,
  onBrowseCategory,
  query,
  scrollElementRef,
}: {
  group: ShelfBrowseGroup
  onBrowseCategory: (sourceId: string, pageUrl: string) => void
  query: string
  scrollElementRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation('app')
  const hasRootPublicationFeed = group.page !== null
    && (group.page.publications.length > 0 || group.page.nextUrl !== null)
  return (
    <div {...stylex.props(shelfPublicationStyles.overviewCollection)}>
      <header {...stylex.props(shelfPublicationStyles.browserHeader)}>
        <h1 {...stylex.props(shelfPublicationStyles.browserTitle)}>{group.page?.title ?? group.source.name}</h1>
        {group.page?.subtitle ? <p {...stylex.props(shelfPublicationStyles.browserSubtitle)}>{group.page.subtitle}</p> : null}
      </header>
      {hasRootPublicationFeed
        ? (
            <section {...stylex.props(shelfPublicationStyles.overviewSection)} aria-label={t('shelfAllBooks')} role="region">
              <header {...stylex.props(shelfPublicationStyles.overviewHeader)}>
                <h2 {...stylex.props(shelfPublicationStyles.overviewTitle)}>{t('shelfBooks')}</h2>
              </header>
              <HorizontalPublicationShelf
                ariaLabel={t('shelfBooksIn', { title: group.page?.title ?? group.source.name })}
                includeNavigation={false}
                initialGroup={group}
                isVisible
                query={query}
                scrollElementRef={scrollElementRef}
              />
            </section>
          )
        : null}
      {group.page?.navigation.map(category => (
        <CategoryPreviewSection
          key={category.href}
          category={category}
          onBrowseCategory={onBrowseCategory}
          query={query}
          scrollElementRef={scrollElementRef}
          sourceId={group.source.id}
        />
      ))}
    </div>
  )
}
