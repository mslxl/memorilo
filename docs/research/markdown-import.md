# Markdown 导入可行性调研

调研日期：2026-08-21

## 结论

Markdown 导入在当前架构中可行，且两个目标入口都已有合适的承载点：

1. **导入为新 Note 的默认 Topic**：一个 Markdown 文件整体成为一个 Topic；创建 Note 时将解析后的 Topic `initialContent` 一起提交，避免先创建空 Note 再补写内容。
2. **Note Structure 树右键导入为新 Topic**：当前树的右键菜单已经有 Add 子菜单；一个文件整体成为一个新子 Topic，解析后的 `initialContent` 可以直接传给 `EditorNote.createTopic`，并把右键目标的 entry id 作为 `parentId`。

已落地一个平台无关的 **Markdown -> Topic NodeJSON 转换器**，renderer 负责文件选择、确认和调用 Note API。实现采用 `mdast-util-from-markdown` 加 `mdast-util-gfm`，显式映射 Memorilo 的 flat-list、Todo、表格和图片节点；运行时依赖已声明在 [`packages/editor/package.json`](../../packages/editor/package.json)。

## 当前 Note / Topic 数据管线

### Topic 是可直接初始化的 ProseMirror 文档

`CreateTopicInput` 已包含 `initialContent?: NodeJSON`、`mode`、`parentId` 和 `title`。`EditorNote.createTopic` 由 entry repository 调用 `createTopicNode`；factory 会对内容执行 `normalizeOutlineDocument`、校验并初始化 Topic 所属的 Loro tree。[`packages/editor/src/note/editor-note.ts`](../../packages/editor/src/note/editor-note.ts)；[`packages/editor/src/note/editor-note-entry-repository.ts`](../../packages/editor/src/note/editor-note-entry-repository.ts)；[`packages/editor/src/note/editor-note-topic-factory.ts`](../../packages/editor/src/note/editor-note-topic-factory.ts)

`normalizeOutlineDocument` 的重要语义是：

- 每个顶层非 `list` 节点会被包成一个 `list(kind: "outline")` Block；
- 已有的 `list` 会递归补齐 `blockId`、`kind`、`checked`、`collapsed`、`order`；
- 生成的 Block id 默认使用 `crypto.randomUUID()`；
- 因此 Markdown 转换器不必自行生成最终 Block id，但必须输出可被 Topic ProseMirror schema 接受的普通文档节点。[`packages/editor/src/common/outline-document.ts`](../../packages/editor/src/common/outline-document.ts)

当前 Topic schema 是 ProseKit basic extension 加上 card、image id、task、tag、math 等自定义扩展。`prosemirror-flat-list` 使用单一 `list` 节点，而不是 CommonMark / ProseMirror Markdown 常见的 `bullet_list`、`ordered_list`、`list_item` 三层节点。[`packages/editor/src/schema/topic-prosemirror-schema.ts`](../../packages/editor/src/schema/topic-prosemirror-schema.ts)；[`packages/editor/src/schema/topic-document-schema.ts`](../../packages/editor/src/schema/topic-document-schema.ts)

### 新 Note 的差异

`EditorNote` 本身支持 `initialTopic?: Omit<CreateTopicInput, 'index' | 'parentId'>`，因此底层已经能原子地创建一个带自定义文档的 Note。可是 desktop API 的 `notes.create` 当前只接受 `title?` 和 `initialHeading?`，主进程 `createNote` 也只把 `initialHeading` 传成默认 Topic 的 H1。[`apps/desktop/api/src/operations.ts`](../../apps/desktop/api/src/operations.ts)；[`apps/desktop/main/src/notes/note-application-contracts.ts`](../../apps/desktop/main/src/notes/note-application-contracts.ts)；[`apps/desktop/main/src/notes/note-application-commands.ts`](../../apps/desktop/main/src/notes/note-application-commands.ts)

所以“新 Note 导入”有两种工程路径：

