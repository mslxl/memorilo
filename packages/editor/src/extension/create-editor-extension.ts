import type { NodeJSON } from 'prosekit/core'
import type { ProsemirrorNode } from 'prosemirror-flat-list'
import type { EditorAdapters } from '../adapters/editor-adapters'
import type { CardReviewRuntime } from '../card/card-review-runtime'
import type { EditorShortcutConfiguration } from '../common/formatting-shortcuts'
import type { OutlineRuntime } from '../common/outline-runtime'
import type { EditorImageOcclusionIntegration } from '../image-occlusion/image-occlusion-model'
import type { EditorTopicRuntime } from '../note/editor-topic-runtime'
import type { EditorStore } from '../state/editor-store'
import { toError } from '@memorilo/effect-lifecycle'
import {
  LoroTreeEphemeralCursorPlugin,
  LoroTreeSyncPlugin,
  LoroTreeUndoPlugin,
  redo,
  undo,
} from '@memorilo/loro-prosemirror-tree'
import i18next from 'i18next'
import { defineBasicExtension } from 'prosekit/basic'
import {
  defineClipboardSerializer,
  defineCommands,
  defineDocChangeHandler,
  defineKeymap,
  definePlugin,
  isApple,
  Priority,
  union,
  withPriority,
} from 'prosekit/core'
import { defineCodeBlockShiki } from 'prosekit/extensions/code-block'
import { defineHorizontalRule } from 'prosekit/extensions/horizontal-rule'
import { defineImageUploadHandler } from 'prosekit/extensions/image'
import { defineMath } from 'prosekit/extensions/math'
import { definePlaceholder } from 'prosekit/extensions/placeholder'
import { defineReadonly } from 'prosekit/extensions/readonly'
import { Fragment, Slice } from 'prosekit/pm/model'
import { Plugin } from 'prosekit/pm/state'
import { defaultAttributesGetter, listToDOM } from 'prosemirror-flat-list'
import { defineCardExtension } from '../card/card-extension'
import { defineCardReviewExtension } from '../card/card-review-extension'
import { defineBlockIdExtension } from '../common/block-id-extension'
import { defineEditorKeymapExtension } from '../common/editor-keymap-extension'
import { defineFormattingShortcutGuards, defineFormattingShortcuts } from '../common/formatting-shortcuts'
import { normalizeOutlineDocument } from '../common/outline-document'
import { defineOutlineKeymapExtension } from '../common/outline-keymap-extension'
import { defineOutlineViewExtension } from '../common/outline-view-extension'
import { defineTableKeymapExtension } from '../common/table-keymap-extension'
import { defineDocumentDropExtension } from '../document/document-drop-extension'
import { defineDocumentKeymapExtension } from '../document/document-keymap-extension'
import { renderKaTeXMathBlock, renderKaTeXMathInline } from '../sample/katex.ts'
import { uploadErrorAtom } from '../state/editor-atoms'
import { TagRuntime } from '../tag/tag-runtime'
import { defineCodeBlockView } from '../ui/code-block-view/index.ts'
import { defineImageView } from '../ui/image-view/index.ts'
import { defineTagView } from '../ui/tag-view/index.ts'
import { defineTaskListView } from '../ui/task-list-view/index.ts'
import { EditorUploadRuntime } from './editor-upload-runtime'
import { defineImageIdExtension } from './image-id-extension'
import { defineInlineMathInputRule } from './inline-math-input-rule'
import { defineMathKeymapExtension } from './math-keymap-extension'
import { createNetworkImagePaste } from './network-image-paste'
import { defineTag } from './tag-extension'

function taskDOMAttributes(node: ProsemirrorNode): Record<string, string> {
  const output = node.type.spec.toDOM?.(node)
  if (!Array.isArray(output) || output[1] === null || typeof output[1] !== 'object' || Array.isArray(output[1]))
    return {}
  return Object.fromEntries(
    Object.entries(output[1])
      .filter(([name, value]) => name.startsWith('data-task-') && value !== null && value !== undefined)
      .map(([name, value]) => [name, String(value)]),
  )
}

