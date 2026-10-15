import type { ConfigurationField, ConfigurationSection, ConfigurationStore } from '@memorilo/config'
import type { DesktopConfiguration } from '@memorilo/desktop-config'
import type { TFunction } from 'i18next'
import type { CSSProperties } from 'react'
import { ConfigurationFields } from '@memorilo/config/react'
import { desktopConfigurationDefinition } from '@memorilo/desktop-config'
import { getUiThemeDefinitions, SegmentedControl, Sidebar } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { BookOpen, CalendarDays, Check, GraduationCap, HardDrive, Keyboard, NotebookPen, Plug, Server, Settings2, TabletSmartphone, Wifi } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDesktopConfiguration } from '../shared/configuration'
import { getPlatform } from '../shared/platform'
import { AssetSettings } from './asset-settings'
import { CalendarSettings } from './calendar-settings'
import { DatabaseSettings } from './database-settings'
import { DeviceSettings } from './device-settings'
import { P2pSettings } from './p2p-settings'
import { settingsShellStyles as settingsStyles } from './settings-shell.stylex'
import { SyncServerSettings } from './sync-server-settings'

type SettingsCategoryId = 'calendar' | 'device' | 'editor' | 'general' | 'learning' | 'mcp' | 'media' | 'p2p' | 'reading' | 'shortcuts' | 'sync'
type SourceSectionId = 'backup' | 'editor' | 'flashcards' | 'general' | 'goals' | 'images' | 'learning' | 'mcp' | 'reading' | 'shortcut-formatting' | 'shortcut-learning' | 'shortcut-navigation' | 'shortcut-note-structure' | 'sync-server' | 'todo'

interface SettingsCategoryDefinition {
  readonly id: SettingsCategoryId
  readonly sectionIds: readonly SourceSectionId[]
  readonly showSectionHeadings?: boolean
}

const settingsCategoryDefinitions: readonly SettingsCategoryDefinition[] = [
  { id: 'general', sectionIds: ['general'] },
  { id: 'calendar', sectionIds: ['todo'], showSectionHeadings: true },
  { id: 'editor', sectionIds: ['editor'] },
  {
    id: 'shortcuts',
    sectionIds: ['shortcut-navigation', 'shortcut-note-structure', 'shortcut-learning', 'shortcut-formatting'],
    showSectionHeadings: true,
  },
  { id: 'reading', sectionIds: ['reading'] },
  { id: 'learning', sectionIds: ['learning', 'goals', 'flashcards'], showSectionHeadings: true },
  { id: 'media', sectionIds: ['images', 'backup'], showSectionHeadings: true },
  { id: 'mcp', sectionIds: ['mcp'] },
  { id: 'device', sectionIds: [] },
  { id: 'sync', sectionIds: ['sync-server'] },
  { id: 'p2p', sectionIds: [] },
]

const learningDetailSectionIds: readonly SourceSectionId[] = ['flashcards', 'goals']

const categoryIcons = {
  calendar: CalendarDays,
  device: TabletSmartphone,
  editor: NotebookPen,
  general: Settings2,
  learning: GraduationCap,
  mcp: Plug,
  media: HardDrive,
  p2p: Wifi,
  reading: BookOpen,
  shortcuts: Keyboard,
  sync: Server,
} as const

const categoryLabelKeys: Readonly<Record<SettingsCategoryId, string>> = {
  calendar: 'calendarSection',
  device: 'deviceSection',
  editor: 'editorSection',
  general: 'generalSection',
  learning: 'learningSection',
  media: 'mediaSection',
  mcp: 'mcpSection',
  p2p: 'p2pSection',
  reading: 'readingSection',
  shortcuts: 'shortcutsSection',
  sync: 'syncServerSection',
}

const categoryDescriptionKeys: Readonly<Record<SettingsCategoryId, string>> = {
  calendar: 'calendarDescription',
  device: 'deviceDescription',
  editor: 'editorDescription',
  general: 'generalDescription',
  learning: 'learningDescription',
  media: 'mediaDescription',
  mcp: 'mcpDescription',
  p2p: 'p2pDescription',
  reading: 'readingDescription',
  shortcuts: 'shortcutsDescription',
  sync: 'syncServerSectionDescription',
}

