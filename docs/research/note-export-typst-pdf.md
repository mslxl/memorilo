# Note Typst PDF 生成与保存边界调研

调研日期：2026-09-06  
目标：评估使用 Typst.ts 将 Note 的静态投影编译为 PDF，替代 Electron `webContents.printToPDF`。

## 结论

可以采用 Typst.ts，但 PDF 导出不应把 HTML 作为中间步骤。导出层应先构造经过校验的、与格式无关的 `ExportDocument`；HTML serializer 消费它生成自包含 HTML，Typst serializer 消费同一对象生成 `.typ` 源和资源清单。主进程再调用 Typst 编译器得到 PDF bytes，最后执行保存。

在 Electron 主进程中，优先使用 `@myriaddreamin/typst-ts-node-compiler`（TypeScript/JavaScript API + N-API 原生编译器），而不是浏览器 WASM backend：Node 包直接提供 `NodeCompiler.create`、`compile`、`pdf`，并有 workspace、font paths 和 font blobs 选项。若发布策略不接受原生 addon，再评估 `@myriaddreamin/typst.ts` + `@myriaddreamin/typst-ts-web-compiler` 的 WASM backend；WASM 能在 Node 运行但官方明确说明其操作系统访问受限。

## API 与运行边界

### Node backend（推荐）

`@myriaddreamin/typst-ts-node-compiler@0.7.0` 的官方声明提供：

```ts
const compiler = NodeCompiler.create({ workspace, fontArgs })
const compiled = compiler.compile({ mainFileContent, mainFilePath })
const pdf: Buffer = compiler.pdf(compiled.result!)
```

`compile` 返回带 `result`、diagnostics、error/warning 状态的结果对象；`pdf` 返回 Node `Buffer`，可直接交给主进程文件写入。`RenderPdfOpts` 支持 PDF standard、tagged PDF 和 creation timestamp。包使用 N-API，并通过 `optionalDependencies` 发布 macOS arm64/x64、Windows x64/arm64、Linux 等平台包；electron-builder 必须保留对应 `.node` 文件并将 native addon 配置为 unpacked。该包的官方 README 还注明预构建包通过 npm 按平台选择，不应在应用启动时从网络下载。

