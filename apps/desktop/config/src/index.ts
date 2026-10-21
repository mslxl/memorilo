import type { DesktopThemeFamily } from './contract'
import { defineConfiguration } from '@memorilo/config'
import * as Schema from 'effect/Schema'

export type {
  DesktopBackupConfiguration,
  DesktopConfiguration,
  DesktopCursorConfiguration,
  DesktopCursorVfxMode,
  DesktopDailyGoalMode,
  DesktopFlashcardConfiguration,
  DesktopGoalConfiguration,
  DesktopLanguage,
  DesktopLearningConfiguration,
  DesktopMcpConfiguration,
  DesktopNetworkImagePasteBehavior,
  DesktopOutdentBehavior,
  DesktopPanelConfiguration,
  DesktopPanelTabOrder,
  DesktopReaderAnnotationCopyFormat,
  DesktopReaderEpubPresentationMode,
  DesktopReaderPageMode,
  DesktopRecurringTaskCompletionAction,
  DesktopShortcutConfiguration,
  DesktopSyncServerConfiguration,
  DesktopThemeAppearance,
  DesktopThemeFamily,
  DesktopThemePreference,
  DesktopTiffConversionFormat,
  DesktopTodoConfiguration,
  DesktopWeekStart,
} from './contract'
export { desktopConfigurationChangedChannel } from './contract'

export const defaultDesktopOutdentBehavior = 'logical' as const

function defaultDesktopThemeFamily(): DesktopThemeFamily {
  // The configuration package is also bundled into the renderer, so avoid a node-only import here.
  // eslint-disable-next-line node/prefer-global/process
  const platform = typeof globalThis.process?.platform === 'string' ? globalThis.process.platform : undefined
  if (platform === 'darwin')
    return 'liquid-glass'
  if (platform === 'win32' || platform === 'linux')
    return 'fluent'
  const navigatorPlatform = typeof navigator === 'undefined' ? '' : navigator.platform
  return /Mac|iPhone|iPad|iPod/i.test(navigatorPlatform) ? 'liquid-glass' : 'fluent'
}

function defaultShortcutModifier(): 'Ctrl' | 'Mod' {
  // Keep configurable defaults aligned with ProseMirror's platform-aware Mod key.
  // eslint-disable-next-line node/prefer-global/process
  const platform = typeof globalThis.process?.platform === 'string' ? globalThis.process.platform : undefined
  const navigatorPlatform = typeof navigator === 'undefined' ? '' : navigator.platform
  return platform === 'darwin' || /Mac|iPhone|iPad|iPod/i.test(navigatorPlatform) ? 'Mod' : 'Ctrl'
}

const defaultFlashcardConfiguration = {
  buryInterdayLearningSiblings: true,
  buryNewSiblings: true,
  buryReviewSiblings: true,
  interdayOrder: 'before-reviews',
  learnAheadMinutes: 20,
  newCardsPerDay: 20,
  newGatherOrder: 'source',
  reviewOrder: 'due-random',
  studyDayStartsAtHour: 4,
} as const

const defaultGoalConfiguration = {
  dailyLearningGoalCards: 30,
  dailyLearningGoalMode: 'spread-week',
} as const

const defaultShortcutConfiguration = {
  addBasicCard: 'Alt+A',
  addCloze: 'Alt+Z',
  back: 'Alt+Left',
  bold: `${defaultShortcutModifier()}+B`,
  code: `${defaultShortcutModifier()}+E`,
  forward: 'Alt+Right',
  highlight: 'Alt+X',
  italic: `${defaultShortcutModifier()}+I`,
  nextNoteStructureEntry: 'Alt+PageDown',
  previousNoteStructureEntry: 'Alt+PageUp',
  strike: `${defaultShortcutModifier()}+S`,
  underline: `${defaultShortcutModifier()}+U`,
} as const