function defineTaskClipboardSerializer() {
  // Attach task metadata while the native flat-list serializer still has the source list node.
  return withPriority(defineClipboardSerializer({
    nodesFromSchemaWrapper: nodesFromSchema => (schema) => {
      const nodes = nodesFromSchema(schema)
      return {
        ...nodes,
        list: node => listToDOM({
          node,
          nativeList: true,
          getAttributes: listNode => ({
            ...defaultAttributesGetter(listNode),
            ...(listNode.attrs.kind === 'task' ? taskDOMAttributes(listNode) : {}),
          }),
        }),
      }
    },
  }), Priority.highest)
}

function transformOutlineClipboardHTML(html: string): string {
  if (!html.includes('data-list-kind="outline"'))
    return html

  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const list of Array.from(document.body.querySelectorAll('ul, ol'))) {
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child.tagName === 'LI')
    if (!items.some(item => item.dataset.listKind === 'outline'))
      continue

    const fragment = document.createDocumentFragment()
    let nativeList: HTMLElement | null = null
    const flushNativeList = () => {
      if (nativeList) {
        fragment.append(nativeList)
        nativeList = null
      }
    }

    for (const item of items) {
      if (item.dataset.listKind === 'outline') {
        flushNativeList()
        const outline = document.createElement('div')
        outline.className = 'prosemirror-flat-list'
        for (const attribute of Array.from(item.attributes))
          outline.setAttribute(attribute.name, attribute.value)
        while (item.firstChild)
          outline.append(item.firstChild)
        fragment.append(outline)
        continue
      }

      if (!nativeList)
        nativeList = document.createElement(list.tagName.toLowerCase())
      nativeList.append(item)
    }
    flushNativeList()

    const firstChild = fragment.firstChild
    const slice = list.getAttribute('data-pm-slice')
    if (slice && firstChild instanceof HTMLElement)
      firstChild.setAttribute('data-pm-slice', slice)
    list.replaceWith(fragment)
  }
  return document.body.innerHTML
}

function defineOutlineClipboardParser() {
  return definePlugin(new Plugin({
    props: {
      transformPastedHTML: transformOutlineClipboardHTML,
    },
  }))
}

const pastedLearningIdentityKeys = new Set([
  'backwardCardId',
  'blockHighlightId',
  'cardItemDefinitionId',
  'cardId',
  'definitionId',
  'forwardCardId',
  'groupId',
  'highlightId',
  'id',
  'targetGroupId',
])

function remapPastedLearningIdentities(slice: Slice): Slice {
  const jsonNodes = slice.content.content.map(node => node.toJSON() as NodeJSON)
  const remappableIds = new Set<string>()
  const collect = (node: NodeJSON): void => {
    if (node.type === 'cardDelimiter') {
      for (const key of ['backwardCardId', 'definitionId', 'forwardCardId']) {
        const value = node.attrs?.[key]
        if (typeof value === 'string')
          remappableIds.add(value)
      }
    }
    for (const key of ['blockHighlightId', 'cardItemDefinitionId']) {
      const value = node.attrs?.[key]
      if (typeof value === 'string')
        remappableIds.add(value)
    }
    for (const mark of node.marks ?? []) {
      if (mark.type === 'cloze') {
        for (const key of ['cardId', 'definitionId', 'groupId']) {
          const value = mark.attrs?.[key]
          if (typeof value === 'string')
            remappableIds.add(value)
        }
      }
      if (mark.type === 'inlineHighlight' && typeof mark.attrs?.id === 'string')
        remappableIds.add(mark.attrs.id)
    }
    node.content?.forEach(collect)
  }
  jsonNodes.forEach(collect)

  const identities = new Map<string, string>()
  const remap = (value: unknown, key: string): unknown => {
    if (!pastedLearningIdentityKeys.has(key) || typeof value !== 'string' || !remappableIds.has(value))
      return value
    const mapped = identities.get(value) ?? crypto.randomUUID()
    identities.set(value, mapped)
    return mapped
  }
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(rewrite)
    if (value === null || typeof value !== 'object')
      return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      pastedLearningIdentityKeys.has(key) ? remap(child, key) : rewrite(child),
    ]))
  }
  const children = slice.content.content.map((node, index) => {
    const json = rewrite(jsonNodes[index]!) as NodeJSON
    return node.type.schema.nodeFromJSON(json)
  })
  return new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd)
}

function defineLearningIdentityClipboardParser() {
  return definePlugin(new Plugin({
    props: {
      transformPasted: remapPastedLearningIdentities,
    },
  }))
}

