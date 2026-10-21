# OrcaNote 重要功能与口碑调研

调研日期：2026-08-11

## 结论摘要

Orca Note 的差异化重点不是“又一个 Markdown 编辑器”，而是把**细粒度双向大纲**作为底层编辑模型，再叠加属性标签、多条件查询、块级关系可视化和可编程扩展。官网还把白板、思维导图、表格、AI 助手、MCP 工具和 CLI 放在同一产品能力清单中。[Orca Note 官方产品页](https://www.orca-studio.com/orcanote/)（访问于 2026-08-11）

目前能找到的“风评好”证据规模较小：一条 GitHub 用户反馈明确称产品“用起来非常顺手”，并认为默认状态下比其他笔记软件更好用；主仓库约 213 stars，社区资源库约 15 stars、17 forks。但这些数字不是评分，也不能代表广泛用户满意度。检索范围内没有找到可靠的 App Store 评分、Reddit 长评或独立媒体评测，因此应把以下结论表述为“有实际使用迹象和少量正面反馈”，而不是“市场普遍好评”。

## 证据等级

- **官方明确能力**：Orca Studio 官网、官方隐私政策、官方 GitHub release notes 直接描述的功能或政策。
- **用户口碑/使用迹象**：公开 GitHub issue 中用户的主动反馈、需求和问题；样本小，不能外推总体满意度。
- **项目活跃度信号**：GitHub stars、forks、release 频率等可观察指标；不是产品质量评分。
- **未证实**：没有可靠公开来源支持的能力，不纳入“已具备”结论。

## 1. 重要且有特色的官方功能

| 功能 | 官方描述与可借鉴价值 | 证据边界 |
| --- | --- | --- |
| 双向大纲（Bi-directional Outlining） | 官方称其为“Advanced fine-grained bi-directional outliner”。这说明编辑粒度是块/大纲节点级，而不是只围绕整篇文档；适合把写作、重组和引用放在同一工作流中。 | 官网只给出产品描述，没有公开完整数据模型或同步冲突规则。 |
| Super Tags | 标签带属性，可从多个维度标注笔记；比单纯关键词标签更接近结构化资料库。 | 官网未列出属性类型、查询语法或迁移保证。 |
| 多条件搜索 | 官网称提供多条件查询编辑器和多种结果视图；对大卡片库/知识库的筛选和再利用很关键。 | 未公开查询语言的完整规范和性能指标。 |
| 音频/视频笔记 | 可捕获时间戳和截图，并一键跳回具体时刻；适合课程、访谈和会议记录，把媒体证据与笔记块关联。 | 官网没有说明支持的编码格式、转录能力或跨设备行为。 |
| 白板 | 无限画布且与笔记深度整合；适合空间化整理，再回到结构化块。 | “深度整合”是官方营销表述，具体对象同步/嵌入规则未公开。 |
| 块级图谱（Block Graph） | 以块级图谱可视化笔记连接，比文档级 graph 更适合追踪局部引用关系。 | 未公开图谱计算规模上限。 |
| 思维导图 | 可将大纲转换成思维导图，用于头脑风暴和视觉组织；官方更新日志还显示它是持续优化的完整编辑视图。 | 布局算法和导图与大纲的双向编辑约束未公开。 |
| AI 助手 | 可与笔记对话，辅助创作和知识管理；更新日志确认支持 AI chat 自定义 prompt 和 AI rewriting 自定义 prompt。 | AI 模型、数据发送边界、上下文选择和计费未在产品页完整说明。 |
| MCP 工具 | 让 AI agent 直接读取、写入、查询或删除笔记库；这是面向 agent 工作流的高差异化能力。 | “删除”意味着高权限操作；使用前应核对权限、审计和确认机制，官网未说明细节。 |
| Orca Note CLI | 支持脚本、批处理和命令行自动化；社区资源库将其定位为可供 AI agent 使用的 companion CLI。 | CLI 的命令/稳定性应以其独立仓库为准。 |

官网还提供 Windows、macOS、Linux、iOS、Android 下载入口；各桌面入口当前指向官方 GitHub releases。[Orca Note 官方产品页](https://www.orca-studio.com/orcanote/)（访问于 2026-08-11）

## 2. 隐私与本地优先：优势与边界

官网的 Privacy First 文案是“Your notes are stored only on your device”。官方隐私政策进一步规定：使用 Orca Note 创建、修改和保存的本地文件默认存储在本地设备；除非用户主动上传到在线服务或通过服务分享，Orca Note 不收集、存储或访问这些本地文件。[Orca Note 官方产品页](https://www.orca-studio.com/orcanote/)；[Orca Note Privacy Policy](https://www.orca-studio.com/orcanote/privacy)（均访问于 2026-08-11）

因此更准确的结论是：**本地优先/默认本地存储是官方明确政策**，但不能简化成“所有场景绝不联网”。产品页和更新日志都提到 S3 sync；用户 issue #447 报告 S3 同步缺少端到端加密、图片等内容会直接上传到 S3。[GitHub issue #447](https://github.com/sethyuan/orca-note/issues/447)（创建于 2026-05-15，访问于 2026-08-11）这是一条用户风险反馈，不等同于官方承认的安全漏洞，但足以提醒：启用同步时需要单独评估云端暴露和加密责任。

## 3. 官方更新日志显示的成熟方向

官方 GitHub release notes 说明产品仍在高频迭代，且最近的改进集中在结构化视图和自动化：

- `v1.83.0`（2026-06-30）：加入 mind map view（完整思维导图编辑器）、block graph 入口、跨块格式化。[Release v1.83.0](https://github.com/sethyuan/orca-note/releases/tag/v1.83.0)（访问于 2026-08-11）
- `v1.85.0`（2026-07-17）：加入 MCP `s3_sync` 工具、白板双击选块、面板最大化、搜索语法提示和仓库切换弹窗。[Release v1.85.0](https://github.com/sethyuan/orca-note/releases/tag/v1.85.0)（访问于 2026-08-11）
- `v1.87.0`（2026-07-24）：增强 computed properties，并为思维导图增加左右平衡/右侧树状两种布局及路径 breadcrumb。[Release v1.87.0](https://github.com/sethyuan/orca-note/releases/tag/v1.87.0)（访问于 2026-08-11）
- `v1.88.0`（2026-08-01）：优化白板默认块样式、块图文字显示阈值、思维导图连线；增加 S3 同步退出提示、插件 API 的流式/非流式 AI 调用接口和实验性编辑器路径 breadcrumb。[Release v1.88.0](https://github.com/sethyuan/orca-note/releases/tag/v1.88.0)（访问于 2026-08-11）

这组更新支持一个谨慎判断：白板、块图、思维导图、查询/计算属性和 AI/agent 接口是作者持续投入的主航道；但版本快速迭代也意味着行为和交互仍可能变化，不应把官网清单当作长期稳定 API 合同。

## 4. 可验证的正面口碑与使用迹象

### 4.1 明确的正面用户评价

GitHub issue #469（2026-05-28）开头写道：“虎鲸用起来非常顺手，我个人用下来觉得默认状态下比其他的笔记软件要好使一些。”用户随后在关闭全部插件、默认主题下，详细测试浮动预览、链接搜索、引用块编辑、全局快捷键和索引命令等细节。该反馈在肯定整体编辑体验的同时，也提出了多项 UX 改进，属于**有具体使用深度的正面评价，而非泛泛点赞**。[GitHub issue #469](https://github.com/sethyuan/orca-note/issues/469)（创建于 2026-05-28，访问于 2026-08-11）

### 4.2 双向链接/反链确实进入用户工作流

- issue #466 的用户描述在超大卡片库中编写双链、确保概念被引用的实际困难，并建议“潜在引用”能力；这证明双链/引用是实际使用中的核心工作流，同时也说明目前没有公开证据表明产品已提供语义级自动推荐。[GitHub issue #466](https://github.com/sethyuan/orca-note/issues/466)（创建于 2026-05-23，访问于 2026-08-11）
- issue #443 直接讨论已有反链筛选功能但缺少“快速排除”条件，说明反链查询已经被使用到需要更细筛选的程度。[GitHub issue #443](https://github.com/sethyuan/orca-note/issues/443)（创建于 2026-05-15，访问于 2026-08-11）

### 4.3 AI 助手已有实际使用，但交互仍在打磨

issue #480 的用户写明已有多种 AI 对话触发方式，但认为右键、侧栏和 `Ctrl+J` 路径不够方便，建议用 `Ctrl+Shift` 点击块标快速触发。这能证明 AI 对话已进入真实工作流；同时不能据此宣称其快捷交互已经成熟。[GitHub issue #480](https://github.com/sethyuan/orca-note/issues/480)（创建于 2026-06-11，访问于 2026-08-11）

### 4.4 社区扩展的规模信号

官方维护的 [awesome-orcanote](https://github.com/sethyuan/awesome-orcanote) 收录插件、主题、AI skills、CLI、教程和 Discord 等资源。GitHub API 在 2026-08-11 的快照显示该仓库约 15 stars、17 forks；主仓库约 213 stars、2 forks、35 open issues。[awesome-orcanote API](https://api.github.com/repos/sethyuan/awesome-orcanote)；[orca-note API](https://api.github.com/repos/sethyuan/orca-note)（访问于 2026-08-11）

这些是“有开发者关注和扩展活动”的弱到中等信号，不是用户评分；数量也仍然较小。

## 5. 负面反馈与采用风险

口碑判断必须同时保留以下公开问题：

- S3 同步的端到端加密疑虑，且图片等内容会直接上传（issue #447）。
- 长日志页面明显卡顿（issue #451）。[GitHub issue #451](https://github.com/sethyuan/orca-note/issues/451)（创建于 2026-05-16，访问于 2026-08-11）
- 全局搜索可能触发 HTML 注入（issue #460）。[GitHub issue #460](https://github.com/sethyuan/orca-note/issues/460)（创建于 2026-05-20，访问于 2026-08-11）
- Windows 1.89 版本无法打开 AI 设置界面（issue #519，仍为 open）。[GitHub issue #519](https://github.com/sethyuan/orca-note/issues/519)（创建于 2026-08-07，访问于 2026-08-11）

这些 issue 有的已关闭、有的仍开放；关闭状态只表示 issue 生命周期状态，不能单独证明修复质量。若将 Orca Note 的设计借鉴到 Memorilo，应优先验证本地数据边界、同步加密、搜索输入清理、长文档性能和 AI 权限确认。

## 6. 给 Memorilo 的优先级建议

结合官方能力和有限口碑证据，最值得研究的顺序是：

1. **双向大纲 + 块级引用/反链**：这是产品最明确的核心编辑差异，也有真实用户围绕引用完整性和反链筛选提出需求。
2. **属性标签 + 多条件查询**：把块变成可筛选的结构化知识单元，适合大规模资料库。
3. **本地优先与清晰同步边界**：官方本地文件政策值得借鉴，但启用云同步时必须明确加密、上传范围和恢复责任。
4. **白板/块图/思维导图作为同一块模型的视图**：能让结构化笔记在空间、关系和层级三种视图间切换；Orca Note 的更新日志表明这条路线持续投入。
5. **AI 助手 + MCP/CLI**：自动化潜力最大，但要先做好权限、可审计操作、失败反馈和快捷触发路径，不应只复制功能名。

## 7. 检索限制

本次公开检索未找到可核验的 App Store 评分、Reddit 长评或独立媒体评测。官网、官方 GitHub 和 GitHub issue 的样本存在作者维护偏差，且 GitHub stars/forks 不能替代满意度调查。因此“风评好”只能谨慎表述为：**核心编辑体验有少量明确正面反馈，双链/反链和 AI 已被用户实际使用，社区存在一定扩展活动；尚无证据支持“广泛好评”。**

## 8. 白板与思维导图如何实现

### 8.1 公开证据的上限

Orca Note 的公开主仓库当前只有 `README.md` 和 `README.zh.md`，没有应用源码、`package.json` 或 lockfile。因此无法从主仓库源码确认白板和思维导图的内部实现。[orca-note public tree](https://github.com/sethyuan/orca-note/tree/main)（访问于 2026-08-11）不过，官方 `v1.89.1` macOS ARM 发布包的 `app.asar` 可以直接检查依赖和运行时代码：其中包含 `@excalidraw/excalidraw@0.18.0`、Excalidraw 的 `renderEmbeddable`、Library 和 scene JSON；没有发现 `tldraw` 或 `@tldraw/*`。因此，下面对白板主体的判断已经从“截图推断”提升为“针对该发行版的包级确认”。[Orca Note v1.89.1 release](https://github.com/sethyuan/orca-note/releases/tag/v1.89.1)（访问于 2026-08-12）

官方 Plugin API 仍能确认其公共技术底座：插件通过全局 React/ReactDOM 渲染，通过 Valtio 读取响应式 `orca.state`；`Block` 包含 `id`、富内容、纯文本、`parent`、`left`、`children`、属性、引用和反向引用；特殊 `_repr` 属性用于声明块类型并携带交给 React renderer 的附加元数据。Panel 另有 `view`、`viewArgs` 和 `viewState`。这些是公开接口事实，但不能直接证明核心白板和导图内部也完全沿用插件实现。[Orca Note Plugin API Quick Start](https://www.orca-studio.com/orcanote-docs/documents/Quick_Start.html)（访问于 2026-08-11）

### 8.2 思维导图：大纲块树的可编辑投影视图

官方产品页的定义是“Turn your outlines into mind maps”，而 `v1.83.0` 将其称为 mind map **view**，同时强调它也是完整的 mind map editor。公开截图中的每个导图节点直接显示标题、富文本、列表、图片或链接等原笔记块内容；节点之间的线对应 `parent -> children` 层级。这些证据共同支持：思维导图不是另一份独立文档，而是同一棵块树的另一种可编辑视图。[Orca Note 产品页](https://www.orca-studio.com/orcanote/)；[Release v1.83.0](https://github.com/sethyuan/orca-note/releases/tag/v1.83.0)（均访问于 2026-08-11）

可确认或高可信的处理流程是：

```text
选定根 Block
    -> 按 children 关系展开子树
    -> 以 Block ID 和内容生成可编辑节点
    -> 自动计算树形位置
    -> 渲染节点与父子连线
    -> 编辑、移动或聚焦操作回到原 Block/视图状态
```

布局不是自由摆放。`v1.87.0` 明确提供“左右平衡”和“仅右侧树”两种模式，并增加路径 breadcrumb；`v1.88.0` 又把同层节点较多时的连线改成直角线。issue #498、#499 和 #511 还证明导图支持对子层级聚焦，并可在导图/大纲模式间退出和恢复。[Release v1.87.0](https://github.com/sethyuan/orca-note/releases/tag/v1.87.0)；[Release v1.88.0](https://github.com/sethyuan/orca-note/releases/tag/v1.88.0)；[issue #498](https://github.com/sethyuan/orca-note/issues/498)；[issue #499](https://github.com/sethyuan/orca-note/issues/499)；[issue #511](https://github.com/sethyuan/orca-note/issues/511)（均访问于 2026-08-11）

尚不能确认它使用 React Flow、D3、Dagre、ELK 或自研布局。截图只能证明节点像 DOM/React 卡片并复用块内容，不能据此外推具体图形库。

### 8.3 白板：画布场景与笔记块卡片的混合

官方截图显示白板包含手形平移、选择、矩形、菱形、椭圆、箭头、直线、自由绘制、文本、图片、橡皮、Library、撤销/重做和缩放控件。工具栏下方的 `1` 到 `0` 依次对应选择、矩形、菱形、椭圆、箭头、直线、绘制、文本、图片和橡皮，与 Excalidraw 的 `Tools.tsx` 数字快捷键逐项一致；tldraw 默认工具栏和快捷键是另一套体系。[Orca Note 产品页的 Whiteboard 截图](https://www.orca-studio.com/orcanote/)；[Excalidraw Tools.tsx](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/Tools.tsx)；[tldraw 默认工具栏](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/ui/components/Toolbar/DefaultToolbarContent.tsx)（访问于 2026-08-12）

结合 `v1.89.1` 包级证据，更准确的实现描述是：

```text
Orca 白板
  = @excalidraw/excalidraw@0.18.0
  + Orca 自定义白板块和 Library
  + Orca 自定义块卡片/导航层
```

同一个发行版还打包了 `konva`、`react-konva`、`@xyflow/react` 和 `@dagrejs/dagre`；这些依赖更可能服务于自定义块视图、图谱或思维导图，不能据此推断白板主体使用 tldraw。

它又不只是普通绘图文件：截图里的卡片能显示完整块内容、表格说明和视频，并带返回原块的入口；`v1.85.0` 明确加入“双击白板，选择要加入白板的块”，`v1.88.0` 又优化了白板中的默认块样式。这支持如下数据分层推断：[Release v1.85.0](https://github.com/sethyuan/orca-note/releases/tag/v1.85.0)；[Release v1.88.0](https://github.com/sethyuan/orca-note/releases/tag/v1.88.0)（均访问于 2026-08-11）

```text
白板场景
  |- 普通画布元素：形状、箭头、手写、文本、图片
  `- 块卡片元素：Block ID + x/y/宽高/样式
                         |
                         `-> 从统一 Block store 读取并渲染实时内容
```

其中“块引用与几何信息分开存储”是根据产品行为得到的架构推断，不是公开数据库规范。公开资料没有说明场景 JSON 的格式、坐标和连线保存在哪里、块删除后的处理、多人冲突策略或导出管线。

### 8.4 可借鉴的核心

真正值得借鉴的不是某个画布库，而是**内容与视图分离**：思维导图从 `parent/children` 派生布局，通常无需复制正文；白板只保存空间场景和对 Block ID 的引用，块内容仍由统一数据源渲染。这样同一个块在大纲、导图和白板中保持同一身份，编辑后其他视图可以同步更新。Orca Note 的公开行为强烈符合这个模型，但其内部实现细节仍需作者源码或正式技术文档才能最终确认。

### 8.5 Excalidraw 是否能嵌入 React 组件

可以，但有三个层次：

1. **把 React 应用当作 iframe 嵌入**：先把组件部署成一个 URL，再使用 Excalidraw 的 embeddable/iframe 元素。组件可以完整交互，但它是独立文档，需自行处理通信、鉴权和安全策略。
2. **用 `renderEmbeddable` 返回 React JSX**：`@excalidraw/excalidraw` 的 `renderEmbeddable(element, appState)` 回调允许宿主替换默认 iframe renderer，直接返回一个 React `JSX.Element`。[Excalidraw render props](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/render-props)（访问于 2026-08-11）这正适合把 `element` 中的自定义 URL/标识映射成 `<BlockCard blockId="..." />`。
3. **把组件做成 Excalidraw 原生元素**：官方公开的元素生成和 JSON schema 主要覆盖 rectangle、ellipse、diamond、text、line/arrow、image、frame 等场景元素。[Excalidraw element skeleton](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)；[Excalidraw JSON schema](https://docs.excalidraw.com/docs/codebase/json-schema)（访问于 2026-08-11）任意 React DOM 并不会自动获得原生元素的选中、缩放、协作同步或导出能力；这些需要 fork/自定义 renderer 和额外的状态同步。

因此，若要实现 OrcaNote 风格的“实时笔记块”，最省力的形状通常是：Excalidraw 负责画布、缩放、选中、移动和场景保存；一个 embeddable element 保存 Block ID；`renderEmbeddable` 用 React 渲染块卡片。导出为 PNG/SVG 时，React 卡片是否能被绘出需要宿主额外处理，不能假设 Excalidraw 默认导出会包含任意 DOM。