export const DesktopConfigurationSchema = Schema.Struct({
  backup: Schema.Struct({
    enabled: Schema.Boolean,
    intervalMinutes: Schema.Int.check(Schema.isBetween({ maximum: 10_080, minimum: 1 })),
    retentionCount: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  }),
  defaultNoteLearningEnabled: Schema.Boolean,
  flashcards: Schema.Struct({
    buryInterdayLearningSiblings: Schema.Boolean,
    buryNewSiblings: Schema.Boolean,
    buryReviewSiblings: Schema.Boolean,
    interdayOrder: Schema.Literals(['after-reviews', 'before-reviews', 'mixed']),
    learnAheadMinutes: Schema.Int.check(Schema.isBetween({ maximum: 1_440, minimum: 0 })),
    newCardsPerDay: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
    newGatherOrder: Schema.Literals(['random', 'source']),
    reviewOrder: Schema.Literals(['due-random', 'retrievability']),
    studyDayStartsAtHour: Schema.Int.check(Schema.isBetween({ maximum: 23, minimum: 0 })),
  }),
  goals: Schema.Struct({
    dailyLearningGoalCards: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 1 })),
    dailyLearningGoalMode: Schema.Literals(['all-due', 'fixed', 'spread-week']),
  }),
  learning: Schema.Struct({
    enabled: Schema.Boolean,
  }),
  language: Schema.Literals(['system', 'en', 'zh-CN']),
  panel: Schema.Struct({
    tabOrder: Schema.Literals(['journal-todo', 'todo-journal']),
  }),
  editor: Schema.Struct({
    cursor: Schema.Struct({
      animationLength: Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
      shortAnimationLength: Schema.Number.check(Schema.isBetween({ maximum: 0.5, minimum: 0 })),
      trailSize: Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
      vfxMode: Schema.Literals(['none', 'railgun', 'torpedo', 'pixiedust', 'sonicboom', 'ripple', 'wireframe']),
      vfxOpacity: Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 })),
      vfxParticleLifetime: Schema.Number.check(Schema.isBetween({ maximum: 5, minimum: 0.05 })),
      vfxParticleDensity: Schema.Number.check(Schema.isBetween({ maximum: 20, minimum: 0 })),
      vfxParticleSpeed: Schema.Number.check(Schema.isBetween({ maximum: 200, minimum: 0 })),
      smoothBlink: Schema.Boolean,
    }),
  }),
  theme: Schema.Struct({
    appearance: Schema.Literals(['system', 'light', 'dark']),
    family: Schema.Literals(['liquid-glass', 'fluent', 'neubrutalism']),
  }),
  mcp: Schema.Struct({
    accessToken: Schema.String,
    enabled: Schema.Boolean,
    port: Schema.Int.check(Schema.isBetween({ maximum: 65535, minimum: 1024 })),
  }),
  networkImagePasteBehavior: Schema.Literals(['download', 'url']),
  outdentBehavior: Schema.Literals(['logical', 'traditional']),
  readerArrowKeyPageTurning: Schema.Boolean,
  readerAnnotationCopyFormat: Schema.Literals(['text', 'text-book', 'text-book-location']),
  readerEpubPresentationMode: Schema.Literals(['publisher', 'reader']),
  readerPageMode: Schema.Literals(['continuous', 'single-page']),
  redrawTitlebar: Schema.Boolean,
  reduceMotion: Schema.Boolean,
  shortcuts: Schema.Struct({
    addBasicCard: Schema.String,
    addCloze: Schema.String,
    back: Schema.String,
    bold: Schema.String,
    code: Schema.String,
    forward: Schema.String,
    highlight: Schema.String,
    italic: Schema.String,
    nextNoteStructureEntry: Schema.String,
    previousNoteStructureEntry: Schema.String,
    strike: Schema.String,
    underline: Schema.String,
  }),
  syncServer: Schema.Struct({
    enabled: Schema.Boolean,
    generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    membershipEpoch: Schema.Int.check(Schema.isGreaterThan(0)),
    modes: Schema.Array(Schema.Literals(['relay', 'authoritative'])),
    peerId: Schema.String,
    policyEpoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    url: Schema.String,
  }),
  tiffConversionFormat: Schema.Literals(['avif', 'jpeg', 'png', 'webp']),
  todo: Schema.Struct({
    autoCompleteParentTasks: Schema.Boolean,
    blankTaskDurationMinutes: Schema.Int.check(Schema.isBetween({ maximum: 1_440, minimum: 0 })),
    calendarFeedAfterDays: Schema.Int.check(Schema.isBetween({ maximum: 3_660, minimum: 0 })),
    calendarFeedBeforeDays: Schema.Int.check(Schema.isBetween({ maximum: 3_660, minimum: 0 })),
    calendarFeedCompleted: Schema.Literals(['hide', 'show']),
    calendarFeedTimeZone: Schema.String,
    calendarFeedUndated: Schema.Literals(['hide', 'today']),
    enabled: Schema.Boolean,
    keepDetailOpenWhenTaskLeavesView: Schema.Boolean,
    recurringTaskCompletionAction: Schema.Literals([
      'archive-completed-to-today',
      'move-next-to-today',
      'move-next-to-due-date',
      'nest-completed-under-next',
      'place-next-after-completed',
      'replace-completed',
    ]),
    timelineWorkdayEndMinutes: Schema.Int.check(Schema.isBetween({ maximum: 1_439, minimum: 1 })),
    timelineWorkdayStartMinutes: Schema.Int.check(Schema.isBetween({ maximum: 1_439, minimum: 0 })),
  }),
  weekStart: Schema.Literals(['monday', 'sunday']),
}).check(Schema.makeFilter(configuration => configuration.mcp.enabled && configuration.mcp.accessToken.length < 32
  ? { message: 'MCP requires an access token containing at least 32 characters', path: ['mcp', 'accessToken'] }
  : configuration.todo.timelineWorkdayEndMinutes <= configuration.todo.timelineWorkdayStartMinutes
    ? { message: 'Todo workday end must be later than its start', path: ['todo', 'timelineWorkdayEndMinutes'] }
    : undefined))

