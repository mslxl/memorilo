import type { EditorStorage, JournalDate } from '@memorilo/editor-storage'
import type { TopicBlockEdit, TopicBlockProjection } from '@memorilo/editor/note'
import type { TaskRepeatRule } from '@memorilo/editor/schema'
import type { RecurringTaskCompletionAction } from '@memorilo/editor/task'
import type {
  ApplyTopicEditsInput,
  CreateBookNoteInput,
  CreateBookNoteResult,
  CreateNoteInput,
  CreateTodoTaskInput,
  GenerateCardTopicInput,
  NoteExternalUpdate,
  OpenJournalInput,
  RebindBookTopicInput,
  RenameNoteInput,
  RenameTopicInput,
  SaveNoteUpdatesInput,
  SetTopicModeInput,
  UpdateTodoTaskInput,
} from './note-application-contracts'
import type { NoteAuthoritativeRuntime } from './note-authoritative-runtime'
import { randomUUID } from 'node:crypto'
import { assertJournalDate, DuplicateNoteTitleError } from '@memorilo/editor-storage'
import { createEditorNote, resolveJournalTopic } from '@memorilo/editor/note'
import { parseTaskRepeatRule, parseTaskSchedule, transitionTaskAttrs } from '@memorilo/editor/schema'
import { nextTaskOccurrenceDate, planTaskAction, taskRepeatBaseDate, taskRepeatContinuesOn } from '@memorilo/editor/task'
import { toError } from '@memorilo/effect-lifecycle'
import { Effect } from 'effect'
import { NoteRevisionConflictError } from './note-application-contracts'
import {
  projectApplicationNote,
  projectApplicationNoteSummary,
  projectBookTopicReadingContext,
} from './note-application-projection'
import { noteRevision } from './note-authoritative-projection'
import { planRecurringTaskPlacement } from './recurring-task-completion'

interface NodeJSON {
  attrs?: Record<string, unknown>
  content?: NodeJSON[]
  text?: string
  type: string
}

interface NoteApplicationCommandsDependencies {
  defaultNoteLearningEnabled: () => boolean
  recurringTaskCompletionAction: () => RecurringTaskCompletionAction
  runtime: Pick<NoteAuthoritativeRuntime, 'applyExternalUpdates' | 'commit' | 'invalidate' | 'open' | 'openJournal' | 'persistLocalMutation' | 'prunePastEmptyJournals' | 'run' | 'runEffect'>
  storage: EditorStorage
  today: () => JournalDate
}

function recurrenceCalendarRange(date: JournalDate): { from: JournalDate, through: JournalDate } {
  const year = Number(date.slice(0, 4))
  if (!Number.isSafeInteger(year))
    throw new TypeError(`Task recurrence date has an invalid year: ${date}`)
  const fromYear = Math.max(1, year - 1)
  const throughYear = Math.min(9999, year + 5)
  return {
    from: `${String(fromYear).padStart(4, '0')}-01-01`,
    through: `${String(throughYear).padStart(4, '0')}-12-31`,
  }
}

function recurrenceNeedsCalendar(rule: TaskRepeatRule): boolean {
  return rule.unit === 'holiday'
    || rule.skipHolidays === true
    || (rule.holidayPolicy !== undefined && rule.holidayPolicy !== 'allow')
}

function toNoteExternalUpdate(result: {
  noteId: string
  update: Uint8Array
  updatedAt: number
}): NoteExternalUpdate {
  return {
    noteId: result.noteId,
    update: result.update,
    updatedAt: result.updatedAt,
  }
}