const sectionLabelKeys: Readonly<Record<string, string>> = {
  'backup': 'backupSection',
  'editor': 'editorSection',
  'flashcards': 'flashcardsSection',
  'general': 'generalSection',
  'goals': 'goalsSection',
  'images': 'imagesSection',
  'learning': 'learningSection',
  'mcp': 'mcpSection',
  'reading': 'readingSection',
  'shortcut-formatting': 'shortcutFormattingSection',
  'shortcut-learning': 'shortcutLearningSection',
  'shortcut-navigation': 'shortcutNavigationSection',
  'shortcut-note-structure': 'shortcutNoteStructureSection',
  'sync-server': 'syncServerSection',
  'todo': 'todoSection',
}

function translateCategoryLabel(categoryId: SettingsCategoryId, t: TFunction): string {
  return t(categoryLabelKeys[categoryId])
}

function translateCategoryDescription(categoryId: SettingsCategoryId, t: TFunction): string {
  return t(categoryDescriptionKeys[categoryId])
}

function translateSectionLabel(sectionId: string, t: TFunction): string {
  const key = sectionLabelKeys[sectionId]
  return key === undefined ? sectionId : t(key)
}

const fieldLabelKeys: Readonly<Record<string, string>> = {
  'backup.enabled': 'backupEnabled',
  'backup.intervalMinutes': 'backupInterval',
  'backup.retentionCount': 'backupRetention',
  'language': 'language',
  'reduceMotion': 'reduceMotion',
  'redrawTitlebar': 'redrawTitlebar',
  'editor.cursor.animationLength': 'cursorAnimationLength',
  'editor.cursor.shortAnimationLength': 'cursorTypingAnimation',
  'editor.cursor.trailSize': 'cursorTrailSize',
  'editor.cursor.vfxMode': 'cursorParticleEffect',
  'editor.cursor.vfxOpacity': 'cursorParticleOpacity',
  'editor.cursor.vfxParticleLifetime': 'cursorParticleLifetime',
  'editor.cursor.vfxParticleDensity': 'cursorParticleDensity',
  'editor.cursor.vfxParticleSpeed': 'cursorParticleSpeed',
  'editor.cursor.smoothBlink': 'smoothCursorBlink',
  'panel.tabOrder': 'panelTabOrder',
  'defaultNoteLearningEnabled': 'defaultNoteLearningEnabled',
  'weekStart': 'weekStart',
  'outdentBehavior': 'outdentBehavior',
  'networkImagePasteBehavior': 'networkImagePasteBehavior',
  'shortcuts.back': 'shortcutBack',
  'shortcuts.bold': 'shortcutBold',
  'shortcuts.code': 'shortcutCode',
  'shortcuts.forward': 'shortcutForward',
  'shortcuts.previousNoteStructureEntry': 'shortcutPreviousNoteStructureEntry',
  'shortcuts.nextNoteStructureEntry': 'shortcutNextNoteStructureEntry',
  'shortcuts.addBasicCard': 'shortcutAddBasicCard',
  'shortcuts.highlight': 'shortcutHighlight',
  'shortcuts.addCloze': 'shortcutAddCloze',
  'shortcuts.italic': 'shortcutItalic',
  'shortcuts.strike': 'shortcutStrike',
  'shortcuts.underline': 'shortcutUnderline',
  'readerArrowKeyPageTurning': 'readerArrowKeyPageTurning',
  'readerAnnotationCopyFormat': 'readerAnnotationCopyFormat',
  'readerEpubPresentationMode': 'readerEpubPresentationMode',
  'readerPageMode': 'readerPageMode',
  'tiffConversionFormat': 'tiffConversionFormat',
  'mcp.enabled': 'mcpEnabled',
  'mcp.port': 'mcpPort',
  'mcp.accessToken': 'mcpAccessToken',
  'learning.enabled': 'learningEnabled',
  'todo.enabled': 'todoEnabled',
  'todo.autoCompleteParentTasks': 'autoCompleteParentTasks',
  'todo.blankTaskDurationMinutes': 'blankTaskDurationMinutes',
  'todo.calendarFeedAfterDays': 'calendarFeedAfterDays',
  'todo.calendarFeedBeforeDays': 'calendarFeedBeforeDays',
  'todo.calendarFeedCompleted': 'calendarFeedCompleted',
  'todo.calendarFeedTimeZone': 'calendarFeedTimeZone',
  'todo.calendarFeedUndated': 'calendarFeedUndated',
  'todo.timelineWorkdayStartMinutes': 'timelineWorkdayStartMinutes',
  'todo.timelineWorkdayEndMinutes': 'timelineWorkdayEndMinutes',
  'todo.keepDetailOpenWhenTaskLeavesView': 'keepTodoDetailOpen',
  'todo.recurringTaskCompletionAction': 'recurringTaskCompletionAction',
  'syncServer.enabled': 'syncServerEnabled',
  'syncServer.url': 'syncServerUrl',
  'syncServer.peerId': 'syncServerPeerId',
  'flashcards.newCardsPerDay': 'newCardsPerDay',
  'flashcards.newGatherOrder': 'newGatherOrder',
  'flashcards.interdayOrder': 'interdayOrder',
  'flashcards.reviewOrder': 'reviewOrder',
  'flashcards.learnAheadMinutes': 'learnAhead',
  'flashcards.studyDayStartsAtHour': 'studyDayStarts',
  'flashcards.buryNewSiblings': 'buryNewSiblings',
  'flashcards.buryReviewSiblings': 'buryReviewSiblings',
  'flashcards.buryInterdayLearningSiblings': 'buryInterdaySiblings',
  'goals.dailyLearningGoalMode': 'dailyLearningGoal',
  'goals.dailyLearningGoalCards': 'dailyLimit',
}