function defineOutlineDocumentNormalization() {
  return definePlugin(new Plugin({
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some(transaction => transaction.docChanged))
        return null
      if (newState.doc.content.content.every(node => node.type.name === 'list'))
        return null

      const normalized = newState.schema.nodeFromJSON(normalizeOutlineDocument(newState.doc.toJSON()))
      return newState.tr.replaceWith(0, newState.doc.content.size, normalized.content)
    },
  }))
}

function defineLoroTree(topic: EditorTopicRuntime) {
  const keymap = {
    'Mod-z': undo,
    'Mod-Z': redo,
    ...(!isApple ? { 'Mod-y': redo } : {}),
  }
  return withPriority(union(
    defineKeymap(keymap),
    defineCommands({ redo: () => redo, undo: () => undo }),
    definePlugin(LoroTreeEphemeralCursorPlugin(topic.presence)),
    definePlugin(LoroTreeUndoPlugin({ doc: topic.doc, manageSelection: false, undoManager: topic.undoManager })),
    defineOutlineDocumentNormalization(),
    definePlugin(LoroTreeSyncPlugin(topic)),
  ), Priority.high)
}

export function createEditorExtension(
  adapters: EditorAdapters,
  store: EditorStore,
  outlineRuntime: OutlineRuntime,
  onDocumentChange?: (document: NodeJSON) => void,
  topic?: EditorTopicRuntime,
  readOnly = false,
  cardReviewRuntime?: CardReviewRuntime,
  imageOcclusion?: EditorImageOcclusionIntegration,
  learningEnabled = true,
  shortcuts?: EditorShortcutConfiguration,
  onSemanticAction?: (action: 'cloze' | 'extract') => void,
) {
  const uploadRuntime = new EditorUploadRuntime(adapters.uploadImage, store)
  const uploader = uploadRuntime.uploader
  const tagRuntime = new TagRuntime(adapters.tagStorage)
  const networkImagePaste = createNetworkImagePaste(adapters)

  const editorExtension = union(
    defineBasicExtension(),
    defineFormattingShortcutGuards(shortcuts),
    defineFormattingShortcuts(shortcuts),
    defineCardExtension({ authoringEnabled: learningEnabled, onSemanticAction, shortcuts }),
    ...(cardReviewRuntime ? [defineCardReviewExtension(cardReviewRuntime)] : []),
    withPriority(defineBlockIdExtension(), Priority.highest),
    withPriority(defineImageIdExtension(), Priority.highest),
    defineTableKeymapExtension(),
    defineEditorKeymapExtension(),
    defineMathKeymapExtension(),
    defineDocumentDropExtension(outlineRuntime),
    defineDocumentKeymapExtension(outlineRuntime),
    defineOutlineKeymapExtension(outlineRuntime),
    defineOutlineViewExtension(outlineRuntime),
    defineDocChangeHandler((view) => {
      onDocumentChange?.(view.state.doc.toJSON())
    }),
    // Resolve the placeholder at render time from the current locale so it stays
    // in sync with the active language, reading through the shared global i18next
    // instance without needing to recreate the editor on language change.
    definePlaceholder({
      placeholder: () => i18next.t('ui.placeholder', { ns: 'editor' }),
    }),
    defineTag(tagRuntime),
    defineMath({
      renderMathBlock: renderKaTeXMathBlock,
      renderMathInline: renderKaTeXMathInline,
    }),
    defineInlineMathInputRule(),
    defineCodeBlockShiki(),
    defineHorizontalRule(),
    defineCodeBlockView(),
    defineImageView(imageOcclusion),
    defineTagView(tagRuntime),
    defineTaskListView(adapters.taskActions),
    defineTaskClipboardSerializer(),
    defineOutlineClipboardParser(),
    defineLearningIdentityClipboardParser(),
    defineImageUploadHandler({
      uploader,
      onError: ({ error }) => {
        if (uploadRuntime.closed)
          return
        const message = toError(error).message
        store.set(uploadErrorAtom, message)
      },
    }),
    networkImagePaste.extension,
    ...(readOnly ? [defineReadonly()] : []),
  )

  return {
    extension: topic
      ? union(editorExtension, defineLoroTree(topic))
      : editorExtension,
    networkImagePasteRuntime: networkImagePaste.runtime,
    tagRuntime,
    uploadRuntime,
    uploader,
  }
}

export type EditorExtension = ReturnType<typeof createEditorExtension>['extension']