- **推荐**：扩展 `CreateNoteInput`，传入受约束的初始 Topic 文档（例如 `initialContent`、`mode`、可选 explicit topic title），在主进程内调用 `createEditorNote({ initialTopic: ... })` 后一次性 `runtime.commit`。这样失败时不会留下空 Note，也不会让协作者看到半成品。
- **较快但非原子**：先 `notes.create`，打开 renderer session，再对默认 Topic 做一次文档替换或批量 Block edit。现有持久化队列可以保存，但创建、解析和写入之间会有空 Topic 窗口，且需要定义导入失败后的清理行为。

### Note Structure 右键入口

`NoteInspectorContent` 在标题栏、Folder、普通 Topic 和 BookTopic 上分别调用 `onOpenContainer` / `onOpenBook`；`useNoteEntryContextMenu` 的 Add 子菜单目前已有 Topic、Whiteboard、Folder、Book。普通 Topic 和 Folder 都可作为 `createTopic` 的 parent，BookTopic 也按容器处理；Folder 不能作为 Folder 的 parent。新增“Import Markdown…”只需复用容器右键的 `parentId`，选择文件后调用：

```ts
opened.note.createTopic({
  initialContent: importedDocument,
  mode: EditorMode.Document,
  parentId,
  title: importedTitle,
})
```

调用发生在 renderer 的打开 Note session 中，产生的本地 Loro change 会沿现有 `subscribe` / persistence 队列落盘和广播。右键“新 Topic”路径无需新增数据库表或独立 Topic 存储。[`apps/desktop/renderer/src/features/notes/note-inspector.tsx`](../../apps/desktop/renderer/src/features/notes/note-inspector.tsx)；[`apps/desktop/renderer/src/features/notes/editor/note-entry-context-menu.tsx`](../../apps/desktop/renderer/src/features/notes/editor/note-entry-context-menu.tsx)；[`apps/desktop/renderer/src/features/notes/editor/note-editor.tsx`](../../apps/desktop/renderer/src/features/notes/editor/note-editor.tsx)

## 文件选择和调用边界

现有 Reader 使用隐藏的 `<input type="file">`，通过 `accept` 限制格式，拿到浏览器 `File` 后直接交给 Reader；图片上传也使用相同的 renderer File API。Markdown 单文件导入可以沿用这个模式，读取 `File.text()`，不需要把本机绝对路径暴露给 renderer。[`apps/desktop/renderer/src/features/reader/reader-layout.tsx`](../../apps/desktop/renderer/src/features/reader/reader-layout.tsx)；[`packages/editor/src/ui/image-upload-popover/image-upload-form.tsx`](../../packages/editor/src/ui/image-upload-popover/image-upload-form.tsx)

若未来要解析 Markdown 中的相对图片并把资源复制进应用资产目录，则需要主进程文件读取/资产导入 API，或改用 Electron `dialog.showOpenDialog` 返回路径后由主进程读取。Electron 官方 dialog API 支持 `openFile`、扩展名 filters 和取消结果，但这会扩大 preload/IPC 合同。[Electron `dialog.showOpenDialog`](https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogwindow-options)

按已确认的首版范围，只允许选择一个 `.md` / `.markdown` 文件，并在 renderer 中读取文本。多文件导入、目录导入和拖放不在本次范围。

## 解析器选型

### 方案 A：`prosemirror-markdown` + 自定义 Topic parser（首选评估）

