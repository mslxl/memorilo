export const desktopConfigurationChangedChannel = 'memorilo:configuration-changed'

export type DesktopLanguage = 'en' | 'system' | 'zh-CN'
export type DesktopThemeFamily = 'liquid-glass' | 'fluent' | 'neubrutalism'
export type DesktopThemeAppearance = 'system' | 'light' | 'dark'
export type DesktopOutdentBehavior = 'logical' | 'traditional'
export type DesktopDailyGoalMode = 'all-due' | 'fixed' | 'spread-week'
export type DesktopNetworkImagePasteBehavior = 'download' | 'url'
export type DesktopReaderEpubPresentationMode = 'publisher' | 'reader'
export type DesktopReaderPageMode = 'continuous' | 'single-page'
export type DesktopReaderAnnotationCopyFormat = 'text' | 'text-book' | 'text-book-location'
export type DesktopTiffConversionFormat = 'avif' | 'jpeg' | 'png' | 'webp'
export type DesktopWeekStart = 'monday' | 'sunday'
export type DesktopPanelTabOrder = 'journal-todo' | 'todo-journal'
export type DesktopRecurringTaskCompletionAction
  = | 'archive-completed-to-today'
    | 'move-next-to-today'
    | 'move-next-to-due-date'
    | 'nest-completed-under-next'
    | 'place-next-after-completed'
    | 'replace-completed'

export interface DesktopBackupConfiguration {
  enabled: boolean
  intervalMinutes: number
  retentionCount: number
}

export interface DesktopFlashcardConfiguration {
  buryInterdayLearningSiblings: boolean
  buryNewSiblings: boolean
  buryReviewSiblings: boolean
  interdayOrder: 'after-reviews' | 'before-reviews' | 'mixed'
  learnAheadMinutes: number
  newCardsPerDay: number
  newGatherOrder: 'random' | 'source'
  reviewOrder: 'due-random' | 'retrievability'
  studyDayStartsAtHour: number
}

export interface DesktopGoalConfiguration {
  dailyLearningGoalCards: number
  dailyLearningGoalMode: DesktopDailyGoalMode
}

export interface DesktopLearningConfiguration {
  enabled: boolean
}

export interface DesktopPanelConfiguration {
  tabOrder: DesktopPanelTabOrder
}

export type DesktopCursorVfxMode = 'none' | 'railgun' | 'torpedo' | 'pixiedust' | 'sonicboom' | 'ripple' | 'wireframe'

export interface DesktopCursorConfiguration {
  animationLength: number
  shortAnimationLength: number
  trailSize: number
  vfxMode: DesktopCursorVfxMode
  vfxOpacity: number
  vfxParticleLifetime: number
  vfxParticleDensity: number
  vfxParticleSpeed: number
  smoothBlink: boolean
}

export interface DesktopThemePreference {
  family: DesktopThemeFamily
  appearance: DesktopThemeAppearance
}

export interface DesktopMcpConfiguration {
  accessToken: string
  enabled: boolean
  port: number
}

export interface DesktopSyncServerConfiguration {
  enabled: boolean
  peerId: string
  url: string
  generation: number
  membershipEpoch: number
  policyEpoch: number
  modes: readonly ('relay' | 'authoritative')[]
}

export interface DesktopTodoConfiguration {
  autoCompleteParentTasks: boolean
  blankTaskDurationMinutes: number
  calendarFeedAfterDays: number
  calendarFeedBeforeDays: number
  calendarFeedCompleted: 'hide' | 'show'
  calendarFeedTimeZone: string
  calendarFeedUndated: 'hide' | 'today'
  enabled: boolean
  keepDetailOpenWhenTaskLeavesView: boolean
  recurringTaskCompletionAction: DesktopRecurringTaskCompletionAction
  timelineWorkdayEndMinutes: number
  timelineWorkdayStartMinutes: number
}

export interface DesktopShortcutConfiguration {
  addBasicCard: string
  addCloze: string
  back: string
  bold: string
  code: string
  forward: string
  highlight: string
  italic: string
  nextNoteStructureEntry: string
  previousNoteStructureEntry: string
  strike: string
  underline: string
}

export interface DesktopConfiguration {
  backup: DesktopBackupConfiguration
  defaultNoteLearningEnabled: boolean
  editor: { cursor: DesktopCursorConfiguration }
  flashcards: DesktopFlashcardConfiguration
  goals: DesktopGoalConfiguration
  learning: DesktopLearningConfiguration
  language: DesktopLanguage
  panel: DesktopPanelConfiguration
  theme: DesktopThemePreference
  mcp: DesktopMcpConfiguration
  networkImagePasteBehavior: DesktopNetworkImagePasteBehavior
  outdentBehavior: DesktopOutdentBehavior
  readerArrowKeyPageTurning: boolean
  readerAnnotationCopyFormat: DesktopReaderAnnotationCopyFormat
  readerEpubPresentationMode: DesktopReaderEpubPresentationMode
  readerPageMode: DesktopReaderPageMode
  redrawTitlebar: boolean
  reduceMotion: boolean
  shortcuts: DesktopShortcutConfiguration
  syncServer: DesktopSyncServerConfiguration
  tiffConversionFormat: DesktopTiffConversionFormat
  todo: DesktopTodoConfiguration
  weekStart: DesktopWeekStart
}