export const desktopConfigurationDefinition = defineConfiguration({
  defaults: {
    backup: {
      enabled: true,
      intervalMinutes: 1_440,
      retentionCount: 7,
    },
    defaultNoteLearningEnabled: true,
    editor: {
      cursor: {
        animationLength: 0.15,
        shortAnimationLength: 0.04,
        trailSize: 1,
        vfxMode: 'none' as const,
        vfxOpacity: 200,
        vfxParticleLifetime: 0.5,
        vfxParticleDensity: 0.7,
        vfxParticleSpeed: 10,
        smoothBlink: true,
      },
    },
    flashcards: defaultFlashcardConfiguration,
    goals: defaultGoalConfiguration,
    learning: {
      enabled: true,
    },
    language: 'system' as const,
    panel: {
      tabOrder: 'todo-journal' as const,
    },
    theme: {
      appearance: 'system' as const,
      family: defaultDesktopThemeFamily(),
    },
    mcp: {
      accessToken: '',
      enabled: false,
      port: 8765,
    },
    networkImagePasteBehavior: 'download' as const,
    outdentBehavior: defaultDesktopOutdentBehavior,
    readerArrowKeyPageTurning: true,
    readerAnnotationCopyFormat: 'text' as const,
    readerEpubPresentationMode: 'publisher' as const,
    readerPageMode: 'continuous' as const,
    redrawTitlebar: true,
    reduceMotion: false,
    shortcuts: defaultShortcutConfiguration,
    syncServer: {
      enabled: false,
      generation: 0,
      membershipEpoch: 1,
      modes: ['relay', 'authoritative'] as ('relay' | 'authoritative')[],
      peerId: '',
      policyEpoch: 0,
      url: '',
    },
    tiffConversionFormat: 'webp' as const,
    todo: {
      autoCompleteParentTasks: true,
      blankTaskDurationMinutes: 0,
      calendarFeedAfterDays: 365,
      calendarFeedBeforeDays: 30,
      calendarFeedCompleted: 'hide' as const,
      calendarFeedTimeZone: 'UTC',
      calendarFeedUndated: 'today' as const,
      enabled: true,
      keepDetailOpenWhenTaskLeavesView: true,
      recurringTaskCompletionAction: 'archive-completed-to-today' as const,
      timelineWorkdayEndMinutes: 21 * 60,
      timelineWorkdayStartMinutes: 7 * 60,
    },
    weekStart: 'sunday' as const,
  },
  id: 'memorilo-desktop',
  schema: DesktopConfigurationSchema,
  sections: [{
    fields: [
      {
        control: 'select',
        label: 'Language',
        options: [
          { label: 'System Default', value: 'system' },
          { label: 'English', value: 'en' },
          { label: '简体中文', value: 'zh-CN' },
        ],
        path: 'language',
      },
      {
        control: 'segmented',
        description: 'Choose the first day shown in calendars.',
        label: 'First day of week',
        options: [
          { label: 'Sunday', value: 'sunday' },
          { label: 'Monday', value: 'monday' },
        ],
        path: 'weekStart',
      },
      {
        control: 'toggle',
        label: 'Reduce motion',
        path: 'reduceMotion',
      },
      {
        control: 'toggle',
        description: 'Place the application menus beside Memorilo. Turn off to use the system title bar. Takes effect after restarting the app.',
        label: 'Enable redrawn title bar',
        path: 'redrawTitlebar',
      },
      {
        control: 'select',
        description: 'Choose which tab appears first in the tray panel.',
        label: 'Tray panel tab order',
        options: [
          { label: 'Todo first', value: 'todo-journal' },
          { label: 'Journal first', value: 'journal-todo' },
        ],
        path: 'panel.tabOrder',
      },
    ],
    id: 'general',
    label: 'General',
  }, {
    fields: [{
      control: 'toggle',
      description: 'Show the Todo workspace without changing Todo blocks inside the editor.',
      label: 'Enable Todo workspace',
      path: 'todo.enabled',
    }, {
      control: 'toggle',
      description: 'Complete a Todo parent when all of its direct Todo children are complete, and reopen it when one is reopened.',
      label: 'Auto-complete parent Todos',
      path: 'todo.autoCompleteParentTasks',
    }, {
      control: 'number',
      description: 'Default duration for tasks created by clicking an empty timeline slot.',
      label: 'Empty slot task duration',
      max: 1_440,
      min: 0,
      path: 'todo.blankTaskDurationMinutes',
      step: 5,
      unit: 'minutes',
    }, {
      control: 'time',
      description: 'First visible time in the Todo timeline.',
      label: 'Timeline workday starts at',
      max: 1_439,
      min: 0,
      path: 'todo.timelineWorkdayStartMinutes',
    }, {
      control: 'time',
      description: 'Last visible time in the Todo timeline.',
      label: 'Timeline workday ends at',
      max: 1_439,
      min: 1,
      path: 'todo.timelineWorkdayEndMinutes',
    }, {
      control: 'toggle',
      description: 'Keep the selected task open when a change removes it from the current Todo view.',
      label: 'Keep task details open',
      path: 'todo.keepDetailOpenWhenTaskLeavesView',
    }, {
      control: 'select',
      description: 'Choose whether completed Todos appear in the external ICS feed.',
      label: 'ICS completed Todos',
      options: [
        { label: 'Hide', value: 'hide' },
        { label: 'Show', value: 'show' },
      ],
      path: 'todo.calendarFeedCompleted',
    }, {
      control: 'select',
      description: 'Choose whether Todos without a date appear on the request day.',
      label: 'ICS undated Todos',
      options: [
        { label: 'Request day', value: 'today' },
        { label: 'Hide', value: 'hide' },
      ],
      path: 'todo.calendarFeedUndated',
    }, {
      control: 'text',
      description: 'IANA timezone used when placing undated and timed Todos in the feed.',
      label: 'ICS timezone',
      path: 'todo.calendarFeedTimeZone',
    }, {
      control: 'number',
      description: 'Include events this many days before the request day.',
      label: 'ICS days before',
      max: 3_660,
      min: 0,
      path: 'todo.calendarFeedBeforeDays',
      step: 1,
      unit: 'days',
    }, {
      control: 'number',
      description: 'Include events this many days after the request day.',
      label: 'ICS days after',
      max: 3_660,
      min: 0,
      path: 'todo.calendarFeedAfterDays',
      step: 1,
      unit: 'days',
    }, {
      control: 'select',
      description: 'Choose where the completed occurrence and the next task are placed.',
      label: 'After completing a recurring task',
      options: [
        { label: 'Archive in today\'s Journal', value: 'archive-completed-to-today' },
        { label: 'Next to today\'s Journal', value: 'move-next-to-today' },
        { label: 'Next to due-date Journal', value: 'move-next-to-due-date' },
        { label: 'Completion under next', value: 'nest-completed-under-next' },
        { label: 'Next after completion', value: 'place-next-after-completed' },
        { label: 'Replace with next', value: 'replace-completed' },
      ],
      path: 'todo.recurringTaskCompletionAction',
    }],
    id: 'todo',
    label: 'Todo',
  }, {
    fields: [{
      control: 'toggle',
      description: 'Enable flashcards, cloze authoring, FSRS scheduling, learning pages, and image occlusion.',
      label: 'Enable learning features',
      path: 'learning.enabled',
    }, {
      control: 'toggle',
      label: 'Enable learning for new Notes',
      path: 'defaultNoteLearningEnabled',
    }],
    id: 'learning',
    label: 'Learning',
  }, {
    fields: [{
      control: 'toggle',
      description: 'Periodically create a SQLite snapshot beside the main database.',
      label: 'Enable automatic backups',
      path: 'backup.enabled',
    }, {
      control: 'number',
      description: 'Create a new snapshot after this many minutes while Memorilo is running.',
      label: 'Backup interval',
      max: 10_080,
      min: 1,
      path: 'backup.intervalMinutes',
      step: 1,
      unit: 'minutes',
    }, {
      control: 'number',
      description: 'Older automatic snapshots are removed after this limit is reached.',
      label: 'Backups to keep',
      max: 100,
      min: 1,
      path: 'backup.retentionCount',
      step: 1,
      unit: 'backups',
    }],
    id: 'backup',
    label: 'Backup',
  }, {
    fields: [{
      control: 'number',
      description: 'Limit how many never-practiced cards enter the learning flow each study day.',
      label: 'New cards per day',
      max: 100_000,
      min: 0,
      path: 'flashcards.newCardsPerDay',
      step: 1,
      unit: 'cards',
    }, {
      control: 'select',
      label: 'New card gather order',
      options: [
        { label: 'Source order', value: 'source' },
        { label: 'Random', value: 'random' },
      ],
      path: 'flashcards.newGatherOrder',
    }, {
      control: 'select',
      label: 'Interday learning order',
      options: [
        { label: 'Before reviews', value: 'before-reviews' },
        { label: 'Mixed with reviews', value: 'mixed' },
        { label: 'After reviews', value: 'after-reviews' },
      ],
      path: 'flashcards.interdayOrder',
    }, {
      control: 'select',
      label: 'Review order',
      options: [
        { label: 'Due date, then random', value: 'due-random' },
        { label: 'Lowest retrievability first', value: 'retrievability' },
      ],
      path: 'flashcards.reviewOrder',
    }, {
      control: 'number',
      label: 'Learn-ahead limit',
      max: 1_440,
      min: 0,
      path: 'flashcards.learnAheadMinutes',
      step: 1,
      unit: 'minutes',
    }, {
      control: 'number',
      label: 'Next day starts at',
      max: 23,
      min: 0,
      path: 'flashcards.studyDayStartsAtHour',
      step: 1,
      unit: 'hour',
    }, {
      control: 'toggle',
      label: 'Bury new siblings',
      path: 'flashcards.buryNewSiblings',
    }, {
      control: 'toggle',
      label: 'Bury review siblings',
      path: 'flashcards.buryReviewSiblings',
    }, {
      control: 'toggle',
      label: 'Bury interday learning siblings',
      path: 'flashcards.buryInterdayLearningSiblings',
    }],
    id: 'flashcards',
    label: 'Flashcards',
  }, {
    fields: [{
      control: 'select',
      label: 'Daily learning goal',
      options: [
        { label: 'Spread over the week', value: 'spread-week' },
        { label: 'Review all due cards each day', value: 'all-due' },
        { label: 'Set a daily limit', value: 'fixed' },
      ],
      path: 'goals.dailyLearningGoalMode',
    }, {
      control: 'number',
      description: 'Used when the Daily Goal is set to a daily limit.',
      label: 'Daily limit',
      max: 100_000,
      min: 1,
      path: 'goals.dailyLearningGoalCards',
      step: 1,
      unit: 'cards',
    }],
    id: 'goals',
    label: 'Goals & Streaks',
  }, {
    fields: [{
      control: 'number',
      description: 'Duration for normal cursor moves.',
      label: 'Cursor animation length',
      max: 1,
      min: 0,
      path: 'editor.cursor.animationLength',
      step: 0.01,
      unit: 'seconds',
    }, {
      control: 'number',
      description: 'Duration for short horizontal moves while typing.',
      label: 'Cursor typing animation',
      max: 0.5,
      min: 0,
      path: 'editor.cursor.shortAnimationLength',
      step: 0.01,
      unit: 'seconds',
    }, {
      control: 'number',
      description: 'How much the back of the cursor trails behind its leading edge.',
      label: 'Cursor trail size',
      max: 1,
      min: 0,
      path: 'editor.cursor.trailSize',
      step: 0.05,
    }, {
      control: 'select',
      description: 'Optional visual effect emitted when the cursor moves.',
      label: 'Cursor particle effect',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Railgun', value: 'railgun' },
        { label: 'Torpedo', value: 'torpedo' },
        { label: 'Pixie dust', value: 'pixiedust' },
        { label: 'Sonic boom', value: 'sonicboom' },
        { label: 'Ripple', value: 'ripple' },
        { label: 'Wireframe', value: 'wireframe' },
      ],
      path: 'editor.cursor.vfxMode',
    }, {
      control: 'number',
      description: 'Opacity of cursor particles.',
      label: 'Cursor particle opacity',
      max: 255,
      min: 0,
      path: 'editor.cursor.vfxOpacity',
      step: 1,
    }, {
      control: 'number',
      description: 'How long cursor particles remain visible.',
      label: 'Cursor particle lifetime',
      max: 5,
      min: 0.05,
      path: 'editor.cursor.vfxParticleLifetime',
      step: 0.05,
      unit: 'seconds',
    }, {
      control: 'number',
      description: 'Particles generated per line of cursor travel.',
      label: 'Cursor particle density',
      max: 20,
      min: 0,
      path: 'editor.cursor.vfxParticleDensity',
      step: 0.1,
    }, {
      control: 'number',
      description: 'Movement speed of cursor particles.',
      label: 'Cursor particle speed',
      max: 200,
      min: 0,
      path: 'editor.cursor.vfxParticleSpeed',
      step: 1,
      unit: 'px/s',
    }, {
      control: 'toggle',
      description: 'Fade the cursor smoothly during its blink cycle.',
      label: 'Smooth cursor blink',
      path: 'editor.cursor.smoothBlink',
    }, {
      control: 'select',
      description: 'Choose how Shift-Tab moves selected blocks in Outline mode.',
      label: 'Outdent behavior',
      options: [
        { label: 'Logical', value: 'logical' },
        { label: 'Traditional', value: 'traditional' },
      ],
      path: 'outdentBehavior',
    }, {
      control: 'select',
      description: 'Download remote image links into managed assets when pasting, or keep their original URLs.',
      label: 'Pasted network images',
      options: [
        { label: 'Download into Assets', value: 'download' },
        { label: 'Keep URL', value: 'url' },
      ],
      path: 'networkImagePasteBehavior',
    }],
    id: 'editor',
    label: 'Editor',
  }, {
    fields: [{
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Back',
      path: 'shortcuts.back',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Forward',
      path: 'shortcuts.forward',
    }],
    id: 'shortcut-navigation',
    label: 'Navigation',
  }, {
    fields: [{
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Previous Note Structure entry',
      path: 'shortcuts.previousNoteStructureEntry',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Next Note Structure entry',
      path: 'shortcuts.nextNoteStructureEntry',
    }],
    id: 'shortcut-note-structure',
    label: 'Note Structure',
  }, {
    fields: [{
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Add Basic Card',
      path: 'shortcuts.addBasicCard',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Highlight',
      path: 'shortcuts.highlight',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Add Cloze',
      path: 'shortcuts.addCloze',
    }],
    id: 'shortcut-learning',
    label: 'Learning',
  }, {
    fields: [{
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Bold',
      path: 'shortcuts.bold',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Italic',
      path: 'shortcuts.italic',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Underline',
      path: 'shortcuts.underline',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Strikethrough',
      path: 'shortcuts.strike',
    }, {
      control: 'shortcut',
      description: 'Press a key combination to replace the shortcut. Press Backspace to clear it.',
      label: 'Inline code',
      path: 'shortcuts.code',
    }],
    id: 'shortcut-formatting',
    label: 'Formatting',
  }, {
    fields: [
      {
        control: 'segmented',
        description: 'Choose continuous vertical reading or one page at a time.',
        label: 'Page mode',
        options: [
          { label: 'Continuous', value: 'continuous' },
          { label: 'Single page', value: 'single-page' },
        ],
        path: 'readerPageMode',
      },
      {
        control: 'select',
        description: 'Choose original book formatting or optimized reading layout for reflowable EPUB books.',
        label: 'EPUB layout preference',
        options: [
          { label: 'Original formatting', value: 'publisher' },
          { label: 'Optimized reading', value: 'reader' },
        ],
        path: 'readerEpubPresentationMode',
      },
      {
        control: 'select',
        description: 'Choose what is included when copying highlighted text.',
        label: 'Highlight copy format',
        options: [
          { label: 'Text only', value: 'text' },
          { label: 'Text and book title', value: 'text-book' },
          { label: 'Text, book title, and location', value: 'text-book-location' },
        ],
        path: 'readerAnnotationCopyFormat',
      },
      {
        control: 'toggle',
        description: 'Use the left and right arrow keys to turn pages while reading.',
        label: 'Arrow keys turn pages',
        path: 'readerArrowKeyPageTurning',
      },
    ],
    id: 'reading',
    label: 'Reading',
  }, {
    fields: [{
      control: 'select',
      description: 'Images in formats that cannot be displayed directly are converted to this browser-compatible format before being stored.',
      label: 'Preferred format for unsupported images',
      options: [
        { label: 'WebP', value: 'webp' },
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
        { label: 'AVIF', value: 'avif' },
      ],
      path: 'tiffConversionFormat',
    }],
    id: 'images',
    label: 'Images',
  }, {
    fields: [{
      control: 'toggle',
      description: 'Expose Memorilo through a local MCP server for external AI tools.',
      label: 'Enable MCP server',
      path: 'mcp.enabled',
    }, {
      control: 'number',
      description: 'Clients connect to http://127.0.0.1:<port>/mcp.',
      label: 'MCP port',
      max: 65535,
      min: 1024,
      path: 'mcp.port',
      step: 1,
    }, {
      control: 'text',
      description: 'Bearer token required by MCP clients. Keep it private.',
      label: 'MCP access token',
      path: 'mcp.accessToken',
      sensitive: true,
    }],
    id: 'mcp',
    label: 'MCP',
  }, {
    fields: [{
      control: 'toggle',
      description: 'Connect this device to a Memorilo Sync Server in addition to direct peer-to-peer sync.',
      label: 'Enable Sync Server',
      path: 'syncServer.enabled',
    }, {
      control: 'text',
      description: 'Use the ws:// or wss:// address exposed by the server.',
      label: 'Sync Server URL',
      path: 'syncServer.url',
    }, {
      control: 'text',
      description: 'Peer identity from the server pairing invitation.',
      label: 'Sync Server peer ID',
      path: 'syncServer.peerId',
    }],
    id: 'sync-server',
    label: 'Sync Server',
  }],
})