ProseMirror 官方模块 `prosemirror-markdown` 提供 `MarkdownParser`，使用 markdown-it tokenization，再按可配置的 token map 创建 ProseMirror 文档；`ParseSpec` 支持 `node`、`block`、`mark`、`attrs/getAttrs`、`ignore` 等规则。[官方 README](https://github.com/ProseMirror/prosemirror-markdown)（仓库已迁移至 [code.haverbeke.berlin](https://code.haverbeke.berlin/prosemirror/prosemirror-markdown)）

它与当前 editor 的优势是可直接生成 ProseMirror Node，再调用 `toJSON()` 并交给 `normalizeOutlineDocument`。但默认 parser 面向 CommonMark basic schema，默认节点名是 `bullet_list`、`ordered_list`、`list_item` 等；它不能直接使用 Memorilo 的 `list` flat-list schema，也不会自动生成 `blockId`。需要自定义：

- `bullet_list` / `ordered_list` 映射为 `list`，并设置 `kind`、`order`；
- `list_item` 不作为独立节点，改为 flat-list 的 `list` 子节点结构；
- paragraph、heading、blockquote、fence/code、hr、image、em/strong/link/code_inline、hardbreak 映射到当前 schema 的节点和 marks；
- 最后运行 `normalizeOutlineDocument`，生成稳定 Block id。

这条路径依赖新增 `prosemirror-markdown` 和 `markdown-it`，但能复用现有 ProseMirror schema/校验，集成面最小。

### 已采用：`mdast-util-from-markdown` / GFM + 自定义 NodeJSON 转换

`mdast-util-from-markdown` 官方说明是把 Markdown 转成 mdast AST；它允许接入 `mdast-util-gfm`、frontmatter、math 等扩展。[官方 README](https://github.com/syntax-tree/mdast-util-from-markdown)；[`mdast-util-gfm`](https://github.com/syntax-tree/mdast-util-gfm)

这条路径便于在转换前处理 GFM task/table 和不支持的节点；当前实现自行把 mdast 的 block/inline 节点转换成 ProseMirror NodeJSON，并依赖 `normalizeOutlineDocument` 补齐 Block id。解析结果同时携带行号诊断，供确认框和完成 toast 使用。

## Markdown 语义映射边界

### 可以直接支持的 CommonMark 子集

建议第一版明确支持：段落、H1-H6、强调/加粗、行内 code、链接、引用、无序/有序列表、围栏代码、分隔线、硬换行、图片（仅 URL）。这些节点在当前 basic Topic schema 中有对应能力，列表需要转换为 flat-list `list`。

### GFM / 自有扩展必须显式决定

GFM 官方扩展包含 autolink literal、footnote、strikethrough、table、task list 等；`mdast-util-gfm` 明确列出了这些语法。[GFM extension README](https://github.com/syntax-tree/mdast-util-gfm)

当前项目已有 table、task 和 strike 能力，因此 GFM 模式可以支持表格、任务列表和删除线；实现工作主要是 parser token 到现有 Topic NodeJSON 的转换。导入对话框询问解析方言，默认选择 GFM，也允许切换严格 CommonMark；任务列表默认勾选“映射为 Memorilo Todo”，用户可以在导入前关闭。映射表如下：

| Markdown | Topic 候选映射 | 风险/问题 |
| --- | --- | --- |
| `* [ ]` / `* [x]` | `list(kind: "task", checked)` 并映射为 Todo（默认） | 日期、重复规则等缺失属性使用 Todo 默认值；取消选项时保留普通列表 |
| GFM table | `table` / `tableRow` / `tableCell` | GFM 模式支持；需处理表头、对齐和空单元格语义 |
| `~~text~~` | `strike` mark | GFM 模式支持 |
| footnote | 普通文本、独立 Block 或拒绝 | 当前 Topic schema 无 footnote 节点 |
| YAML frontmatter | 忽略、转 Note metadata 或正文 | 当前 Note API 没有 frontmatter metadata 字段 |
| `$...$` / `$$...$$` | `mathInline` / `mathBlock` | 没有统一 Markdown 方言，需明确语法和失败提示 |
| `#tag` | 普通文本或 Tag node | Tag node 需要持久化 tag id；不能仅凭字符串伪造 |
| raw HTML / HTML block | 拒绝、纯文本或忽略 | ProseMirror Markdown 默认关闭 HTML，避免直接注入 |

未映射 token 按已确认的首版策略继续导入并显示警告：HTML、frontmatter、footnote 等暂不支持内容不得静默丢失，应该记录节点位置和可读原因，并在导入完成后的 toast 中汇总。对会破坏文档结构的解析错误（例如无法完成的 Markdown token stream）仍应终止本次导入并保留原 Note 不变。

### 图片和相对路径

图片按现有编辑器的 insert/upload image 流程处理，不降级为普通链接：网络图片在确认导入时调用 `desktopRequests.importNetworkImage` 并写入托管资源 URL。首版 renderer 不暴露本机 Markdown 路径，因此相对图片会保留原始 `src` 并产生警告；后续若增加主进程文件读取/资产登记，再补齐相对资源导入。

## 标题和结构

导入会同时遇到三个标题：Note title、Topic title、Markdown 的 H1。已确认导入前弹出标题确认，让用户分别确认 Note/Topic 标题；文件名和首个 H1 只作为初始候选值：

- Note title：默认使用文件名去掉 `.md`；用户可以在确认框修改；
- Topic title：默认使用文件名或首个 H1；用户可以在确认框修改；
- H1：首版固定导入为一个 Topic，不按标题拆分多个 Topic；首个 H1 同时保留为正文 Block，不能因提取标题而静默丢失正文。

Topic title 可以从首个 H1 派生，但正文仍显示 H1。树右键导入也使用同一套规则。

## 建议的实现分层（仅研究建议）

```text
renderer File.text()
        |
        v
导入对话框（方言：GFM 默认 / CommonMark；标题确认；Todo 映射默认开启）
        |
        v
Markdown parser (CommonMark + explicitly chosen GFM)
        |
        v
Topic NodeJSON transformer
  - custom list/task/table mapping
  - unsupported syntax diagnostics
  - optional image resolver
        |
        v
normalizeOutlineDocument + validateLoroTopic
        |
  new Note: atomic notes.create(initialTopic), then navigate/open
  existing Note: opened.note.createTopic({ parentId, initialContent }), then navigate/open
        |
        v
toast: unsupported syntax / asset / parser warnings
```

转换器应是纯函数，输入文本和导入选项，输出 `NodeJSON`、标题候选和诊断；这样可以在 editor package 做 node tests，不依赖 Electron。文件选择、toast、导航、IPC 和 persistence 留在 renderer/main 边界。

## 已确认的首版产品决策

1. 一个 Markdown 文件固定导入成一个 Topic，不按标题拆成多个 Topic；该 Topic 可以是新 Note 的默认 Topic，也可以是树右键目标的子 Topic。
2. 导入对话框询问解析方言，默认 GFM，同时支持严格 CommonMark；GFM 模式支持表格、任务列表和删除线。
3. 导入前确认 Note title 和 Topic title；文件名/首个 H1 仅作为候选值。
4. 导入对话框询问任务列表是否映射为 Memorilo Todo，默认映射。
5. 图片沿用现有 insert/upload image 流程，不降级为普通链接。
6. HTML、frontmatter、footnote 等暂不支持的内容给出警告后继续导入，不因单个不支持节点使整个文件失败。
7. 导入完成后立即打开新 Note/Topic，并用 toast 展示解析和资源处理警告。

8. 首个 H1 保留为正文 Block。
9. Todo 缺失的日期、时间、重复规则和提醒属性全部置空。

仍需在实现中落实的技术约束不是新的产品决策：警告必须包含行号或节点位置（若 parser 提供）、导入事务失败时不能留下半成品、图片上传失败要可重试、以及所有警告需要走 `editor` locale 的中英文资源。

## 参考来源

- [ProseMirror Markdown README](https://github.com/ProseMirror/prosemirror-markdown)
- [ProseMirror Markdown source (`MarkdownParser`)](https://code.haverbeke.berlin/prosemirror/prosemirror-markdown/src/branch/main/src/from_markdown.ts)
- [mdast-util-from-markdown README](https://github.com/syntax-tree/mdast-util-from-markdown)
- [mdast-util-gfm README](https://github.com/syntax-tree/mdast-util-gfm)
- [markdown-it README](https://github.com/markdown-it/markdown-it)
- [CommonMark specification](https://spec.commonmark.org/current/)
- [GFM specification](https://github.github.com/gfm/)
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog)
