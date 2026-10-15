import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditorNote } from '@memorilo/editor/note'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { createDeviceTodoModule } from './device-todo'

describe('device Todo module', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  it('projects tasks through a read-only device credential', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-todo-'))
    directories.push(directory)
    const database = createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })
    database.migrate()
    await database.auth.provisionAccount({ accountId: 'account-1', createdAt: 1, enabledModes: ['authoritative'], passwordHash: 'unused', requireEmpty: true, username: 'owner' })
    const note = createEditorNote({ id: 'note-1', initialTopicHeading: 'Topic' })
    const topic = note.getEntries().find(entry => entry.kind === 'topic')
    if (!topic || topic.kind !== 'topic')
      throw new Error('Missing topic')
    note.applyTopicBlockEdits({
      edits: [{ attributes: { schedule: { date: '2026-09-01', kind: 'deadline', time: null }, status: 'todo' }, content: [{ content: [{ text: 'Buy milk', type: 'text' }], type: 'paragraph' }], kind: 'task', operation: 'insert-block' }],
      topicId: topic.id,
    })
    const snapshot = Buffer.from(note.exportSnapshot()).toString('base64url')
    await database.repository.mergeNoteSnapshot!('account-1', 0, 'note-1', snapshot, 2)
    const module = createDeviceTodoModule({ repository: database.repository, store: database.deviceTodo, now: () => Date.parse('2026-09-01T08:00:00Z') })
    const issued = await Effect.runPromise(module.issueToken({ accountId: 'account-1', deviceName: 'E-paper', expiresAt: Date.parse('2027-01-01T00:00:00Z'), scopes: ['todos:read'] }))
    const listed = await Effect.runPromise(module.list({ date: '2026-09-01', limit: 20, token: issued.token, view: 'today' }))
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({ status: 'todo', text: 'Buy milk' })
    await expect(Effect.runPromise(module.issueToken({ accountId: 'account-1', deviceName: 'Too long', expiresAt: Date.parse('2028-01-01T00:00:00Z'), scopes: ['todos:read'] }))).rejects.toMatchObject({ code: 'invalid_request' })

    const dirtyModule = createDeviceTodoModule({
      repository: {
        ...database.repository,
        listNoteSnapshots: async () => [
          ...(await database.repository.listNoteSnapshots('account-1', 0)),
          { accountId: 'account-1', generation: 0, noteId: 'broken', snapshot: 'not-a-note', frontier: {}, updatedAt: 3 },
        ],
      },
      store: database.deviceTodo,
      now: () => Date.parse('2026-09-01T08:00:00Z'),
    })
    const dirtyListed = await Effect.runPromise(dirtyModule.list({ date: '2026-09-01', limit: 20, token: issued.token, view: 'today' }))
    expect(dirtyListed.items).toHaveLength(1)
    database.close()
  })

  it('renders a complete ICS feed from persisted Todos and shared occurrences', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-todo-ics-'))
    directories.push(directory)
    const database = createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })
    database.migrate()
    await database.auth.provisionAccount({ accountId: 'account-ics', createdAt: 1, enabledModes: ['authoritative'], passwordHash: 'unused', requireEmpty: true, username: 'owner' })

    const note = createEditorNote({ id: 'note-ics', initialTopicHeading: 'Planning' })
    const topic = note.getEntries().find(entry => entry.kind === 'topic')
    if (!topic || topic.kind !== 'topic')
      throw new Error('Missing topic')
    const paragraph = (text: string) => ({ content: [{ text, type: 'text' as const }], type: 'paragraph' as const })
    note.applyTopicBlockEdits({
      edits: [
        {
          attributes: { schedule: { date: '2026-09-02', kind: 'deadline', time: null }, status: 'todo' },
          blockId: 'parent',
          content: [paragraph('Parent task')],
          kind: 'task',
          operation: 'insert-block',
        },
        {
          attributes: { schedule: { date: '2026-09-02', kind: 'deadline', time: '09:30' }, status: 'todo' },
          blockId: 'child',
          content: [paragraph('Child task')],
          kind: 'task',
          operation: 'insert-block',
          parentId: 'parent',
        },
        {
          attributes: { schedule: { kind: 'none' }, status: 'todo' },
          blockId: 'undated',
          content: [paragraph('Undated task')],
          kind: 'task',
          operation: 'insert-block',
        },
        {
          attributes: { schedule: { date: '2026-09-03', kind: 'deadline', time: '14:00' }, status: 'todo' },
          blockId: 'timed',
          content: [paragraph('Timed task')],
          kind: 'task',
          operation: 'insert-block',
        },
        {
          attributes: { schedule: { allDay: false, end: '2026-09-04T11:00', kind: 'span', start: '2026-09-04T10:00' }, status: 'todo' },
          blockId: 'span',
          content: [paragraph('Span task')],
          kind: 'task',
          operation: 'insert-block',
        },
        {
          attributes: { repeatRule: { endDate: '2026-09-05', interval: 1, mode: 'due', unit: 'day' }, schedule: { date: '2026-09-02', kind: 'deadline', time: null }, status: 'todo' },
          blockId: 'repeated',
          content: [paragraph('Repeated task')],
          kind: 'task',
          operation: 'insert-block',
        },
        {
          attributes: { schedule: { date: '2026-09-03', kind: 'deadline', time: null }, status: 'done' },
          blockId: 'completed',
          content: [paragraph('Completed task')],
          kind: 'task',
          operation: 'insert-block',
        },
      ],
      topicId: topic.id,
    })
    await database.repository.mergeNoteSnapshot!('account-ics', 0, 'note-ics', Buffer.from(note.exportSnapshot()).toString('base64url'), 2)

    const module = createDeviceTodoModule({
      repository: database.repository,
      store: database.deviceTodo,
      now: () => Date.parse('2026-09-01T08:00:00Z'),
    })
    try {
      const issued = await Effect.runPromise(module.issueCalendarToken({ accountId: 'account-ics', deviceId: 'desktop-1', deviceName: 'Desktop' }))
      expect(issued.credential.scopes).toEqual(['todos:calendar:read'])
      expect(issued.token).toMatch(/^memorilo-calendar-v1\./u)

      const result = await Effect.runPromise(module.calendar({
        options: {
          afterDays: 4,
          beforeDays: 1,
          completed: 'hide',
          from: '2026-09-01',
          through: '2026-09-05',
          undated: 'today',
          undatedDate: '2026-09-01',
        },
        token: issued.token,
      }))
      const events = result.body.split('BEGIN:VEVENT').slice(1)
      expect(events).toHaveLength(9)
      expect(result.body).toContain('SUMMARY:Undated task')
      expect(result.body).toContain('DTSTART;VALUE=DATE:20260901')
      expect(result.body).toContain('SUMMARY:Timed task')
      expect(result.body).toContain('DTSTART:20260903T140000')
      expect(result.body).toContain('SUMMARY:Span task')
      expect(result.body).toContain('DTEND:20260904T110000')
      expect(result.body).toContain('SUMMARY:Child task')
      expect(result.body).toContain('DESCRIPTION:Untitled \/ Planning\\nParent: Parent task')
      expect(result.body).toContain('SUMMARY:Repeated task')
      expect(result.body).not.toContain('SUMMARY:Completed task')
      expect(result.body.match(/UID:/gu)).toHaveLength(9)

      expect(result.body.match(/SUMMARY:Repeated task/gu)).toHaveLength(4)
      const repeatedAgain = await Effect.runPromise(module.calendar({
        options: {
          afterDays: 4,
          beforeDays: 1,
          completed: 'hide',
          from: '2026-09-01',
          through: '2026-09-05',
          undated: 'today',
          undatedDate: '2026-09-01',
        },
        token: issued.token,
      }))
      expect(repeatedAgain).toEqual(result)
    }
    finally {
      database.close()
    }
  })

  it('applies ICS feed filters and revokes rotated calendar credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-todo-ics-options-'))
    directories.push(directory)
    const database = createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })
    database.migrate()
    await database.auth.provisionAccount({ accountId: 'account-options', createdAt: 1, enabledModes: ['authoritative'], passwordHash: 'unused', requireEmpty: true, username: 'owner' })

    const note = createEditorNote({ id: 'note-options', initialTopicHeading: 'Options' })
    const topic = note.getEntries().find(entry => entry.kind === 'topic')
    if (!topic || topic.kind !== 'topic')
      throw new Error('Missing topic')
    const paragraph = (text: string) => ({ content: [{ text, type: 'text' as const }], type: 'paragraph' as const })
    note.applyTopicBlockEdits({
      edits: [
        { attributes: { schedule: { kind: 'none' }, status: 'todo' }, blockId: 'undated', content: [paragraph('Undated')], kind: 'task', operation: 'insert-block' },
        { attributes: { schedule: { date: '2026-09-02', kind: 'deadline', time: null }, status: 'done' }, blockId: 'done', content: [paragraph('Done')], kind: 'task', operation: 'insert-block' },
      ],
      topicId: topic.id,
    })
    await database.repository.mergeNoteSnapshot!('account-options', 0, 'note-options', Buffer.from(note.exportSnapshot()).toString('base64url'), 2)
    const module = createDeviceTodoModule({ repository: database.repository, store: database.deviceTodo, now: () => Date.parse('2026-09-01T08:00:00Z') })
    try {
      const first = await Effect.runPromise(module.issueCalendarToken({ accountId: 'account-options', deviceId: 'desktop-1', deviceName: 'Desktop' }))

      const hidden = await Effect.runPromise(module.calendar({
        options: { afterDays: 1, beforeDays: 1, completed: 'hide', from: '2026-09-01', through: '2026-09-03', undated: 'hide', undatedDate: '2026-09-01' },
        token: first.token,
      }))
      expect(hidden.body).not.toContain('SUMMARY:Undated')
      expect(hidden.body).not.toContain('SUMMARY:Done')

      const shown = await Effect.runPromise(module.calendar({
        options: { afterDays: 1, beforeDays: 1, completed: 'show', from: '2026-09-01', through: '2026-09-03', undated: 'today', undatedDate: '2026-09-01' },
        token: first.token,
      }))
      expect(shown.body).toContain('SUMMARY:Undated')
      expect(shown.body).toContain('SUMMARY:Done')

      const second = await Effect.runPromise(module.issueCalendarToken({ accountId: 'account-options', deviceId: 'desktop-1', deviceName: 'Desktop' }))
      await expect(Effect.runPromise(module.calendar({
        options: { afterDays: 1, beforeDays: 1, completed: 'hide', from: '2026-09-01', through: '2026-09-03', undated: 'hide', undatedDate: '2026-09-01' },
        token: first.token,
      }))).rejects.toMatchObject({ code: 'unauthorized' })
      await expect(Effect.runPromise(module.calendar({
        options: { afterDays: 1, beforeDays: 1, completed: 'hide', from: '2026-09-01', through: '2026-09-03', undated: 'hide', undatedDate: '2026-09-01' },
        token: second.token,
      }))).resolves.toMatchObject({ revision: expect.any(String) })

      await expect(Effect.runPromise(module.calendar({
        options: { afterDays: -1, beforeDays: 1, completed: 'hide', from: '2026-09-01', through: '2026-09-03', undated: 'hide', undatedDate: '2026-09-01' },
        token: second.token,
      }))).rejects.toMatchObject({ code: 'invalid_request' })
      await expect(Effect.runPromise(module.revokeCalendarToken({ accountId: 'account-options', deviceId: 'desktop-1' }))).resolves.toBe(true)
      await expect(Effect.runPromise(module.calendar({
        options: { afterDays: 1, beforeDays: 1, completed: 'hide', from: '2026-09-01', through: '2026-09-03', undated: 'hide', undatedDate: '2026-09-01' },
        token: second.token,
      }))).rejects.toMatchObject({ code: 'unauthorized' })
    }
    finally {
      database.close()
    }
  })
})