来源：[`typst.node` README](https://github.com/Myriad-Dreamin/typst.ts/tree/main/packages/typst.node)、[`@myriaddreamin/typst-ts-node-compiler@0.7.0` npm 元数据](https://www.npmjs.com/package/@myriaddreamin/typst-ts-node-compiler/v/0.7.0)、[Node API 声明（0.7.0 tarball）](https://unpkg.com/@myriaddreamin/typst-ts-node-compiler@0.7.0/index-napi.d.ts)。

### WASM backend（备用）

`@myriaddreamin/typst.ts@0.7.0` 的 `CompileFormatEnum.pdf`、`TypstCompiler.compile` 和 `TypstWorld.pdf` 都声明返回 `Uint8Array`，并携带结构化 diagnostics。初始化需要提供 `getModule()`（或使用 `./wasm` 导出）；WASM 二进制不能假设由运行时从网络取得，打包时应作为应用资源显式携带。`MemoryAccessModel.insertFile(path, bytes, mtime)` 能为源文件和图片提供虚拟文件；`addSource`/`mapShadow` 可注入源内容。

官方 `typst-ts-web-compiler` README 说明它也能在 Node.js 运行，但对操作系统访问有限，并建议需要完整 OS 访问时使用 `typst.node`。因此 WASM 方案必须自行提供 access model、资源和字体；不要把 Electron 主进程的真实路径或 IPC 暴露给编译器。

来源：[`@myriaddreamin/typst.ts@0.7.0` npm](https://www.npmjs.com/package/@myriaddreamin/typst.ts/v/0.7.0)、[compiler API 源码](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/compiler.mts)、[MemoryAccessModel 源码](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/fs/memory.mts)、[web compiler README](https://github.com/Myriad-Dreamin/typst.ts/tree/main/packages/compiler)。

## 资源、字体与离线要求

Typst 的 `image` 以文件路径或 bytes 读取图片；最稳妥的导出协议是把受管资源写入受控的虚拟 access model（WASM）或一次性临时 workspace（Node），然后在 Typst 源中引用 `/assets/<opaque-id>.<ext>`。不要把 `memorilo:` URI、本地绝对路径或任意用户路径写进 `.typ`。

Typst 官方 CLI 的 smoke test 明确验证 `#image("https://example.org/image.png")` 在无网络编译时失败并给出“network access is not supported”提示。因此外链图片必须在投影阶段下载并转成本地 bytes；下载失败只能生成可见的占位和诊断，不能让 Typst 编译时隐式联网。SVG、PNG、JPEG 等资源可按其真实扩展名注入；SVG 是静态图，不执行交互。

`typst.ts` 的默认字体 asset loader 使用 CDN URL，`preloadFontAssets`/`loadFonts` 也支持 URL。生产导出必须关闭默认远程 assets，并通过 Node `fontArgs.fontPaths`/`fontBlobs` 或 WASM `loadFonts(Uint8Array[])` 注入随应用发布的字体。CJK 需要显式携带覆盖目标语言的字体（例如 Noto Serif/ Sans CJK）；否则跨平台的字体 fallback 会改变字宽和分页。应用需要在编译前固定字体集合，不能依赖用户机器字体来保证可复现。

来源：[Typst CLI 无网络图片测试](https://github.com/typst/typst/blob/main/crates/typst-cli/tests/smoke.rs)、[`image` reference](https://typst.app/docs/reference/visualize/image/)、[`text`/font reference](https://typst.app/docs/reference/text/text/)、[`typst.ts` font initialization](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/options.init.mts)。

## 内容能力与投影影响

Typst 原生支持 heading、paragraph、引用、列表、代码、表格、数学、图片和 `pagebreak()`；表格可跨页流动，`pagebreak()` 可在语义投影中表达显式分页。SVG/PNG 等图片可作为静态资源嵌入。HTML 中已有的 KaTeX/MathML 不能原样放进 Typst：math 节点必须另写 LaTeX-to-Typst（或受限数学）serializer；转换失败时输出源 LaTeX 和诊断。whiteboard、image-occlusion 应先变成静态表格/图片，再由 Typst serializer 输出。

因此 `ExportDocument` 至少需要：块层级和 marks、静态图片资源及 MIME/扩展名、数学源的目标格式、表格列/行数据、显式 page-break、以及结构化诊断。HTML 与 Typst 的分页和换行不可能逐像素一致；验收应比较语义内容和明确的版式规则，而不是复用 HTML CSS。

来源：[Typst table](https://typst.app/docs/reference/model/table/)、[Typst pagebreak](https://typst.app/docs/reference/layout/pagebreak/)、[Typst math](https://typst.app/docs/reference/math/)。

## 包体、许可证与生命周期

0.7.0 官方元数据：`@myriaddreamin/typst.ts` 为 Apache-2.0、约 1.4 MB unpacked；`typst-ts-web-compiler` 为 Apache-2.0、约 28.4 MB（其中 WASM 约 27 MB）；`typst-ts-node-compiler` JS 包约 45 KB，但 macOS/Windows/Linux 平台 native 包约 44–52 MB，各平台只应随对应构建产物带入。Typst.ts 与 Typst 的许可证、字体许可证必须在发布审查中分别确认，不能把第三方 CJK 字体视为 Apache-2.0。

WASM compiler/MemoryAccessModel 和 Node compiler 都维护缓存。主进程应复用一个已初始化的 compiler，但以串行队列保护编译；每次请求显式传入 `inputs`，避免跨任务污染。每次导出完成后释放临时 world/access model；应用退出或取消时中止队列并清理临时 workspace。不要在 renderer 中持有 compiler 实例。

## 保存边界

保存边界仍由主进程拥有，但生成步骤改为：

1. 读取并校验 Note，构造 `ExportDocument`，解析受管资源并生成 Typst 源；投影失败整体拒绝。
2. 在受控临时目录/MemoryAccessModel 中放置 `.typ` 和资源，调用 Node `compiler.compile` + `compiler.pdf`（或 WASM `compile(...pdf)`）取得 PDF bytes；编译 diagnostics 中的 error 使任务失败。
3. 用户确认目标路径后，在目标目录创建唯一临时文件，写入 PDF bytes，必要时 `fsync`，再 `rename` 到目标；失败清理临时文件。
4. 返回 `saved`、`cancelled` 或结构化 `failed`，并在所有分支释放 compiler world、access model 和临时目录。取消、编译失败或应用关闭都不能创建/截断目标文件。

这条边界不需要 `BrowserWindow`、HTML 页面或 `webContents.printToPDF`；PDF 的字节来源是 Typst 编译器，HTML 只是另一个独立导出格式。

## 风险与未决约束

- 采用 Node native backend 会扩大各平台安装包并要求 electron-builder 正确处理 optional native dependencies；若团队不能接受，应在实现前选择 WASM backend，并接受自建 access model 与字体注入工作。
- Typst 与 HTML 的版式不会天然一致；需要单独确定纸张、页边距、标题层级和分页规则，并为 math/复杂嵌套内容定义降级。
- 不应自行承诺旧 Typst 版本或未来 schema 的兼容；编译器版本、字体集合和导出 schema 应固定并在升级时显式迁移。