export function createNoteApplicationCommands({
  defaultNoteLearningEnabled,
  recurringTaskCompletionAction,
  runtime,
  storage,
  today,
}: NoteApplicationCommandsDependencies) {
  const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => runtime.run(operation)
  const serializeEffect = <Result, Failure>(operation: Effect.Effect<Result, Failure>): Promise<Result> => runtime.runEffect(operation)
  const assertRevision = (current: Awaited<ReturnType<NoteAuthoritativeRuntime['open']>>, expectedRevision: string): void => {
    const revision = noteRevision(current.note.getVersion())
    if (revision !== expectedRevision)
      throw new NoteRevisionConflictError(revision)
  }

  const findTaskNode = (document: NodeJSON, blockId: string): NodeJSON => {
    const visit = (nodes: readonly NodeJSON[]): NodeJSON | undefined => {
      for (const node of nodes) {
        if (node.type === 'list' && node.attrs?.blockId === blockId)
          return node
        const found = visit(node.content ?? [])
        if (found)
          return found
      }
    }
    const found = visit(document.content ?? [])
    if (!found || found.type !== 'list')
      throw new Error(`Todo task ${blockId} was not found in Topic`)
    return found
  }

  const paragraph = (text: string): NodeJSON => ({
    content: text.length === 0 ? [] : [{ text, type: 'text' }],
    type: 'paragraph',
  })

  const completeRecurringTask = async (
    current: Awaited<ReturnType<NoteAuthoritativeRuntime['open']>>,
    source: NodeJSON,
    sourceBlock: TopicBlockProjection,
    topicId: string,
  ): Promise<NoteExternalUpdate> => {
    const sourceAttrs = source.attrs ?? {}
    const repeatRule = parseTaskRepeatRule(sourceAttrs.repeatRule)
    if (repeatRule === null)
      throw new TypeError(`Todo task ${sourceBlock.id} does not have a valid repeat rule`)
    const sourceSchedule = parseTaskSchedule(sourceAttrs.schedule)
    if (sourceSchedule === null)
      throw new TypeError(`Todo task ${sourceBlock.id} has an invalid schedule`)

    const completedOn = today()
    const occurrenceDate = sourceSchedule.kind === 'deadline'
      ? sourceSchedule.date
      : sourceSchedule.kind === 'span' ? sourceSchedule.start.slice(0, 10) : current.journalDate ?? completedOn
    const baseDate = taskRepeatBaseDate(occurrenceDate, repeatRule, completedOn)
    const calendarEvents = recurrenceNeedsCalendar(repeatRule)
      ? await storage.todoCalendars.listEvents(recurrenceCalendarRange(baseDate))
      : []
    const nextDueDate = nextTaskOccurrenceDate(baseDate, repeatRule, calendarEvents)
    if (!taskRepeatContinuesOn(nextDueDate, repeatRule)) {
      const sourceVersion = current.note.getVersion()
      current.note.applyTopicBlockEdits({
        edits: [{
          attributes: {
            ...source.attrs,
            ...transitionTaskAttrs(sourceAttrs, 'done'),
            repeatRule: null,
          },
          blockId: sourceBlock.id,
          operation: 'update-block-attributes',
        }],
        topicId,
      })
      await current.note.validateTopic(topicId)
      return toNoteExternalUpdate(await runtime.persistLocalMutation(current, sourceVersion, { broadcast: true, topicIds: [topicId] }))
    }
    const placement = planRecurringTaskPlacement({
      action: recurringTaskCompletionAction(),
      generateId: randomUUID,
      nextDueDate,
      sourceBlock,
      sourceNode: source,
      today: completedOn,
    })

    const sourceVersion = current.note.getVersion()
    const targetOpened = placement.target === undefined
      ? null
      : await runtime.openJournal(placement.target.date)
    const target = targetOpened?.current ?? null
    const targetVersion = target?.note.getVersion() ?? null
    const targetTopicId = target === null
      ? null
      : resolveJournalTopic(target.note, { expectedNoteTitle: placement.target?.date }).topicId
    const targetEdits: readonly TopicBlockEdit[] = target === null || targetTopicId === null || placement.target === undefined
      ? []
      : [
          ...(target.note.hasUserContent()
            ? []
            : (() => {
                const [placeholder, ...extra] = target.note.getTopicContent(targetTopicId).blocks
                if (!placeholder || extra.length > 0)
                  throw new Error(`Empty Journal ${placement.target.date} does not have one canonical placeholder Block`)
                return [{
                  blockId: placeholder.id,
                  operation: 'delete-block' as const,
                  strategy: 'delete-subtree' as const,
                }]
              })()),
          ...placement.target.edits,
        ]

    const sameDocument = target !== null
      && target.note.id === current.note.id
      && targetTopicId === topicId
    try {
      if (sameDocument) {
        current.note.applyTopicBlockEdits({
          edits: [...placement.sourceEdits, ...targetEdits],
          topicId,
        })
        await current.note.validateTopic(topicId)
        return toNoteExternalUpdate(await runtime.persistLocalMutation(current, sourceVersion, { broadcast: true, topicIds: [topicId] }))
      }

      current.note.applyTopicBlockEdits({ edits: placement.sourceEdits, topicId })
      if (target !== null && targetTopicId !== null)
        target.note.applyTopicBlockEdits({ edits: targetEdits, topicId: targetTopicId })
      await Promise.all([
        current.note.validateTopic(topicId),
        ...(target !== null && targetTopicId !== null ? [target.note.validateTopic(targetTopicId)] : []),
      ])

      if (target !== null && targetTopicId !== null) {
        if (targetVersion === null)
          throw new Error('Recurring task Journal target is missing its source version')
        // The stored source still contains the full occurrence until the target copy is durable.
        await runtime.persistLocalMutation(target, targetVersion, { broadcast: true, topicIds: [targetTopicId] })
      }
      return toNoteExternalUpdate(await runtime.persistLocalMutation(current, sourceVersion, { broadcast: true, topicIds: [topicId] }))
    }
    catch (error) {
      runtime.invalidate(current.note.id)
      if (target !== null)
        runtime.invalidate(target.note.id)
      throw error
    }
  }

  const updateTodoTask = (input: UpdateTodoTaskInput) => serialize(async () => {
    const current = await runtime.open(input.noteId)
    const validation = current.note.getTopicValidationInput(input.topicId)
    if (!('document' in validation))
      throw new TypeError(`Topic ${input.topicId} does not have an editable document`)
    const source = findTaskNode(validation.document, input.blockId)
    if (source.attrs?.kind !== 'task')
      throw new TypeError(`Block ${input.blockId} is not a Todo task`)
    const sourceAttrs = source.attrs ?? {}
    const sourceBlock = current.note.getTopicContent(input.topicId).blocks.find(block => block.id === input.blockId)
    if (!sourceBlock)
      throw new Error(`Todo task ${input.blockId} disappeared from Topic projection`)
    if (!input.onlyThis
      && input.status === 'done'
      && parseTaskRepeatRule(sourceAttrs.repeatRule) !== null) {
      return completeRecurringTask(current, source, sourceBlock, input.topicId)
    }
    const plan = planTaskAction(sourceAttrs, sourceBlock.text, input)
    const edits: TopicBlockEdit[] = []
    if (plan.occurrence) {
      edits.push({
        attributes: plan.current.attrs,
        blockId: input.blockId,
        operation: 'update-block-attributes',
      })
      edits.push({
        attributes: plan.occurrence.attrs,
        content: [paragraph(plan.occurrence.text)],
        kind: 'task',
        operation: 'insert-block',
        parentId: sourceBlock.parentId,
      })
    }
    else {
      if (plan.current.text !== undefined)
        edits.push({ blockId: input.blockId, content: [paragraph(plan.current.text)], operation: 'update-block-content' })
      edits.push({ attributes: plan.current.attrs, blockId: input.blockId, operation: 'update-block-attributes' })
    }
    const version = current.note.getVersion()
    try {
      current.note.applyTopicBlockEdits({ edits, topicId: input.topicId })
      await current.note.validateTopic(input.topicId)
      return toNoteExternalUpdate(await runtime.persistLocalMutation(current, version, { broadcast: true, topicIds: [input.topicId] }))
    }
    catch (error) {
      runtime.invalidate(input.noteId)
      throw error
    }
  })

  const createTodoTask = (input: CreateTodoTaskInput) => serialize(async () => {
    const targetDate = input.schedule?.kind === 'deadline'
      ? input.schedule.date
      : input.schedule?.kind === 'span' ? input.schedule.start.slice(0, 10) : today()
    const opened = await runtime.openJournal(targetDate)
    const current = opened.current
    const topic = resolveJournalTopic(current.note, { expectedNoteTitle: targetDate })
    const blockId = randomUUID()
    const sourceVersion = current.note.getVersion()
    const attrs = {
      blockId,
      checked: false,
      elapsedMs: 0,
      kind: 'task' as const,
      repeatRule: null,
      reminderMinutes: null,
      reminders: null,
      startedAt: null,
      status: 'todo' as const,
      schedule: input.schedule ?? { kind: 'none' as const },
    }
    try {
      current.note.applyTopicBlockEdits({
        edits: [{
          attributes: attrs,
          blockId,
          content: [paragraph(input.text)],
          kind: 'task',
          operation: 'insert-block',
        }],
        topicId: topic.topicId,
      })
      await current.note.validateTopic(topic.topicId)
      await runtime.persistLocalMutation(current, sourceVersion, { broadcast: true, topicIds: [topic.topicId] })
      const page = await storage.tasks.list({ limit: 100 })
      const task = page.items.find(item => item.blockId === blockId)
      if (!task)
        throw new Error(`Created Todo task ${blockId} was not projected`)
      return task
    }
    catch (error) {
      runtime.invalidate(current.note.id)
      throw error
    }
  })

  return {
    applyTopicEdits: (input: ApplyTopicEditsInput) => serializeEffect(Effect.gen(function* () {
      const current = yield* Effect.tryPromise({ catch: toError, try: () => runtime.open(input.noteId) })
      yield* Effect.try({ catch: toError, try: () => assertRevision(current, input.expectedRevision) })
      const version = current.note.getVersion()
      return yield* Effect.gen(function* () {
        yield* Effect.try({ catch: toError, try: () => current.note.applyTopicBlockEdits({ edits: input.edits, topicId: input.topicId }) })
        yield* current.note.validateTopic(input.topicId)
        return yield* Effect.tryPromise({
          catch: toError,
          try: () => runtime.persistLocalMutation(current, version, { broadcast: true, entries: true, topicIds: [input.topicId] }),
        })
      }).pipe(Effect.catchEager((error) => {
        runtime.invalidate(input.noteId)
        return Effect.fail(error)
      }))
    })),
    createBookNote: (input: CreateBookNoteInput) => serialize(async (): Promise<CreateBookNoteResult> => {
      const id = randomUUID()
      const note = createEditorNote({
        id,
        initialBookTopic: { book: input.book, mode: 0, title: input.topicTitle },
        learningEnabled: defaultNoteLearningEnabled(),
        title: input.noteTitle,
      })
      try {
        const current = await runtime.commit(note)
        const topic = note.getEntries().find(entry => entry.kind === 'topic' && entry.topicType === 'book')
        if (!topic)
          throw new Error(`New Book Note ${id} does not contain its BookTopic`)
        return {
          context: await projectBookTopicReadingContext(storage, current, topic.id, false),
          status: 'created',
        }
      }
      catch (error) {
        if (error instanceof DuplicateNoteTitleError)
          return { status: 'duplicate-title' }
        throw error
      }
    }),
    createNote: (input?: CreateNoteInput) => serialize(async () => {
      const note = createEditorNote({
        id: randomUUID(),
        ...(input?.initialTopic === undefined
          ? input?.initialHeading === undefined ? {} : { initialTopicHeading: input.initialHeading }
          : { initialTopic: input.initialTopic as unknown as Parameters<typeof createEditorNote>[0]['initialTopic'] }),
        learningEnabled: defaultNoteLearningEnabled(),
        ...(input?.title === undefined ? {} : { title: input.title }),
      })
      return projectApplicationNote(storage, await runtime.commit(note), false)
    }),
    openJournal: (input: OpenJournalInput = {}) => serialize(async () => {
      if (input.journalDate !== undefined)
        assertJournalDate(input.journalDate)
      const currentToday = today()
      const journalDate = input.journalDate ?? currentToday
      if (journalDate > currentToday)
        throw new RangeError(`Future Journal date cannot be opened: ${journalDate}`)
      const opened = await runtime.openJournal(journalDate)
      const desktop = await projectApplicationNote(storage, opened.current, opened.created ? false : undefined)
      if (desktop.kind !== 'journal')
        throw new Error(`Journal ${journalDate} was restored as a regular Note`)
      return desktop
    }),
    prunePastEmptyJournals: () => serialize(() => runtime.prunePastEmptyJournals()),
    recordNoteOpened: (input: Parameters<EditorStorage['notes']['recordNoteOpened']>[0]) => serialize(() => storage.notes.recordNoteOpened(input)),
    rebindBookTopic: (input: RebindBookTopicInput) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      const version = current.note.getVersion()
      try {
        current.note.getBookTopic(input.topicId).rebind(input.book)
        await runtime.persistLocalMutation(current, version, { broadcast: true, entries: true, topicIds: [input.topicId] })
        return projectBookTopicReadingContext(storage, current, input.topicId)
      }
      catch (error) {
        runtime.invalidate(input.noteId)
        throw error
      }
    }),
    renameNote: (input: RenameNoteInput) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      if (current.journalDate !== null)
        return { journalDate: current.journalDate, status: 'journal-title-immutable' } as const
      const title = input.title.trim()
      if (title === current.note.getTitle())
        return { note: await projectApplicationNoteSummary(storage, current), status: 'renamed' } as const
      try {
        const version = current.note.getVersion()
        current.note.renameNote(title)
        await runtime.persistLocalMutation(current, version, { title: true })
        return { note: await projectApplicationNoteSummary(storage, current), status: 'renamed' } as const
      }
      catch (error) {
        runtime.invalidate(input.noteId)
        if (error instanceof DuplicateNoteTitleError)
          return { status: 'duplicate-title' } as const
        throw error
      }
    }),
    deleteNote: (input: Parameters<EditorStorage['notes']['deleteNote']>[0]) => serialize(async () => {
      const result = await storage.notes.deleteNote(input)
      runtime.invalidate(input.noteId)
      return result
    }),
    renameTopic: (input: RenameTopicInput) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      assertRevision(current, input.expectedRevision)
      const version = current.note.getVersion()
      try {
        current.note.renameEntry(input.topicId, input.title)
        return await runtime.persistLocalMutation(current, version, { broadcast: true, entries: true, topicIds: [input.topicId] })
      }
      catch (error) {
        runtime.invalidate(input.noteId)
        throw error
      }
    }),
    saveNoteUpdates: (input: SaveNoteUpdatesInput) => serializeEffect(runtime.applyExternalUpdates(input)),
    setNoteFavorite: (input: Parameters<EditorStorage['notes']['setNoteFavorite']>[0]) => serialize(() => storage.notes.setNoteFavorite(input)),
    setTopicMode: (input: SetTopicModeInput) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      assertRevision(current, input.expectedRevision)
      const version = current.note.getVersion()
      try {
        current.note.getTopic(input.topicId).setMode(input.mode)
        return await runtime.persistLocalMutation(current, version, { broadcast: true, entries: true })
      }
      catch (error) {
        runtime.invalidate(input.noteId)
        throw error
      }
    }),
    updateTodoTask,
    createTodoTask,
    generateCardTopic: (input: GenerateCardTopicInput) => serialize(async () => {
      const current = await runtime.open(input.noteId)
      const version = current.note.getVersion()
      try {
        const cardTopicId = current.note.createCardTopicFromHighlight({
          highlightId: input.highlightId,
          sourceTopicId: input.sourceTopicId,
        })
        await current.note.validateTopic(cardTopicId)
        return {
          ...toNoteExternalUpdate(await runtime.persistLocalMutation(current, version, {
            broadcast: true,
            entries: true,
            topicIds: [input.sourceTopicId, cardTopicId],
          })),
          cardTopicId,
        }
      }
      catch (error) {
        runtime.invalidate(input.noteId)
        throw error
      }
    }),
  }
}

export type NoteApplicationCommands = ReturnType<typeof createNoteApplicationCommands>
