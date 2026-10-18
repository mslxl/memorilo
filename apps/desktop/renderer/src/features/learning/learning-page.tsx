import { Button, Tabs } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Link } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePageTitlebar } from '../../shared/page-titlebar'
import { learningRouteStyles } from './learning.stylex'
import { LearningNotesPanel } from './notes/learning-notes'
import { LearningOptimizerPanel } from './optimizer/learning-optimizer-panel'

const tabSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.24,
} as const
const learningTabs = [
  { id: 'notes', labelKey: 'notesTab' },
  { id: 'optimizer', labelKey: 'optimizerTab' },
] as const

export type LearningTabId = typeof learningTabs[number]['id']

export interface LearningSearch {
  view?: LearningTabId
}

function tabElementId(tabId: LearningTabId) {
  return `learning-${tabId}-tab`
}

function panelElementId(tabId: LearningTabId) {
  return `learning-${tabId}-panel`
}

export function LearningPage({
  onOpenOptimizer,
  onViewChange,
  view,
}: {
  onOpenOptimizer: (optimizerId: string) => Promise<void> | void
  onViewChange: (view: LearningTabId) => Promise<void> | void
  view?: LearningTabId
}) {
  const { t } = useTranslation('learning')
  const titlebar = useMemo(() => ({
    title: t('title'),
    trailing: (
      <Button
        asChild
        aria-label={t('startGlobalReview')}
        data-window-no-drag=""
        title={t('startGlobalReview')}
        variant="titlebar"
        xstyle={learningRouteStyles.startReviewButton}
      >
        <Link search={{ scope: 'global' }} to="/learning/review">
          <Play aria-hidden="true" fill="currentColor" size={12} strokeWidth={1.8} />
          <span>{t('startReview')}</span>
        </Link>
      </Button>
    ),
  }), [t])
  usePageTitlebar(titlebar)
  const activeTab = view ?? 'notes'
  const shouldReduceMotion = useReducedMotion()

  const selectTab = (tabId: LearningTabId) => {
    void onViewChange(tabId)
  }

  return (
    <main {...stylex.props(learningRouteStyles.page)} aria-label={t('title')} data-page="learning">
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => {
          if (value === 'notes' || value === 'optimizer')
            selectTab(value)
        }}
      >
        <div {...stylex.props(learningRouteStyles.tabRegion)}>
          <Tabs.List aria-label={t('viewsLabel')} xstyle={learningRouteStyles.tabList}>
            {learningTabs.map(tab => (
              <Tabs.Trigger
                key={tab.id}
                id={tabElementId(tab.id)}
                aria-controls={panelElementId(tab.id)}
                value={tab.id}
                xstyle={[learningRouteStyles.tab, activeTab === tab.id && learningRouteStyles.tabSelected]}
              >
                {activeTab === tab.id
                  ? (
                      <motion.span
                        {...stylex.props(learningRouteStyles.selectionIndicator)}
                        aria-hidden="true"
                        initial={false}
                        layoutId="learning-tab-selection"
                        transition={shouldReduceMotion ? { duration: 0 } : tabSpring}
                      />
                    )
                  : null}
                <span {...stylex.props(learningRouteStyles.tabLabel)}>{t(tab.labelKey)}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        <div {...stylex.props(learningRouteStyles.panelRegion)}>
          {learningTabs.map(tab => (
            <section
              key={tab.id}
              {...stylex.props(learningRouteStyles.panel)}
              id={panelElementId(tab.id)}
              aria-labelledby={tabElementId(tab.id)}
              hidden={activeTab !== tab.id}
              role="tabpanel"
            >
              {tab.id === 'notes' && activeTab === 'notes' ? <LearningNotesPanel /> : null}
              {tab.id === 'optimizer' && activeTab === 'optimizer'
                ? <LearningOptimizerPanel onOpenOptimizer={onOpenOptimizer} />
                : null}
            </section>
          ))}
        </div>
      </Tabs.Root>
    </main>
  )
}
