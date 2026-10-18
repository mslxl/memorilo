import type { NodeJSON } from 'prosekit/core'
import type { EditorAdapters } from '../adapters/editor-adapters'
import { act, render, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { modShortcut, redoShortcut, userEvent } from '../../test/browser/user-event'
import { createEditorNote, Editor, EditorMode } from '../index'
import { resolveEditorTopicDocument } from './editor-topic-runtime'

const adapters: EditorAdapters = {
  uploadImage: async () => 'memory://image',
  tagStorage: {
    search: async () => [],
    create: async tag => tag,
    update: async tag => tag,
  },
}

function documentWithText(id: string, text: string): NodeJSON {
  return {
    type: 'doc',
    content: [{
      type: 'list',
      attrs: { blockId: id, checked: false, collapsed: false, kind: 'outline', order: null },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }],
  }
}

function twoBlockDocument(kind: 'bullet' | 'outline'): NodeJSON {
  const block = (blockId: string, text: string): NodeJSON => ({
    type: 'list',
    attrs: { blockId, checked: false, collapsed: false, kind, order: null },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
  return { type: 'doc', content: [block('A', 'First'), block('B', 'Second')] }
}

function flatDocument(blocks: readonly (readonly [id: string, text: string])[]): NodeJSON {
  return {
    type: 'doc',
    content: blocks.map(([blockId, text]) => ({
      type: 'list',
      attrs: { blockId, checked: false, collapsed: false, kind: 'outline', order: null },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  }
}

function blockElement(container: HTMLElement, blockId: string): HTMLElement {
  const block = container.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
  if (!block)
    throw new Error(`Editor is missing block ${blockId}`)
  return block
}

function blockParagraphText(container: HTMLElement, blockId: string): string {
  const paragraph = blockElement(container, blockId).querySelector<HTMLElement>(':scope > .list-content > p')
  if (!paragraph)
    throw new Error(`Editor block ${blockId} is missing its direct paragraph`)
  return paragraph.textContent ?? ''
}

function blockIdForText(container: HTMLElement, text: string): string {
  const block = within(container).getByText(text, { exact: true }).closest<HTMLElement>('[data-block-id]')
  const blockId = block?.dataset.blockId
  if (!blockId)
    throw new Error(`Editor text ${text} is not inside an identified block`)
  return blockId
}

function rootBlockIds(container: HTMLElement): string[] {
  const editor = container.querySelector<HTMLElement>('[data-editor-content]')
  if (!editor)
    throw new Error('Editor content was not rendered')
  return Array.from(editor.children).map((element) => {
    const blockId = (element as HTMLElement).dataset.blockId
    if (!blockId)
      throw new Error('Root editor block is missing its blockId')
    return blockId
  })
}

function renderedTopicState(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-block-id]'))
    .map((block) => {
      const blockId = block.dataset.blockId
      if (!blockId)
        throw new Error('Rendered Topic block is missing its blockId')
      return {
        blockId,
        kind: block.dataset.listKind,
        parentId: block.parentElement?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null,
        text: blockParagraphText(container, blockId),
      }
    })
    .sort((left, right) => left.blockId.localeCompare(right.blockId))
}

function sortedVersion(note: ReturnType<typeof createEditorNote>) {
  return [...note.getVersion()].sort((left, right) => left.peer.localeCompare(right.peer) || left.counter - right.counter)
}

function connectNotes(left: ReturnType<typeof createEditorNote>, right: ReturnType<typeof createEditorNote>) {
  const leftToRight: Uint8Array[] = []
  const rightToLeft: Uint8Array[] = []
  let importing = false
  const stopLeft = left.subscribe((change) => {
    if (!importing)
      leftToRight.push(change.update)
  })
  const stopRight = right.subscribe((change) => {
    if (!importing)
      rightToLeft.push(change.update)
  })

  return {
    disconnect: () => {
      stopLeft()
      stopRight()
    },
    flush: async () => {
      const updatesForRight = leftToRight.splice(0)
      const updatesForLeft = rightToLeft.splice(0)
      await act(async () => {
        importing = true
        try {
          updatesForRight.forEach(update => right.importUpdates(update))
          updatesForLeft.forEach(update => left.importUpdates(update))
        }
        finally {
          importing = false
        }
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })
    },
  }
}

function topicTreeNode(runtime: ReturnType<typeof resolveEditorTopicDocument>, blockId: string) {
  const node = runtime.tree.getNodes().find((candidate) => {
    const attributes = candidate.data.get('attributes')
    return attributes !== null
      && typeof attributes === 'object'
      && !Array.isArray(attributes)
      && !(attributes instanceof Uint8Array)
      && (attributes as Record<string, unknown>).blockId === blockId
  })
  if (!node)
    throw new Error(`Topic tree is missing block ${blockId}`)
  return node
}

function parentBlockId(container: HTMLElement, blockId: string): string | null {
  return blockElement(container, blockId).parentElement?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null
}

describe('collaborative Notes', () => {
  it('undoes and redoes Topic edits through the Loro tree history', async () => {
    const note = createEditorNote({
      id: 'note-undo',
      initialTopic: { initialContent: documentWithText('undo-node', 'Before'), mode: EditorMode.Document, title: '' },
    })
    const [topicEntry] = note.getEntries()
    if (!topicEntry || topicEntry.kind !== 'topic')
      throw new Error('Expected the initial Topic')
    const topicId = topicEntry.id
    const rendered = render(
      <Editor
        adapters={adapters}
        topic={note.getTopic(topicId)}
      />,
    )
    await within(rendered.container).findByText('Before')
    expect(note.getEntries().find(entry => entry.id === topicId)).toMatchObject({ title: 'Before' })
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')
    if (!editor)
      throw new Error('Editor content was not rendered')
    await userEvent.click(editor)
    await userEvent.keyboard('{End} after')
    await waitFor(() => {
      expect(rendered.container.querySelector('[data-block-id="undo-node"]')).toHaveTextContent('Before after')
      expect(note.getEntries().find(entry => entry.id === topicId)).toMatchObject({ title: 'Before after' })
    })

    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => {
      expect(rendered.container.querySelector('[data-block-id="undo-node"]')).toHaveTextContent('Before')
      expect(note.getEntries().find(entry => entry.id === topicId)).toMatchObject({ title: 'Before' })
    })
    await userEvent.keyboard(redoShortcut())
    await waitFor(() => {
      expect(rendered.container.querySelector('[data-block-id="undo-node"]')).toHaveTextContent('Before after')
      expect(note.getEntries().find(entry => entry.id === topicId)).toMatchObject({ title: 'Before after' })
    })
  })

  it.each([
    { kind: 'bullet' as const, mode: EditorMode.Document },
    { kind: 'outline' as const, mode: EditorMode.Outline },
  ])('moves a Topic block with native tree identity in $mode mode and syncs it to another peer', async ({ kind, mode }) => {
    const sourceNote = createEditorNote({ id: `note-move-${mode}` })
    const topicId = sourceNote.createTopic({ initialContent: twoBlockDocument(kind), mode, title: `${mode} topic` })
    const sourceTopic = sourceNote.getTopic(topicId)
    const sourceRuntime = resolveEditorTopicDocument(sourceTopic)
    const source = render(
      <Editor
        adapters={adapters}
        topic={sourceTopic}
      />,
    )
    await within(source.container).findByText('Second')
    const sourceBlockId = topicTreeNode(sourceRuntime, 'B').id

    const snapshot = sourceNote.exportSnapshot()
    const receiverNote = createEditorNote({ id: `note-move-${mode}`, snapshot })
    const receiverTopic = receiverNote.getTopic(topicId)
    const receiverRuntime = resolveEditorTopicDocument(receiverTopic)
    const receiver = render(<Editor adapters={adapters} topic={receiverTopic} />)
    await within(receiver.container).findByText('Second')
    const receiverBlockId = topicTreeNode(receiverRuntime, 'B').id
    const receiverVersion = receiverNote.getVersion()

    await userEvent.click(within(source.container).getByText('Second'))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(source.container, 'B')).toBe('A'))

    const movedSource = topicTreeNode(sourceRuntime, 'B')
    expect(movedSource.id).toBe(sourceBlockId)
    expect(movedSource.parent()?.id).toBe(topicTreeNode(sourceRuntime, 'A').id)
    expect(movedSource.index()).toBe(1)

    await act(async () => {
      receiverNote.importUpdates(sourceNote.exportUpdates(receiverVersion))
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })
    await waitFor(() => expect(parentBlockId(receiver.container, 'B')).toBe('A'))
    const movedReceiver = topicTreeNode(receiverRuntime, 'B')
    expect(movedReceiver.id).toBe(receiverBlockId)
    expect(movedReceiver.parent()?.id).toBe(topicTreeNode(receiverRuntime, 'A').id)
  })

  it('exports a snapshot containing a Folder and an initialized Topic', async () => {
    const note = createEditorNote({ id: 'note-initialized' })
    const defaultTopic = note.getEntries()[0]
    if (defaultTopic?.kind !== 'topic')
      throw new Error('New Note is missing its default Topic')
    const folderId = note.createFolder({ name: 'Research' })
    const topicId = note.createTopic({ initialContent: documentWithText('initial', 'Initial document'), mode: EditorMode.Document, title: '' })
    const rendered = render(
      <Editor
        adapters={adapters}
        topic={note.getTopic(topicId)}
      />,
    )

    await within(rendered.container).findByText('Initial document')
    await waitFor(() => expect(note.exportSnapshot().byteLength).toBeGreaterThan(0))
    expect(note.getEntries()).toMatchObject([
      { id: defaultTopic.id, kind: 'topic', parentId: null, title: '' },
      { id: folderId, kind: 'folder', name: 'Research', parentId: null },
      { id: topicId, kind: 'topic', parentId: null, title: 'Initial document' },
    ])
  })

  it('restores a Topic editor from a Note snapshot', async () => {
    const original = createEditorNote({ id: 'note-restore' })
    const topicId = original.createTopic({ initialContent: documentWithText('saved-node', 'Saved entirely in memory'), mode: EditorMode.Document, title: 'Saved topic' })
    const first = render(
      <Editor
        adapters={adapters}
        topic={original.getTopic(topicId)}
      />,
    )
    await within(first.container).findByText('Saved entirely in memory')
    const snapshot = original.exportSnapshot()
    first.unmount()

    const restored = createEditorNote({ id: 'note-restore', snapshot })
    const second = render(
      <Editor adapters={adapters} topic={restored.getTopic(topicId)} />,
    )

    const block = await waitFor(() => {
      const element = second.container.querySelector('[data-block-id="saved-node"]')
      expect(element).toHaveTextContent('Saved entirely in memory')
      return element
    })
    expect(block).toHaveAttribute('data-list-kind', 'outline')
  })

  it('stores the numeric editor mode in a Topic and synchronizes mode changes between editors', async () => {
    const source = createEditorNote({ id: 'note-mode-sync' })
    const topicId = source.createTopic({ initialContent: documentWithText('mode-node', 'Mode content'), mode: EditorMode.Document, title: 'Mode topic' })
    const initialized = render(
      <Editor
        adapters={adapters}
        topic={source.getTopic(topicId)}
      />,
    )
    await within(initialized.container).findByText('Mode content')
    expect(source.getEntries().find(entry => entry.id === topicId)).toMatchObject({
      id: topicId,
      kind: 'topic',
      mode: EditorMode.Document,
    })
    const snapshot = source.exportSnapshot()
    initialized.unmount()

    const leftNote = createEditorNote({ id: 'note-mode-sync', snapshot })
    const rightNote = createEditorNote({ id: 'note-mode-sync', snapshot })
    const leftTopic = leftNote.getTopic(topicId)
    const rightTopic = rightNote.getTopic(topicId)
    const left = render(<Editor adapters={adapters} topic={leftTopic} />)
    const right = render(<Editor adapters={adapters} topic={rightTopic} />)
    await within(left.container).findByText('Mode content')
    await within(right.container).findByText('Mode content')
    const connection = connectNotes(leftNote, rightNote)

    expect(leftTopic.getMode()).toBe(EditorMode.Document)
    expect(rightTopic.getMode()).toBe(EditorMode.Document)
    expect(left.container.querySelector('[data-editor-mode="document"]')).not.toBeNull()
    expect(right.container.querySelector('[data-editor-mode="document"]')).not.toBeNull()

    act(() => leftTopic.setMode(EditorMode.Outline))
    await connection.flush()
    await waitFor(() => {
      expect(leftTopic.getMode()).toBe(EditorMode.Outline)
      expect(rightTopic.getMode()).toBe(EditorMode.Outline)
      expect(left.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull()
      expect(right.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull()
    })

    act(() => rightTopic.setMode(EditorMode.Document))
    await connection.flush()
    await waitFor(() => {
      expect(leftTopic.getMode()).toBe(EditorMode.Document)
      expect(rightTopic.getMode()).toBe(EditorMode.Document)
      expect(left.container.querySelector('[data-editor-mode="document"]')).not.toBeNull()
      expect(right.container.querySelector('[data-editor-mode="document"]')).not.toBeNull()
    })
    connection.disconnect()
  })

  it('synchronizes incremental Note updates between Topic editors', async () => {
    const source = createEditorNote({ id: 'note-sync' })
    const topicId = source.createTopic({ initialContent: documentWithText('shared-node', 'Shared text'), mode: EditorMode.Document, title: 'Shared topic' })
    const initialized = render(
      <Editor
        adapters={adapters}
        topic={source.getTopic(topicId)}
      />,
    )
    await within(initialized.container).findByText('Shared text')
    const snapshot = source.exportSnapshot()
    initialized.unmount()

    const senderNote = createEditorNote({ id: 'note-sync', snapshot })
    const receiverNote = createEditorNote({ id: 'note-sync', snapshot })
    const sender = render(<Editor adapters={adapters} topic={senderNote.getTopic(topicId)} />)
    const receiver = render(<Editor adapters={adapters} topic={receiverNote.getTopic(topicId)} />)
    await within(sender.container).findByText('Shared text')
    await within(receiver.container).findByText('Shared text')
    const receiverVersion = receiverNote.getVersion()
    expect(receiverVersion).toHaveLength(1)
    expect(receiverVersion[0]?.counter).toBeGreaterThan(0)

    await userEvent.click(sender.container.querySelector<HTMLElement>('[data-editor-content]')!)
    await userEvent.keyboard('{End} synchronized')
    await waitFor(() => expect(sender.container.querySelector('[data-block-id="shared-node"]')).toHaveTextContent('Shared text synchronized'))

    const updates = senderNote.exportUpdates(receiverVersion)
    await act(async () => {
      receiverNote.importUpdates(updates)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })

    await waitFor(() => expect(receiver.container.querySelector('[data-block-id="shared-node"]')).toHaveTextContent('Shared text synchronized'))
  })

  it('converges after two peers edit one Topic independently', async () => {
    const source = createEditorNote({ id: 'note-convergence' })
    const topicId = source.createTopic({ initialContent: documentWithText('collaborative-node', 'Common'), mode: EditorMode.Document, title: 'Collaborative topic' })
    const initialized = render(
      <Editor
        adapters={adapters}
        topic={source.getTopic(topicId)}
      />,
    )
    await within(initialized.container).findByText('Common')
    const snapshot = source.exportSnapshot()
    initialized.unmount()

    const leftNote = createEditorNote({ id: 'note-convergence', snapshot })
    const rightNote = createEditorNote({ id: 'note-convergence', snapshot })
    const left = render(<Editor adapters={adapters} topic={leftNote.getTopic(topicId)} />)
    const right = render(<Editor adapters={adapters} topic={rightNote.getTopic(topicId)} />)
    await within(left.container).findByText('Common')
    await within(right.container).findByText('Common')
    const sharedVersion = leftNote.getVersion()

    await userEvent.click(left.container.querySelector<HTMLElement>('[data-editor-content]')!)
    await userEvent.keyboard('{End} from-left')
    await waitFor(() => expect(left.container.querySelector('[data-block-id="collaborative-node"]')).toHaveTextContent('Common from-left'))

    await userEvent.click(right.container.querySelector<HTMLElement>('[data-editor-content]')!)
    await userEvent.keyboard('{Home}from-right ')
    await waitFor(() => expect(right.container.querySelector('[data-block-id="collaborative-node"]')).toHaveTextContent('from-right Common'))

    const leftUpdates = leftNote.exportUpdates(sharedVersion)
    const rightUpdates = rightNote.exportUpdates(sharedVersion)
    await act(async () => {
      leftNote.importUpdates(rightUpdates)
      rightNote.importUpdates(leftUpdates)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })

    await waitFor(() => {
      const leftText = left.container.querySelector('[data-block-id="collaborative-node"]')?.textContent
      const rightText = right.container.querySelector('[data-block-id="collaborative-node"]')?.textContent
      expect(leftText).toBe(rightText)
      expect(leftText).toContain('from-left')
      expect(leftText).toContain('from-right')
      expect(leftText).toContain('Common')
    })
  })

  it('keeps two connected Topic editors converged through interleaved text, insertion, and tree moves', async () => {
    const source = createEditorNote({ id: 'note-online-interleaved' })
    const topicId = source.createTopic({ initialContent: flatDocument([['A', 'Alpha'], ['B', 'Beta'], ['C', 'Gamma']]), mode: EditorMode.Outline, title: 'Online collaboration' })
    const initialized = render(
      <Editor
        adapters={adapters}
        topic={source.getTopic(topicId)}
      />,
    )
    await within(initialized.container).findByText('Gamma')
    const snapshot = source.exportSnapshot()
    initialized.unmount()

    const leftNote = createEditorNote({ id: 'note-online-interleaved', snapshot })
    const rightNote = createEditorNote({ id: 'note-online-interleaved', snapshot })
    const leftTopic = leftNote.getTopic(topicId)
    const rightTopic = rightNote.getTopic(topicId)
    const leftRuntime = resolveEditorTopicDocument(leftTopic)
    const rightRuntime = resolveEditorTopicDocument(rightTopic)
    const left = render(<Editor adapters={adapters} topic={leftTopic} />)
    const right = render(<Editor adapters={adapters} topic={rightTopic} />)
    await within(left.container).findByText('Gamma')
    await within(right.container).findByText('Gamma')
    const connection = connectNotes(leftNote, rightNote)

    await userEvent.click(within(left.container).getByText('Alpha', { exact: true }))
    await userEvent.keyboard('{End} left-online')
    await connection.flush()
    await waitFor(() => expect(blockParagraphText(right.container, 'A')).toBe('Alpha left-online'))

    await userEvent.click(within(right.container).getByText('Beta', { exact: true }))
    await userEvent.keyboard('{Home}right-online ')
    await connection.flush()
    await waitFor(() => expect(blockParagraphText(left.container, 'B')).toBe('right-online Beta'))

    await userEvent.click(within(left.container).getByText('right-online Beta', { exact: true }))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(left.container, 'B')).toBe('A'))
    await connection.flush()
    await waitFor(() => expect(parentBlockId(right.container, 'B')).toBe('A'))

    await userEvent.click(within(right.container).getByText('Gamma', { exact: true }))
    await userEvent.keyboard('{End} right-online{Enter}Right-created')
    const createdBlockId = await waitFor(() => blockIdForText(right.container, 'Right-created'))
    await connection.flush()
    await waitFor(() => expect(blockIdForText(left.container, 'Right-created')).toBe(createdBlockId))

    await userEvent.click(within(left.container).getByText('Right-created', { exact: true }))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(left.container, createdBlockId)).toBe('C'))
    await connection.flush()
    await waitFor(() => expect(parentBlockId(right.container, createdBlockId)).toBe('C'))

    expect(rootBlockIds(left.container)).toEqual(['A', 'C'])
    expect(rootBlockIds(right.container)).toEqual(['A', 'C'])
    expect(blockParagraphText(left.container, 'A')).toBe('Alpha left-online')
    expect(blockParagraphText(left.container, 'B')).toBe('right-online Beta')
    expect(blockParagraphText(left.container, 'C')).toBe('Gamma right-online')
    expect(blockParagraphText(left.container, createdBlockId)).toBe('Right-created')
    expect(renderedTopicState(left.container)).toEqual(renderedTopicState(right.container))
    expect(sortedVersion(leftNote)).toEqual(sortedVersion(rightNote))
    for (const blockId of ['A', 'B', 'C', createdBlockId])
      expect(topicTreeNode(leftRuntime, blockId).id).toBe(topicTreeNode(rightRuntime, blockId).id)

    connection.disconnect()
    const convergedState = renderedTopicState(left.container)
    const convergedVersion = sortedVersion(leftNote)
    const leftHistory = leftNote.exportUpdates()
    const rightHistory = rightNote.exportUpdates()
    await act(async () => {
      leftNote.importUpdates(rightHistory)
      rightNote.importUpdates(leftHistory)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })
    expect(renderedTopicState(left.container)).toEqual(convergedState)
    expect(renderedTopicState(right.container)).toEqual(convergedState)
    expect(sortedVersion(leftNote)).toEqual(convergedVersion)
    expect(sortedVersion(rightNote)).toEqual(convergedVersion)
  })

  it('merges complex offline edits after two Topic editors reconnect', async () => {
    const source = createEditorNote({ id: 'note-offline-reconnect' })
    const topicId = source.createTopic({
      initialContent: flatDocument([
        ['A', 'Shared anchor'],
        ['B', 'Left target'],
        ['C', 'Right target'],
        ['D', 'Movable'],
      ]),
      mode: EditorMode.Outline,
      title: 'Offline collaboration',
    })
    const initialized = render(
      <Editor
        adapters={adapters}
        topic={source.getTopic(topicId)}
      />,
    )
    await within(initialized.container).findByText('Movable')
    const snapshot = source.exportSnapshot()
    initialized.unmount()

    const leftNote = createEditorNote({ id: 'note-offline-reconnect', snapshot })
    const rightNote = createEditorNote({ id: 'note-offline-reconnect', snapshot })
    const leftTopic = leftNote.getTopic(topicId)
    const rightTopic = rightNote.getTopic(topicId)
    const leftRuntime = resolveEditorTopicDocument(leftTopic)
    const rightRuntime = resolveEditorTopicDocument(rightTopic)
    const left = render(<Editor adapters={adapters} topic={leftTopic} />)
    const right = render(<Editor adapters={adapters} topic={rightTopic} />)
    await within(left.container).findByText('Movable')
    await within(right.container).findByText('Movable')
    const sharedVersion = sortedVersion(leftNote)
    expect(sortedVersion(rightNote)).toEqual(sharedVersion)

    await userEvent.click(within(left.container).getByText('Shared anchor', { exact: true }))
    await userEvent.keyboard('{End} left-offline')
    await userEvent.click(within(left.container).getByText('Left target', { exact: true }))
    await userEvent.keyboard('{End} revised{Tab}{End}{Enter}Left branch')
    const leftBranchId = await waitFor(() => blockIdForText(left.container, 'Left branch'))
    expect(parentBlockId(left.container, 'B')).toBe('A')
    expect(parentBlockId(left.container, leftBranchId)).toBe('A')

    await userEvent.click(within(right.container).getByText('Shared anchor', { exact: true }))
    await userEvent.keyboard('{Home}right-offline ')
    await userEvent.click(within(right.container).getByText('Right target', { exact: true }))
    await userEvent.keyboard('{End} revised')
    await userEvent.click(within(right.container).getByText('Movable', { exact: true }))
    await userEvent.keyboard('{Tab}{End}{Enter}Right branch')
    const rightBranchId = await waitFor(() => blockIdForText(right.container, 'Right branch'))
    expect(parentBlockId(right.container, 'D')).toBe('C')
    expect(parentBlockId(right.container, rightBranchId)).toBe('C')
    expect(renderedTopicState(left.container)).not.toEqual(renderedTopicState(right.container))

    const leftUpdates = leftNote.exportUpdates(sharedVersion)
    const rightUpdates = rightNote.exportUpdates(sharedVersion)
    await act(async () => {
      leftNote.importUpdates(rightUpdates)
      rightNote.importUpdates(leftUpdates)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })

    await waitFor(() => {
      expect(blockParagraphText(left.container, 'A')).toBe('right-offline Shared anchor left-offline')
      expect(blockParagraphText(right.container, 'A')).toBe('right-offline Shared anchor left-offline')
      expect(renderedTopicState(left.container)).toEqual(renderedTopicState(right.container))
    })
    expect(rootBlockIds(left.container)).toEqual(['A', 'C'])
    expect(rootBlockIds(right.container)).toEqual(['A', 'C'])
    expect(blockParagraphText(left.container, 'B')).toBe('Left target revised')
    expect(blockParagraphText(left.container, 'C')).toBe('Right target revised')
    expect(blockParagraphText(left.container, 'D')).toBe('Movable')
    expect(blockParagraphText(left.container, leftBranchId)).toBe('Left branch')
    expect(blockParagraphText(left.container, rightBranchId)).toBe('Right branch')
    expect(parentBlockId(left.container, 'B')).toBe('A')
    expect(parentBlockId(left.container, leftBranchId)).toBe('A')
    expect(parentBlockId(left.container, 'D')).toBe('C')
    expect(parentBlockId(left.container, rightBranchId)).toBe('C')
    expect(sortedVersion(leftNote)).toEqual(sortedVersion(rightNote))
    for (const blockId of ['A', 'B', 'C', 'D', leftBranchId, rightBranchId])
      expect(topicTreeNode(leftRuntime, blockId).id).toBe(topicTreeNode(rightRuntime, blockId).id)

    const convergedState = renderedTopicState(left.container)
    const convergedVersion = sortedVersion(leftNote)
    await act(async () => {
      leftNote.importUpdates(rightUpdates)
      rightNote.importUpdates(leftUpdates)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })
    expect(renderedTopicState(left.container)).toEqual(convergedState)
    expect(renderedTopicState(right.container)).toEqual(convergedState)
    expect(sortedVersion(leftNote)).toEqual(convergedVersion)
    expect(sortedVersion(rightNote)).toEqual(convergedVersion)
  })

  it('travels to an earlier Note version and returns to the editable latest version', async () => {
    const note = createEditorNote({ id: 'note-timeline' })
    const topicId = note.createTopic({ initialContent: documentWithText('timeline-node', 'Before'), mode: EditorMode.Document, title: 'Timeline topic' })
    const rendered = render(
      <Editor
        adapters={adapters}
        topic={note.getTopic(topicId)}
      />,
    )
    await within(rendered.container).findByText('Before')
    const earlierVersion = note.getVersion()

    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')
    if (!editor)
      throw new Error('Editor content was not rendered')
    await userEvent.click(editor)
    await userEvent.keyboard('{End} after')
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="timeline-node"]')).toHaveTextContent('Before after'))
    const latestVersion = note.getVersion()
    expect(latestVersion).not.toEqual(earlierVersion)

    await act(async () => {
      note.checkout(earlierVersion)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="timeline-node"]')).toHaveTextContent('Before'))
    expect(note.isTimeTraveling()).toBe(true)

    await act(async () => {
      note.checkoutLatest()
      await new Promise<void>(resolve => queueMicrotask(resolve))
    })
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="timeline-node"]')).toHaveTextContent('Before after'))
    expect(note.isTimeTraveling()).toBe(false)

    await userEvent.click(editor)
    await userEvent.keyboard('{End} again')
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="timeline-node"]')).toHaveTextContent('Before after again'))
  })
})