const fieldDescriptionKeys: Readonly<Record<string, string>> = {
  'redrawTitlebar': 'redrawTitlebarDescription',
  'backup.enabled': 'backupEnabledDescription',
  'backup.intervalMinutes': 'backupIntervalDescription',
  'backup.retentionCount': 'backupRetentionDescription',
  'outdentBehavior': 'outdentBehaviorDescription',
  'defaultNoteLearningEnabled': 'defaultNoteLearningEnabledDescription',
  'weekStart': 'weekStartDescription',
  'panel.tabOrder': 'panelTabOrderDescription',
  'networkImagePasteBehavior': 'networkImagePasteBehaviorDescription',
  'readerArrowKeyPageTurning': 'readerArrowKeyPageTurningDescription',
  'readerAnnotationCopyFormat': 'readerAnnotationCopyFormatDescription',
  'readerEpubPresentationMode': 'readerEpubPresentationModeDescription',
  'readerPageMode': 'readerPageModeDescription',
  'tiffConversionFormat': 'tiffConversionFormatDescription',
  'mcp.enabled': 'mcpEnabledDescription',
  'mcp.port': 'mcpPortDescription',
  'mcp.accessToken': 'mcpAccessTokenDescription',
  'learning.enabled': 'learningEnabledDescription',
  'todo.enabled': 'todoEnabledDescription',
  'todo.autoCompleteParentTasks': 'autoCompleteParentTasksDescription',
  'todo.blankTaskDurationMinutes': 'blankTaskDurationMinutesDescription',
  'todo.calendarFeedAfterDays': 'calendarFeedAfterDaysDescription',
  'todo.calendarFeedBeforeDays': 'calendarFeedBeforeDaysDescription',
  'todo.calendarFeedCompleted': 'calendarFeedCompletedDescription',
  'todo.calendarFeedTimeZone': 'calendarFeedTimeZoneDescription',
  'todo.calendarFeedUndated': 'calendarFeedUndatedDescription',
  'todo.timelineWorkdayStartMinutes': 'timelineWorkdayStartMinutesDescription',
  'todo.timelineWorkdayEndMinutes': 'timelineWorkdayEndMinutesDescription',
  'todo.keepDetailOpenWhenTaskLeavesView': 'keepTodoDetailOpenDescription',
  'todo.recurringTaskCompletionAction': 'recurringTaskCompletionActionDescription',
  'syncServer.enabled': 'syncServerEnabledDescription',
  'syncServer.url': 'syncServerUrlDescription',
  'syncServer.peerId': 'syncServerPeerIdDescription',
  'flashcards.newCardsPerDay': 'newCardsPerDayDescription',
  'goals.dailyLearningGoalCards': 'dailyLimitDescription',
}

const cursorFieldPaths = new Set([
  'editor.cursor.animationLength',
  'editor.cursor.shortAnimationLength',
  'editor.cursor.trailSize',
  'editor.cursor.vfxMode',
  'editor.cursor.vfxOpacity',
  'editor.cursor.vfxParticleLifetime',
  'editor.cursor.vfxParticleDensity',
  'editor.cursor.vfxParticleSpeed',
  'editor.cursor.smoothBlink',
])