export function migrateDesktopConfiguration(configuration: unknown): unknown {
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration))
    return configuration
  const record = configuration as Record<string, unknown>
  const storedTheme = record.theme
  const theme = typeof storedTheme === 'object' && storedTheme !== null && !Array.isArray(storedTheme)
    ? storedTheme as Record<string, unknown>
    : undefined
  const normalizedTheme = {
    appearance: theme?.appearance === 'light' || theme?.appearance === 'dark' ? theme.appearance : 'system',
    family: theme?.family === 'fluent' || theme?.family === 'neubrutalism' || theme?.family === 'liquid-glass'
      ? theme.family
      : Object.hasOwn(record, 'theme') ? 'liquid-glass' : defaultDesktopThemeFamily(),
  } as const
  const withTheme = Object.hasOwn(record, 'theme') && theme?.appearance === normalizedTheme.appearance && theme?.family === normalizedTheme.family
    ? record
    : { ...record, theme: normalizedTheme }
  const withPanel = Object.hasOwn(record, 'panel')
    ? withTheme
    : { ...withTheme, panel: desktopConfigurationDefinition.defaults.panel }
  const withTitlebar = Object.hasOwn(record, 'redrawTitlebar')
    ? withPanel
    : { ...withPanel, redrawTitlebar: desktopConfigurationDefinition.defaults.redrawTitlebar }
  const storedShortcuts = record.shortcuts
  const shortcuts = typeof storedShortcuts === 'object' && storedShortcuts !== null && !Array.isArray(storedShortcuts)
    ? storedShortcuts as Record<string, unknown>
    : undefined
  const defaultShortcuts = desktopConfigurationDefinition.defaults.shortcuts
  const withShortcuts = shortcuts !== undefined
    && Object.keys(defaultShortcuts).every(key => typeof shortcuts[key] === 'string')
    ? withTitlebar
    : { ...withTitlebar, shortcuts: { ...defaultShortcuts, ...shortcuts } }
  const storedEditor = record.editor
  const editor = typeof storedEditor === 'object' && storedEditor !== null && !Array.isArray(storedEditor)
    ? storedEditor as Record<string, unknown>
    : {}
  const storedCursor = editor.cursor
  const cursor = typeof storedCursor === 'object' && storedCursor !== null && !Array.isArray(storedCursor)
    ? storedCursor as Record<string, unknown>
    : {}
  const defaultCursor = desktopConfigurationDefinition.defaults.editor.cursor
  const withEditor = editor.cursor !== undefined
    && Object.keys(defaultCursor).every(key => key in cursor)
    ? withShortcuts
    : {
        ...withShortcuts,
        editor: { cursor: { ...defaultCursor, ...cursor } },
      }
  const storedSyncServer = withEditor.syncServer
  const syncServer = typeof storedSyncServer === 'object' && storedSyncServer !== null && !Array.isArray(storedSyncServer)
    ? storedSyncServer as Record<string, unknown>
    : undefined
  const syncServerComplete = syncServer !== undefined
    && typeof syncServer.enabled === 'boolean'
    && typeof syncServer.url === 'string'
    && typeof syncServer.peerId === 'string'
    && typeof syncServer.generation === 'number'
    && typeof syncServer.membershipEpoch === 'number'
    && typeof syncServer.policyEpoch === 'number'
    && Array.isArray(syncServer.modes)
  const withSyncServer = syncServerComplete
    ? withEditor
    : {
        ...withEditor,
        syncServer: {
          ...desktopConfigurationDefinition.defaults.syncServer,
          ...syncServer,
        },
      }
  const storedTodo = record.todo
  const todo = typeof storedTodo === 'object' && storedTodo !== null && !Array.isArray(storedTodo)
    ? storedTodo as Record<string, unknown>
    : {}
  if (Object.keys(desktopConfigurationDefinition.defaults.todo).every(key => Object.hasOwn(todo, key)))
    return withSyncServer
  return {
    ...withSyncServer,
    todo: {
      ...desktopConfigurationDefinition.defaults.todo,
      ...todo,
    },
  }
}
