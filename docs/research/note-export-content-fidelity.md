# Note HTML/PDF 导出内容保真调研

调研日期：2026-09-04

## 结论

HTML 与 PDF 应共用一个“静态内容投影”（validated Topic JSON + 专用 Topic state），再分别由 HTML serializer 和浏览器 `printToPDF`/等价打印边界输出。不要把编辑器 DOM、React state 或 Electron 路由作为导出源：常规 Topic 的规范数据是 `LoroTopicDocument`，而白板和 image-occlusion 的数据分别位于 Topic 专用 state 中。

投影器必须先通过现有 schema 校验，再以节点类型逐一映射。任何不支持的交互都要留下可见的静态替代（文字、占位框或静态图像）并累计诊断；不能静默丢失。HTML 自包含意味着应用 CSS 应内联，受管资源应读取并转为 data URL；外部 URL 仅作为最后的可见降级，并在诊断中标出，因此离线 PDF 不会假装已内嵌资源。

## 数据源与边界证据

- `LoroTopicDocument` 只允许 `blockquote`, `codeBlock`, `heading`, `horizontalRule`, `image`, `list`, `mathBlock`, `paragraph`, `table` 等块，以及 `cardDelimiter`, `hardBreak`, `mathInline`, `tag`, `text` 内联节点；文档根必须是 `list` block，且 blockId 唯一。[`topic-document-schema.ts:5-49`](../../packages/editor/src/schema/topic-document-schema.ts#L5-L49)、[`topic-document-schema.ts:89-101`](../../packages/editor/src/schema/topic-document-schema.ts#L89-L101)、[`topic-document-schema.ts:163-223`](../../packages/editor/src/schema/topic-document-schema.ts#L163-L223)
- 支持的 marks 是 `bold`, `cloze`, `code`, `inlineHighlight`, `italic`, `link`, `strike`, `underline`；cloze/highlight/card delimiter 的属性含有学习卡身份，不应成为导出文件中的可执行交互。[`packages/editor/src/schema/topic-document-schema.ts:24-32`](../../packages/editor/src/schema/topic-document-schema.ts#L24-L32)、[`packages/editor/src/schema/card-schema.ts:82-159`](../../packages/editor/src/schema/card-schema.ts#L82-L159)。现有 Card Preview 已将 heading/blockquote/code/image/tag/list/table 等节点渲染成语义 HTML，可作为 serializer 的映射参考。[`packages/editor/src/card/card-rich-content.tsx:199-286`](../../packages/editor/src/card/card-rich-content.tsx#L199-L286)
- 常规文本投影目前只保留 block 的 id/kind/attrs/parent/text；它会把 tag 变成 `#label`、image 变成 alt、hard break 变成换行，说明这些是可靠的无富 DOM 文本降级，但不能单独用于保真 HTML。[`topic-projection.ts:3-18`](../../packages/editor/src/note/topic-projection.ts#L3-L18)、[`topic-projection.ts:20-65`](../../packages/editor/src/note/topic-projection.ts#L20-L65)
- Whiteboard 由 Excalidraw scene（elements/appState/files）和可嵌入的 Topic 编辑器组成；嵌入编辑器可以投影成普通 Topic blocks，但 Excalidraw scene 本身是任意对象。[`packages/editor/src/note/editor-note-whiteboard.ts:144-180`](../../packages/editor/src/note/editor-note-whiteboard.ts#L144-L180)、[`apps/desktop/renderer/src/features/notes/editor/whiteboard-editor.tsx:252-285`](../../apps/desktop/renderer/src/features/notes/editor/whiteboard-editor.tsx#L252-L285)
- Image occlusion state 包含原图尺寸/src、hide 模式及归一化 ellipse/rectangle/brush shapes；source 可以来自 Topic image 或 Reader region。[`packages/editor/src/image-occlusion/image-occlusion-model.ts:11-67`](../../packages/editor/src/image-occlusion/image-occlusion-model.ts#L11-L67)、[`packages/editor/src/schema/topic-schema.ts:180-239`](../../packages/editor/src/schema/topic-schema.ts#L180-L239)
- Reader reference 只有 text（quote + location）或 region（image + location），linked reference 还包含 bookTopicId/annotationId；UI 当前将其作为 source header，并把导航交互放在 Link 中。[`packages/editor/src/note/topic-reader-reference.ts:1-38`](../../packages/editor/src/note/topic-reader-reference.ts#L1-L38)、[`apps/desktop/renderer/src/features/notes/editor/note-editor-topic-chrome.tsx:105-163`](../../apps/desktop/renderer/src/features/notes/editor/note-editor-topic-chrome.tsx#L105-L163)

## HTML/PDF 支持矩阵

| 内容 | 自包含 HTML | PDF | 交互/损失策略 |
| --- | --- | --- | --- |
| Regular Topic、嵌套 blocks | 原生 section/article；`list(kind)` 递归为 `ul`/`ol`/`li`，保留层级、heading、paragraph、blockquote、code、hr | 同一 HTML 打印，分页时避免 block 内断裂 | 不输出 blockId/卡内部 ID 到可见正文；可放 `data-*` 供诊断。未知 block kind 仍按其 children 输出并附“unsupported block”注记 |
| Marks、hard break、tag | `strong/em/u/s/code/mark`；link 用 `<a href>`；hardBreak 为 `<br>`；tag 为不可交互的 `#label` | 同 HTML | cloze 以已揭示文本输出（不隐藏、不带复习动作）；inlineHighlight 保留颜色但使用对比度安全的 CSS；cardDelimiter 输出方向符号（`→/←/↔/—`），不输出卡操作 |
| Images | 受管 `memorilo:` asset 读取后二进制内联为 data URL；普通 `http(s)` 保留 URL 并警告；缺 src 输出带 alt 的占位框 | 优先 data URL；远程/缺失资源输出占位框和 alt，避免打印时依赖网络 | `imageId` 仅用于关联 occlusion，不暴露为 UI 文本。资产收集规则可复用 [`projectNoteAssetReferences`](../../apps/desktop/main/src/assets/asset-references.ts#L14-L49) 和 URI 校验 [`asset-uri.ts`](../../apps/desktop/main/src/assets/asset-uri.ts#L7-L45) |
| Tables | 原生 `<table><thead>/<tbody><tr><th>/<td>`；单元格递归渲染 block 内容；保留空 cell | 同 HTML，设置 `thead` 重复和 `table-layout: fixed` 等打印 CSS | 不支持交互式调整列宽/选择；保留所有单元格文字与 marks |
| Math inline/block | 使用现有 KaTeX 配置生成 MathML（inline 或 display）；同时保留源 LaTeX 在 `data-math-source`/`<code>` fallback | MathML 能力不足时用源 LaTeX 的等宽块；渲染错误显示源而非空白 | [`packages/editor/src/sample/katex.ts:1-8`](../../packages/editor/src/sample/katex.ts#L1-L8) 已证明 `output: 'mathml', throwOnError: false` 的无交互路径 |
| Tasks | `list(kind="task")` 输出静态 checkbox（`checked`/`status`）与正文；due/start/end/repeat 等可追加一行“Schedule: …”元信息 | 同 HTML | 不输出计时器、提醒、完成操作；所有非空 task attrs 以可读文本保留，未知 attrs 进诊断 |
| Reader source / Book Topic | source header 作为 `<aside>`：text 用 blockquote，region 用内联图像 + location；Book 文档正文照常导出 | 同 HTML | linked annotation 仅输出 annotation/book/location 摘要，移除 `/reader` 导航和打开按钮；原书文件本身不复制进 HTML/PDF，缺资源显示占位 |
| Whiteboard | scene 优先调用 Excalidraw 静态 SVG/PNG 导出（含 files）；无法渲染时输出“Whiteboard scene unavailable”占位和 scene element 数；随后按顺序输出 embedded editors 的普通 Topic 内容 | 使用同一静态图；嵌入 editor 内容作为后续 section | 不导出画布选择、缩放、工具栏、链接交互或可编辑 embed；保持嵌入编辑器文字，明确 scene 是静态快照 |
| Image occlusion | 原图 `<img>` 上叠加归一化 SVG shapes（ellipse/rect/brush），附 mode/source caption；reader-region source 同样显示 source image | 组合成一张静态图（或 HTML overlay 打印）+ caption | `hide-all/hide-one` 不执行遮挡交互；shape ids/group ids 不可见但可放 `data-*`；缺源图显示占位与 shape 数 |

## 统一 fallback 与诊断契约

1. 投影器输入先执行 `validateLoroTopic`；校验失败应整体失败，不产生半截 HTML/PDF。
2. 每个降级项生成结构化诊断：`path`（topic/block/node）、`kind`、`reason`、`fallback`。HTML 在对应位置插入 `<aside class="export-warning">…</aside>`；PDF 保留同样文字，便于用户发现损失。
3. 不安全或不可解析 URL 不作为 HTML 原始 markup；文本使用 DOM API/escaping。外部图片、白板 scene、Reader 资源加载失败必须变成可打印占位，而不是空白或异常中止。
4. 导出实现应有一个纯同步“Topic -> ExportDocument”层；资源读取、KaTeX、Excalidraw rasterization 和 PDF 保存属于边界适配器。HTML 与 PDF 只消费同一中间表示，以保证两种格式内容一致。
5. 交互状态（cloze reveal、task timer、whiteboard zoom、reader navigation、occlusion reveal）全部冻结为当前可读值；导出文件不携带脚本或应用 IPC。

## 推荐实现顺序

先实现 Regular/Book 的 NodeJSON serializer（含 marks、table、math、images、tasks、Reader aside）并建立诊断通道；随后接入 Image-occlusion SVG；最后接入 Whiteboard 的静态 scene exporter。PDF 只需将同一自包含 HTML 交给打印边界，避免维护第二套布局逻辑。