const shortcutFieldPaths = new Set([
  'shortcuts.back',
  'shortcuts.bold',
  'shortcuts.code',
  'shortcuts.forward',
  'shortcuts.previousNoteStructureEntry',
  'shortcuts.nextNoteStructureEntry',
  'shortcuts.addBasicCard',
  'shortcuts.highlight',
  'shortcuts.addCloze',
  'shortcuts.italic',
  'shortcuts.strike',
  'shortcuts.underline',
])

function translateFieldLabel(field: ConfigurationField, t: TFunction): string {
  const key = fieldLabelKeys[field.path]
  return key === undefined ? field.label : t(key)
}

function translateFieldDescription(field: ConfigurationField, t: TFunction): string | undefined {
  const key = fieldDescriptionKeys[field.path]
    ?? (cursorFieldPaths.has(field.path) ? 'cursorSettingsDescription' : undefined)
    ?? (shortcutFieldPaths.has(field.path) ? 'shortcutDescription' : undefined)
  return key === undefined ? field.description : t(key)
}

const optionLabelKeys: Readonly<Record<string, string>> = {
  'after-reviews': 'afterReviews',
  'all-due': 'allDue',
  'archive-completed-to-today': 'recurringTaskArchiveCompletedToToday',
  'before-reviews': 'beforeReviews',
  'continuous': 'readerPageModeContinuous',
  'due-random': 'dueRandom',
  'download': 'networkImagePasteDownload',
  'en': 'english',
  'fixed': 'fixedDailyLimit',
  'journal-todo': 'panelJournalFirst',
  'logical': 'outdentLogical',
  'monday': 'monday',
  'mixed': 'mixedWithReviews',
  'none': 'cursorVfxNone',
  'pixiedust': 'cursorVfxPixiedust',
  'publisher': 'readerEpubPresentationPublisher',
  'random': 'randomOrder',
  'reader': 'readerEpubPresentationReader',
  'railgun': 'cursorVfxRailgun',
  'replace-completed': 'recurringTaskReplaceCompleted',
  'retrievability': 'retrievability',
  'ripple': 'cursorVfxRipple',
  'single-page': 'readerPageModeSinglePage',
  'sonicboom': 'cursorVfxSonicboom',
  'source': 'sourceOrder',
  'spread-week': 'spreadWeek',
  'system': 'systemDefault',
  'text': 'readerCopyTextOnly',
  'text-book': 'readerCopyTextBook',
  'text-book-location': 'readerCopyTextBookLocation',
  'todo-journal': 'panelTodoFirst',
  'torpedo': 'cursorVfxTorpedo',
  'traditional': 'outdentTraditional',
  'url': 'networkImagePasteUrl',
  'wireframe': 'cursorVfxWireframe',
  'show': 'show',
  'hide': 'hide',
  'today': 'today',
  'zh-CN': 'chinese',
  'sunday': 'sunday',
  'move-next-to-today': 'recurringTaskMoveNextToToday',
  'move-next-to-due-date': 'recurringTaskMoveNextToDueDate',
  'nest-completed-under-next': 'recurringTaskNestCompletedUnderNext',
  'place-next-after-completed': 'recurringTaskPlaceNextAfterCompleted',
}

const unitLabelKeys: Readonly<Record<string, string>> = {
  backups: 'backups',
  cards: 'cards',
  days: 'days',
  hour: 'hour',
  minutes: 'minutes',
}

function translateOptionLabel(value: string, t: TFunction): string {
  if (value === 'webp')
    return 'WebP'
  if (value === 'png')
    return 'PNG'
  if (value === 'jpeg')
    return 'JPEG'
  if (value === 'avif')
    return 'AVIF'
  const key = optionLabelKeys[value]
  return key === undefined ? value : t(key)
}

function translateUnit(unit: string | undefined, t: TFunction): string | undefined {
  const key = unit === undefined ? undefined : unitLabelKeys[unit]
  return key === undefined ? unit : t(key)
}

function localizeSection(section: ConfigurationSection, t: TFunction): ConfigurationSection {
  return {
    ...section,
    label: translateSectionLabel(section.id, t),
    fields: section.fields.map((field) => {
      if (field.control === 'select' || field.control === 'segmented') {
        return {
          ...field,
          description: translateFieldDescription(field, t),
          label: translateFieldLabel(field, t),
          options: field.options.map(option => ({
            ...option,
            label: translateOptionLabel(option.value, t),
          })),
        }
      }
      return {
        ...field,
        description: translateFieldDescription(field, t),
        label: translateFieldLabel(field, t),
        ...(field.control === 'number' ? { unit: translateUnit(field.unit, t) } : {}),
      }
    }),
  }
}

interface SettingsCategory {
  readonly description: string
  readonly id: SettingsCategoryId
  readonly label: string
  readonly sections: readonly ConfigurationSection[]
  readonly showSectionHeadings: boolean
}

function buildSettingsCategories(
  sections: readonly ConfigurationSection[],
  t: TFunction,
  learningEnabled: boolean,
): readonly SettingsCategory[] {
  const sectionsById = new Map(sections.map(section => [section.id, section]))
  return settingsCategoryDefinitions.map((definition) => {
    const categorySections = definition.sectionIds
      .map((sectionId) => {
        const section = sectionsById.get(sectionId)
        if (!section)
          throw new Error(`Settings category ${definition.id} references missing section ${sectionId}`)
        return { id: sectionId, section }
      })
      .filter(({ id }) => learningEnabled || !learningDetailSectionIds.includes(id))
      .map(({ section }) => section)
    return {
      description: translateCategoryDescription(definition.id, t),
      id: definition.id,
      label: translateCategoryLabel(definition.id, t),
      sections: categorySections,
      showSectionHeadings: definition.showSectionHeadings === true,
    }
  })
}

function SettingsFieldsGroup({
  first,
  section,
  showHeading,
  store,
}: {
  first: boolean
  section: ConfigurationSection
  showHeading: boolean
  store: ConfigurationStore<DesktopConfiguration>
}) {
  const fields = (
    <div {...stylex.props(settingsStyles.settingsGroup)} data-window-no-drag="">
      <ConfigurationFields fields={section.fields} store={store} />
    </div>
  )

  if (!showHeading)
    return fields

  const headingId = `${section.id}-settings-heading`
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        {...stylex.props(settingsStyles.sectionTitle, first && settingsStyles.sectionTitleFirst)}
      >
        {section.label}
      </h2>
      {fields}
    </section>
  )
}

function ThemeGallery({ store }: { store: ConfigurationStore<DesktopConfiguration> }) {
  const { t } = useTranslation('settings')
  const configuration = useDesktopConfiguration()
  const appearanceOptions = [
    { label: t('themeSystem'), value: 'system' },
    { label: t('themeLight'), value: 'light' },
    { label: t('themeDark'), value: 'dark' },
  ] as const

  return (
    <section {...stylex.props(settingsStyles.themeSection)} aria-labelledby="theme-settings-heading">
      <h2 id="theme-settings-heading" {...stylex.props(settingsStyles.sectionTitle, settingsStyles.sectionTitleFirst)}>
        {t('themeSection')}
      </h2>
      <fieldset {...stylex.props(settingsStyles.themeGallery)} aria-label={t('themeFamily')}>
        <legend {...stylex.props(settingsStyles.themeLegend)}>{t('themeFamily')}</legend>
        {getUiThemeDefinitions().map((definition) => {
          const selected = configuration.theme.family === definition.id
          const label = t(definition.labelKey)
          const description = t(definition.descriptionKey)
          const previewStyle = {
            backgroundColor: definition.preview.canvas,
          } as CSSProperties
          return (
            <label
              key={definition.id}
              {...stylex.props(settingsStyles.themeCard, selected && settingsStyles.themeCardSelected)}
            >
              <input
                {...stylex.props(settingsStyles.themeInput)}
                aria-label={label}
                checked={selected}
                name="theme-family"
                type="radio"
                value={definition.id}
                onChange={() => void store.setValue('theme.family', definition.id)}
              />
              <div {...stylex.props(settingsStyles.themePreview)} style={previewStyle}>
                <div {...stylex.props(settingsStyles.themePreviewSidebar)} style={{ backgroundColor: definition.preview.surface }} />
                <div {...stylex.props(settingsStyles.themePreviewContent)} style={{ backgroundColor: definition.preview.surface }}>
                  <div {...stylex.props(settingsStyles.themePreviewAccent)} style={{ backgroundColor: definition.preview.accent }} />
                  <div {...stylex.props(settingsStyles.themePreviewLine)} />
                  <div {...stylex.props(settingsStyles.themePreviewLine)} style={{ width: '52%' }} />
                </div>
              </div>
              <div {...stylex.props(settingsStyles.themeCardHeader)}>
                <span {...stylex.props(settingsStyles.themeCardName)}>{label}</span>
                {selected ? <span {...stylex.props(settingsStyles.themeSelection)} aria-hidden="true"><Check size="1em" strokeWidth={3} /></span> : null}
              </div>
              <p {...stylex.props(settingsStyles.themeCardDescription)}>{description}</p>
            </label>
          )
        })}
      </fieldset>
      <div {...stylex.props(settingsStyles.appearanceRow)}>
        <span {...stylex.props(settingsStyles.appearanceLabel)}>{t('themeAppearance')}</span>
        <SegmentedControl.Root
          value={configuration.theme.appearance}
          onValueChange={value => void store.setValue('theme.appearance', value)}
        >
          {appearanceOptions.map(option => (
            <SegmentedControl.Item key={option.value} value={option.value}>{option.label}</SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </div>
      <p {...stylex.props(settingsStyles.themeStatus)} role="status">{t('themeSaved')}</p>
    </section>
  )
}

export function Settings({ store }: { store: ConfigurationStore<DesktopConfiguration> }) {
  const { t } = useTranslation('settings')
  const configuration = useDesktopConfiguration()
  const platform = getPlatform()
  const supportsRedrawnTitlebar = platform === 'windows' || platform === 'linux'
  const localizedSections = desktopConfigurationDefinition.sections.map(section => localizeSection({
    ...section,
    fields: section.fields.filter(field => field.path !== 'redrawTitlebar' || supportsRedrawnTitlebar),
  }, t))
  const categories = buildSettingsCategories(localizedSections, t, configuration.learning.enabled)
  const [activeCategoryId, setActiveCategoryId] = useState<SettingsCategoryId>('general')
  const shouldReduceMotion = useReducedMotion()
  const activeCategory = categories.find(category => category.id === activeCategoryId)
  const windowProps = stylex.props(settingsStyles.window)

  if (!activeCategory)
    throw new Error(`Settings has no active category matching ${activeCategoryId}`)

  return (
    <main
      {...windowProps}
      className={windowProps.className}
    >
      <div {...stylex.props(settingsStyles.dragRegion)} data-window-drag="" />
      <div {...stylex.props(settingsStyles.layout)}>
        <Sidebar.Root aria-label={t('categories')} variant="settings">
          <Sidebar.Header>{t('title')}</Sidebar.Header>
          <Sidebar.Navigation aria-label={t('categories')}>
            {categories.map((category) => {
              const Icon = categoryIcons[category.id]
              const selected = category.id === activeCategory.id
              return (
                <Sidebar.Item
                  key={category.id}
                  aria-current={selected ? 'page' : undefined}
                  data-state={selected ? 'active' : 'inactive'}
                  onClick={() => setActiveCategoryId(category.id)}
                >
                  <Sidebar.ItemIcon active={selected}><Icon aria-hidden="true" size={16} strokeWidth={2} /></Sidebar.ItemIcon>
                  <Sidebar.ItemLabel active={selected}>{category.label}</Sidebar.ItemLabel>
                </Sidebar.Item>
              )
            })}
          </Sidebar.Navigation>
        </Sidebar.Root>

        <section {...stylex.props(settingsStyles.contentPane)} aria-labelledby="active-settings-heading">
          <div data-settings-content-scroll="true" {...stylex.props(settingsStyles.contentScroll)}>
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={activeCategory.id}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -5 }}
                initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <header {...stylex.props(settingsStyles.contentHeader)}>
                  <h1 id="active-settings-heading" {...stylex.props(settingsStyles.pageTitle)}>{activeCategory.label}</h1>
                  <p {...stylex.props(settingsStyles.pageDescription)}>
                    {activeCategory.description}
                  </p>
                </header>
                {activeCategory.id === 'general' ? <ThemeGallery store={store} /> : null}
                {activeCategory.id === 'device' ? <DeviceSettings /> : null}
                {activeCategory.id === 'sync' ? <SyncServerSettings /> : null}
                {activeCategory.id === 'p2p' ? <P2pSettings /> : null}
                {activeCategory.sections.map((section, index) => (
                  <Fragment key={section.id}>
                    <SettingsFieldsGroup
                      first={index === 0}
                      section={section}
                      showHeading={activeCategory.showSectionHeadings}
                      store={store}
                    />
                    {section.id === 'images' ? <AssetSettings /> : null}
                    {section.id === 'backup' ? <DatabaseSettings /> : null}
                    {section.id === 'todo' ? <CalendarSettings /> : null}
                  </Fragment>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </div>
    </main>
  )
}
