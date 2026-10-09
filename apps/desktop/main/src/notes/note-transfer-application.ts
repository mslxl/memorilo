import type {
  DesktopExportDiagnostic,
  DesktopNoteExportFormat,
  DesktopNoteExportResult,
  DesktopNoteImportResult,
  DesktopNoteTransferDecision,
  DesktopNoteTransferStart,
  DesktopNoteTransferState,
} from '@memorilo/desktop-api'
import type {
  AssetReferenceProjection,
  CreateImportedNoteInput,
  EditorStorage,
  RegisterAssetInput,
} from '@memorilo/editor-storage'
import type { TopicReaderReference, TopicValidationInput } from '@memorilo/editor/note'
import type { BookFileBinding, ReadingFormat } from '@memorilo/reading-model'
import type { ShelfReadingFileStore } from '@memorilo/shelf/node'
import type { BrowserWindow } from 'electron'
import type { NoteApplicationService } from './note-application-service'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, sep } from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { createZstdCompress, createZstdDecompress } from 'node:zlib'
import { renderTypstContent, typstTaskPrelude } from '@memorilo/editor/export'
import { cloneEditorNote, createEditorNote, NOTE_SCHEMA_VERSION } from '@memorilo/editor/note'
import { createOperationSupervisor } from '@memorilo/effect-lifecycle'
import { assertReadingFormat } from '@memorilo/reading-model'
import { dialog } from 'electron'
import * as tar from 'tar-stream'
import { projectNoteAssetReferences } from '../assets/asset-references'
import { assetFileNamePattern, assetSource, parseAssetFileName } from '../assets/asset-uri'
import { toStoredEntries, toStoredTopic } from './note-authoritative-projection'
import { projectNoteLearningCards, projectNoteReadingItems } from './note-learning-cards'
import { embedMemoAttachment, extractMemoAttachment } from './note-transfer-pdf'

const memoFormat = 'memorilo.memo' as const
const memoVersion = 1 as const
const maxSnapshotBytes = 256 * 1024 * 1024
const maxAssetBytes = 50 * 1024 * 1024
const maxArchiveBytes = 2 * 1024 * 1024 * 1024
const maxAssets = 10_000
const maxExportImageBytes = 50 * 1024 * 1024
const maxExternalImageRedirects = 5
const exportImageMimeExtensions: Readonly<Record<string, string>> = {
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
}
const manifestPath = 'manifest.json'
const snapshotPath = 'note.snapshot'

function showSaveDialog(owner: BrowserWindow | null, options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}

function showOpenDialog(owner: BrowserWindow | null, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

function showMessageBox(owner: BrowserWindow | null, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options)
}

interface MemoPayloadDescriptor {
  byteLength: number
  path: string
  sha256: string
}

interface MemoAssetDescriptor extends MemoPayloadDescriptor {
  fileName: string
  mimeType: string
  originalFileName: string
}

interface MemoBookDescriptor extends MemoPayloadDescriptor {
  format: ReadingFormat
  originalName: string
  sha256: string
}

interface MemoManifest {
  assets: readonly MemoAssetDescriptor[]
  books: readonly MemoBookDescriptor[]
  exportedAt: string
  format: typeof memoFormat
  formatVersion: typeof memoVersion
  note: {
    journalDate?: string
    kind: 'journal' | 'regular'
    schemaVersion: number
    sourceId: string
    title: string
  }
  snapshot: MemoPayloadDescriptor
  sourceAppVersion: string
}

type ImageOcclusionExportState = ReturnType<ReturnType<typeof createEditorNote>['getImageOcclusionTopic']>['getState'] extends () => infer State ? State : never

interface StagedFile {
  absolutePath: string
  archivePath: string
  byteLength: number
}

interface StagedAsset {
  bytes: Uint8Array
  descriptor: MemoAssetDescriptor
}

interface PublishedAssets {
  createdFileNames: readonly string[]
  fileNameMap: ReadonlyMap<string, string>
  registrations: readonly RegisterAssetInput[]
}

type AssetConflictDecision = 'copy' | 'local'

interface PublishedBooks {
  createdReadingIds: readonly string[]
}

interface TransferDependencies {
  appVersion: string
  assetDirectory: string | null
  flushRenderer: () => Promise<boolean>
  typstFontDirectories?: readonly string[]
  notes: Pick<NoteApplicationService, 'getNote'> & {
    getNoteTree: (input: { noteId: string }) => Promise<{
      entries: ReturnType<ReturnType<typeof createEditorNote>['getEntries']>
      journalDate?: string
      kind: 'journal' | 'regular'
      noteId: string
      title: string
    }>
  }
  shelfReadingFiles: Pick<ShelfReadingFileStore, 'deleteFromLibrary' | 'find' | 'readRange' | 'save'>
  storage: EditorStorage
}

type ExportNote = Awaited<ReturnType<NoteApplicationService['getNote']>>

interface TransferOperation {
  readonly controller: AbortController
  readonly format?: DesktopNoteExportFormat
  readonly id: string
  readonly kind: 'export' | 'import'
  readonly ownerId: number
  expiresAt?: ReturnType<typeof setTimeout>
  state: DesktopNoteTransferState
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface ExportResources {
  diagnostics: DesktopExportDiagnostic[]
  inline: ReadonlyMap<string, string>
  pdf: ReadonlyMap<string, { bytes: Uint8Array, path: string }>
}

interface ExportImageSource {
  kind: 'image' | 'reader-region'
  path: string
  source: string
}

/** The export boundary keeps Typst aligned with the validated Note tree. */
interface ExportDocument {
  entries: readonly ExportDocumentEntry[]
  title: string
}

interface ExportDocumentEntry {
  children: readonly ExportDocumentEntry[]
  id: string
  kind: 'folder' | 'topic'
  readerReference?: TopicReaderReference
  title: string
  validation?: TopicValidationInput
}

function exportImageMimeType(value: string | null): string | null {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return mimeType in exportImageMimeExtensions ? mimeType : null
}

function isHttpImageSource(source: string): boolean {
  try {
    const url = new URL(source)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username.length === 0
      && url.password.length === 0
  }
  catch {
    return false
  }
}

function decodeImageDataUrl(source: string): { bytes: Uint8Array, mimeType: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/isu.exec(source)
  if (!match)
    return null
  const mimeType = exportImageMimeType(match[1] ?? '')
  if (mimeType === null)
    return null
  const bytes = new Uint8Array(Buffer.from(match[2] ?? '', 'base64'))
  return { bytes, mimeType }
}

async function readExportImageResponse(response: Response): Promise<Uint8Array> {
  if (!response.body)
    return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const next = await reader.read()
    if (next.done)
      break
    byteLength += next.value.byteLength
    if (byteLength > maxExportImageBytes) {
      await reader.cancel()
      throw new Error('Image exceeds the 50 MiB export limit')
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchExportImage(source: string): Promise<{ bytes: Uint8Array, mimeType: string }> {
  let url = new URL(source)
  if (!isHttpImageSource(url.toString()))
    throw new Error('Only HTTP(S) image URLs without credentials are allowed')
  for (let redirect = 0; redirect <= maxExternalImageRedirects; redirect += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null)
        throw new Error(`Image redirect from ${source} has no location`)
      if (redirect === maxExternalImageRedirects)
        throw new Error('Image redirect limit exceeded')
      url = new URL(location, url)
      if (!isHttpImageSource(url.toString()))
        throw new Error('Image redirect must remain on HTTP(S) without credentials')
      continue
    }
    if (!response.ok)
      throw new Error(`Image request returned HTTP ${response.status}`)
    const mimeType = exportImageMimeType(response.headers.get('content-type'))
    if (mimeType === null)
      throw new Error('Image response did not declare a supported image MIME type')
    const declaredLength = response.headers.get('content-length')
    if (declaredLength !== null && Number(declaredLength) > maxExportImageBytes)
      throw new Error('Image exceeds the 50 MiB export limit')
    return { bytes: await readExportImageResponse(response), mimeType }
  }
  throw new Error('Image redirect limit exceeded')
}

function collectExportImageSources(note: ReturnType<typeof createEditorNote>): readonly ExportImageSource[] {
  const sources: ExportImageSource[] = []
  const seen = new Set<string>()
  const visit = (value: unknown, path: string, kind: ExportImageSource['kind']): void => {
    if (value === null || typeof value !== 'object')
      return
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`, kind))
      return
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`
      if ((key === 'src' || key === 'imageSrc' || key === 'dataURL') && typeof child === 'string' && child.length > 0) {
        const sourceKey = child
        if (!seen.has(sourceKey)) {
          seen.add(sourceKey)
          sources.push({ kind, path: childPath, source: child })
        }
      }
      visit(child, childPath, kind)
    }
  }
  for (const entry of note.getEntries()) {
    if (entry.kind !== 'topic')
      continue
    const validation = note.getTopicValidationInput(entry.id)
    visit(validation, `topic:${entry.id}`, 'image')
    if (entry.topicType === 'regular' && entry.readerReference?.source.kind === 'region')
      visit(entry.readerReference.source, `topic:${entry.id}.readerReference`, 'reader-region')
  }
  return sources
}

function projectMemoAssetReferences(note: ReturnType<typeof createEditorNote>): readonly AssetReferenceProjection[] {
  const references = new Map(projectNoteAssetReferences(note).map(reference => [reference.fileName, reference.count]))
  for (const source of collectExportImageSources(note)) {
    const fileName = parseAssetFileName(source.source)
    if (fileName !== null)
      references.set(fileName, Math.max(1, references.get(fileName) ?? 0))
  }
  return [...references.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, count]) => ({ count, fileName }))
}

function localJournalDateNow(): string {
  const now = new Date()
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function escapeTypst(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('#', '\\#')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function escapeTypstString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n')
}

function assertArchivePath(value: string): string[] {
  if (value.length === 0 || isAbsolute(value) || value.includes('\\'))
    throw new Error(`Memo archive contains an invalid path: ${value}`)
  const normalized = posix.normalize(value)
  if (normalized !== value || normalized === '..' || normalized.startsWith('../'))
    throw new Error(`Memo archive path escapes its root: ${value}`)
  return value.split('/')
}

function assertDigest(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error(`${description} must be a lowercase SHA-256 digest`)
}

function assertDescriptor(value: unknown, description: string): asserts value is MemoPayloadDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${description} must be an object`)
  const descriptor = value as Partial<MemoPayloadDescriptor>
  assertArchivePath(descriptor.path ?? '')
  const byteLength = descriptor.byteLength
  if (!Number.isSafeInteger(byteLength) || byteLength! < 1)
    throw new Error(`${description} has an invalid byte length`)
  assertDigest(descriptor.sha256, `${description} digest`)
}

function parseManifest(value: unknown): MemoManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Memo manifest must be an object')
  const manifest = value as Partial<MemoManifest>
  if (manifest.format !== memoFormat || manifest.formatVersion !== memoVersion)
    throw new Error('Memo format version is not supported')
  if (typeof manifest.sourceAppVersion !== 'string' || typeof manifest.exportedAt !== 'string')
    throw new Error('Memo manifest provenance is invalid')
  if (!manifest.note || typeof manifest.note !== 'object')
    throw new Error('Memo manifest Note descriptor is missing')
  const note = manifest.note as Partial<MemoManifest['note']>
  if (note.kind !== 'regular' && note.kind !== 'journal')
    throw new Error('Memo manifest Note kind is invalid')
  if (typeof note.sourceId !== 'string' || note.sourceId.length === 0 || typeof note.title !== 'string')
    throw new Error('Memo manifest Note identity is invalid')
  const schemaVersion = note.schemaVersion
  if (schemaVersion !== NOTE_SCHEMA_VERSION)
    throw new Error('Memo manifest Note schema version is invalid')
  if (note.kind === 'journal' && typeof note.journalDate !== 'string')
    throw new Error('Memo manifest Journal date is missing')
  if (note.kind === 'regular' && note.journalDate !== undefined)
    throw new Error('Memo manifest Regular Note cannot contain a Journal date')
  assertDescriptor(manifest.snapshot, 'Memo snapshot descriptor')
  if (manifest.snapshot.path !== snapshotPath)
    throw new Error('Memo snapshot path is invalid')
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.books))
    throw new Error('Memo manifest payload lists are invalid')
  if (manifest.assets.length > maxAssets || manifest.books.length > maxAssets)
    throw new Error(`Memo contains too many assets (maximum ${maxAssets})`)
  const paths = new Set<string>([manifest.snapshot.path, manifestPath])
  for (const asset of manifest.assets) {
    const assetDescriptor = asset as MemoAssetDescriptor
    assertDescriptor(assetDescriptor, 'Memo asset descriptor')
    if (typeof assetDescriptor.fileName !== 'string' || !assetFileNamePattern.test(assetDescriptor.fileName)
      || assetDescriptor.path !== `assets/${assetDescriptor.fileName}`
      || typeof assetDescriptor.mimeType !== 'string' || assetDescriptor.mimeType.length === 0
      || typeof assetDescriptor.originalFileName !== 'string' || assetDescriptor.originalFileName.length === 0) {
      throw new Error('Memo asset path or file name is invalid')
    }
    if (assetDescriptor.byteLength > maxAssetBytes)
      throw new Error(`Memo asset ${assetDescriptor.fileName} exceeds the size limit`)
    if (paths.has(assetDescriptor.path))
      throw new Error(`Memo contains duplicate payload path ${assetDescriptor.path}`)
    paths.add(assetDescriptor.path)
  }
  for (const book of manifest.books) {
    const bookDescriptor = book as MemoBookDescriptor
    assertDescriptor(bookDescriptor, 'Memo BookFile descriptor')
    assertDigest(bookDescriptor.sha256, 'Memo BookFile digest')
    if (typeof bookDescriptor.format !== 'string' || typeof bookDescriptor.originalName !== 'string' || bookDescriptor.originalName.length === 0)
      throw new Error('Memo BookFile descriptor is invalid')
    try {
      assertReadingFormat(bookDescriptor.format)
    }
    catch {
      throw new Error('Memo BookFile format is invalid')
    }
    if (bookDescriptor.path !== `books/${bookDescriptor.sha256}.${bookDescriptor.format}`)
      throw new Error('Memo BookFile path is invalid')
    if (paths.has(bookDescriptor.path))
      throw new Error(`Memo contains duplicate payload path ${bookDescriptor.path}`)
    paths.add(bookDescriptor.path)
  }
  return manifest as MemoManifest
}

async function listFiles(root: string, directory = root): Promise<StagedFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: StagedFile[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name)
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink())
      throw new Error(`Memo archive cannot contain symbolic links: ${relative(root, absolutePath)}`)
    if (metadata.isDirectory()) {
      files.push(...await listFiles(root, absolutePath))
      continue
    }
    if (!metadata.isFile())
      throw new Error(`Memo archive cannot contain special files: ${relative(root, absolutePath)}`)
    files.push({
      absolutePath,
      archivePath: relative(root, absolutePath).split(sep).join('/'),
      byteLength: metadata.size,
    })
  }
  return files
}

async function createArchiveBytes(root: string): Promise<Uint8Array> {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  const compressor = createZstdCompress()
  compressor.on('data', chunk => chunks.push(Buffer.from(chunk)))
  const writing = pipeline(pack, compressor)
  try {
    const files = await listFiles(root)
    files.sort((left, right) => {
      const rank = (path: string) => path === manifestPath ? 0 : path === snapshotPath ? 1 : 2
      return rank(left.archivePath) - rank(right.archivePath) || left.archivePath.localeCompare(right.archivePath)
    })
    for (const file of files) {
      const entry = pack.entry({
        mtime: new Date(0),
        name: file.archivePath,
        size: file.byteLength,
        type: 'file',
      })
      await pipeline(createReadStream(file.absolutePath), entry)
    }
    pack.finalize()
    await writing
    return Buffer.concat(chunks)
  }
  catch (error) {
    pack.destroy(error instanceof Error ? error : new Error(String(error)))
    await writing.catch(() => undefined)
    throw error
  }
}

async function readBookBytes(
  store: Pick<ShelfReadingFileStore, 'find' | 'readRange'>,
  binding: BookFileBinding,
): Promise<Uint8Array> {
  for (const hint of binding.retrievalHints) {
    const file = await store.find(hint.readingId)
    if (!file || file.document.format !== binding.file.format || file.document.byteLength !== binding.file.byteLength)
      continue
    const chunks: Uint8Array[] = []
    let offset = 0
    while (offset < binding.file.byteLength) {
      const length = Math.min(1024 * 1024, binding.file.byteLength - offset)
      const chunk = await store.readRange({ length, offset, readingId: hint.readingId })
      if (chunk.byteLength === 0)
        break
      chunks.push(chunk)
      offset += chunk.byteLength
    }
    const bytes = new Uint8Array(offset)
    let cursor = 0
    for (const chunk of chunks) {
      bytes.set(chunk, cursor)
      cursor += chunk.byteLength
    }
    if (bytes.byteLength === binding.file.byteLength && digest(bytes) === binding.file.sha256)
      return bytes
  }
  throw new Error(`BookFile is unavailable or has a mismatched digest: ${binding.file.sha256}`)
}

function importedReadingId(descriptor: MemoBookDescriptor): string {
  return createHash('sha256')
    .update('memorilo-memo-import-reading-v1\0')
    .update(descriptor.sha256)
    .update('\0')
    .update(descriptor.format)
    .update('\0')
    .update(randomUUID())
    .digest('hex')
}

async function existingTypstFontDirectories(extra: readonly string[] = []): Promise<readonly string[]> {
  const home = process.env.HOME
  const candidates = process.platform === 'darwin'
    ? [
        '/System/Library/Fonts',
        '/System/Library/Fonts/Supplemental',
        '/Library/Fonts',
        ...(home ? [join(home, 'Library/Fonts')] : []),
      ]
    : process.platform === 'win32'
      ? [
          process.env.WINDIR ? join(process.env.WINDIR, 'Fonts') : '',
          process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft/Windows/Fonts') : '',
        ]
      : ['/usr/share/fonts', '/usr/local/share/fonts', ...(home ? [join(home, '.local/share/fonts')] : [])]
  const directories: string[] = []
  for (const candidate of [...extra, ...candidates]) {
    if (candidate.length === 0)
      continue
    try {
      if ((await stat(candidate)).isDirectory())
        directories.push(candidate)
    }
    catch {
      // A platform font directory may be absent; Typst's bundled fonts remain available.
    }
  }
  return directories
}

function renderImageOcclusionTypst(
  state: ImageOcclusionExportState,
  inlineAsset: (src: string) => string,
): string {
  const image = inlineAsset(state.image.src)
  return image.length === 0
    ? '[image unavailable]\n\n'
    : `#image("${escapeTypstString(image)}", width: 100%)\n\n_${escapeTypst(state.mode)}_\n\n`
}

function projectExportDocument(note: ReturnType<typeof createEditorNote>): ExportDocument {
  const entries = note.getEntries()
  const byParent = new Map<string | null, typeof entries>()
  for (const entry of entries)
    byParent.set(entry.parentId, [...(byParent.get(entry.parentId) ?? []), entry])

  const projectChildren = (parentId: string | null): readonly ExportDocumentEntry[] => (
    (byParent.get(parentId) ?? []).map((entry) => {
      if (entry.kind === 'folder') {
        return {
          children: projectChildren(entry.id),
          id: entry.id,
          kind: 'folder' as const,
          title: entry.name,
        }
      }
      return {
        children: projectChildren(entry.id),
        id: entry.id,
        kind: 'topic' as const,
        ...(entry.topicType === 'regular' && entry.readerReference !== undefined
          ? { readerReference: structuredClone(entry.readerReference) }
          : {}),
        title: entry.title,
        validation: note.getTopicValidationInput(entry.id),
      }
    })
  )

  return { entries: projectChildren(null), title: note.getTitle() }
}

function sceneRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sceneNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sceneColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0)
    return fallback
  if (/^(?:#[0-9a-f]{3,8}|[a-z]+)$/iu.test(value))
    return value
  return fallback
}

function sceneFileSource(files: Record<string, unknown>, fileId: unknown): string | null {
  if (typeof fileId !== 'string')
    return null
  const file = sceneRecord(files[fileId])
  return typeof file?.dataURL === 'string' ? file.dataURL : null
}

function sceneBounds(elements: readonly Record<string, unknown>[]): { height: number, width: number, x: number, y: number } {
  const visible = elements.filter(element => element.isDeleted !== true)
  if (visible.length === 0)
    return { height: 600, width: 800, x: 0, y: 0 }
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const element of visible) {
    const x = sceneNumber(element.x)
    const y = sceneNumber(element.y)
    const width = sceneNumber(element.width)
    const height = sceneNumber(element.height)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + width)
    bottom = Math.max(bottom, y + height)
    if (Array.isArray(element.points)) {
      for (let index = 0; index + 1 < element.points.length; index += 2) {
        const pointX = x + sceneNumber(element.points[index])
        const pointY = y + sceneNumber(element.points[index + 1])
        left = Math.min(left, pointX)
        top = Math.min(top, pointY)
        right = Math.max(right, pointX)
        bottom = Math.max(bottom, pointY)
      }
    }
  }
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const padding = Math.max(24, Math.min(width, height) * 0.08)
  return { height: height + padding * 2, width: width + padding * 2, x: left - padding, y: top - padding }
}

function sceneElementSvg(
  element: Record<string, unknown>,
  files: Record<string, unknown>,
  inlineAsset: (src: string) => string,
  diagnostics?: DesktopExportDiagnostic[],
  path = 'whiteboard',
): string {
  if (element.isDeleted === true || element.type === 'embeddable')
    return ''
  const type = typeof element.type === 'string' ? element.type : 'unknown'
  const x = sceneNumber(element.x)
  const y = sceneNumber(element.y)
  const width = sceneNumber(element.width)
  const height = sceneNumber(element.height)
  const stroke = sceneColor(element.strokeColor, '#202124')
  const background = sceneColor(element.backgroundColor, 'transparent')
  const opacity = Math.min(1, Math.max(0, sceneNumber(element.opacity, 100) / 100))
  const strokeWidth = Math.max(0.5, sceneNumber(element.strokeWidth, 1))
  const fill = element.fillStyle === 'solid' ? background : 'transparent'
  const common = `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"`
  if (type === 'rectangle')
    return `<rect x="${x}" y="${y}" width="${Math.max(0, width)}" height="${Math.max(0, height)}" ${common}/>`
  if (type === 'diamond')
    return `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" ${common}/>`
  if (type === 'ellipse')
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${Math.max(0, width / 2)}" ry="${Math.max(0, height / 2)}" ${common}/>`
  if (type === 'line' || type === 'arrow') {
    const points = Array.isArray(element.points) ? element.points : []
    const endX = x + (points.length >= 2 ? sceneNumber(points.at(-2), width) : width)
    const endY = y + (points.length >= 1 ? sceneNumber(points.at(-1), height) : height)
    return `<line x1="${x}" y1="${y}" x2="${endX}" y2="${endY}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
  }
  if (type === 'freedraw') {
    const points = Array.isArray(element.points) ? element.points : []
    const path = points.reduce((result, value, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return result
      if (index % 2 === 0)
        return `${result}${index === 0 ? 'M' : ' L'}${x + value}`
      return `${result} ${y + value}`
    }, '')
    return path.length === 0 ? '' : `<path d="${escapeXml(path)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
  }
  if (type === 'text') {
    const text = typeof element.text === 'string' ? element.text : ''
    return `<text x="${x}" y="${y + Math.max(16, sceneNumber(element.fontSize, 16))}" fill="${escapeXml(stroke)}" font-size="${Math.max(8, sceneNumber(element.fontSize, 16))}" opacity="${opacity}">${escapeXml(text)}</text>`
  }
  if (type === 'image') {
    const source = sceneFileSource(files, element.fileId)
    const image = source === null ? '' : inlineAsset(source)
    if (source === null) {
      diagnostics?.push({
        code: 'missing-whiteboard-image',
        fallback: 'visible-placeholder',
        kind: 'whiteboard-image',
        message: `${path}: whiteboard image data is unavailable`,
        path,
        reason: 'file-data-missing',
        severity: 'warning',
      })
    }
    return image.length === 0
      ? `<rect x="${x}" y="${y}" width="${Math.max(0, width)}" height="${Math.max(0, height)}" fill="#f5f5f5" stroke="#a33"/><text x="${x + 8}" y="${y + 20}" fill="#a33">[image unavailable]</text>`
      : `<image href="${escapeXml(image)}" x="${x}" y="${y}" width="${Math.max(0, width)}" height="${Math.max(0, height)}" preserveAspectRatio="none" opacity="${opacity}"/>`
  }
  diagnostics?.push({
    code: 'unsupported-whiteboard-element',
    fallback: 'visible-placeholder',
    kind: 'whiteboard-element',
    message: `${path}: unsupported whiteboard element ${type}`,
    path,
    reason: 'element-kind-not-supported',
    severity: 'warning',
  })
  return `<text x="${x}" y="${y + 16}" fill="#a33">[unsupported whiteboard element: ${escapeXml(type)}]</text>`
}

function renderWhiteboardSceneSvg(
  scene: unknown,
  inlineAsset: (src: string) => string,
  diagnostics?: DesktopExportDiagnostic[],
  path = 'whiteboard',
): string | null {
  const value = sceneRecord(scene)
  if (value === null || !Array.isArray(value.elements)) {
    diagnostics?.push({
      code: 'invalid-whiteboard-scene',
      fallback: 'visible-placeholder',
      kind: 'whiteboard-scene',
      message: `${path}: whiteboard scene data is unavailable`,
      path,
      reason: 'scene-elements-missing',
      severity: 'warning',
    })
    return null
  }
  const elements = value.elements
    .map(sceneRecord)
    .filter((element): element is Record<string, unknown> => element !== null)
  const files = sceneRecord(value.files) ?? {}
  const bounds = sceneBounds(elements)
  const background = sceneColor(sceneRecord(value.appState)?.viewBackgroundColor, '#ffffff')
  const body = elements.map((element, index) => sceneElementSvg(element, files, inlineAsset, diagnostics, `${path}.elements[${index}]`)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="Whiteboard scene"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(background)}"/>${body}</svg>`
}

export class NoteTransferApplication {
  readonly #dependencies: TransferDependencies
  readonly #operations = createOperationSupervisor('Note transfer', { shutdown: 'interrupt' })
  readonly #transferOperations = new Map<string, TransferOperation>()
  readonly #ownerOperations = new Map<number, string>()
  #closed = false

  constructor(dependencies: TransferDependencies) {
    this.#dependencies = dependencies
  }

  close(): Promise<void> {
    this.#closed = true
    for (const operation of this.#transferOperations.values())
      operation.controller.abort(new Error('Note transfer service is closing'))
    this.#transferOperations.clear()
    this.#ownerOperations.clear()
    return this.#operations.close()
  }

  startExport(
    input: { format: DesktopNoteExportFormat, noteId: string },
    owner: BrowserWindow | null,
    ownerId: number,
  ): DesktopNoteTransferStart {
    const operation = this.#startOperation(ownerId, {
      format: input.format,
      kind: 'export',
    })
    void this.#runExport(input.format, input.noteId, owner, operation.controller.signal).then(
      result => this.#finishOperation(operation, result.status === 'cancelled'
        ? { kind: 'export', operationId: operation.id, phase: 'cancelled', format: input.format }
        : { kind: 'export', operationId: operation.id, phase: 'saved', format: input.format, result }),
      error => this.#failOperation(operation, error),
    )
    return { operationId: operation.id }
  }

  prepareImport(owner: BrowserWindow | null, ownerId: number): DesktopNoteTransferStart {
    const operation = this.#startOperation(ownerId, { kind: 'import' })
    void this.#importNote(owner, operation.controller.signal).then(
      (result) => {
        if (result.status === 'cancelled') {
          this.#finishOperation(operation, { kind: 'import', operationId: operation.id, phase: 'cancelled' })
          return
        }
        if (result.status === 'markdown') {
          this.#finishOperation(operation, {
            fileName: result.fileName,
            kind: 'import',
            operationId: operation.id,
            phase: 'markdown',
            source: result.source,
          })
          return
        }
        this.#finishOperation(operation, {
          kind: 'import',
          operationId: operation.id,
          phase: 'imported',
          result,
        })
      },
      error => this.#failOperation(operation, error),
    )
    return { operationId: operation.id }
  }

  getTransfer(operationId: string, ownerId: number): DesktopNoteTransferState {
    const operation = this.#transferOperations.get(operationId)
    if (operation === undefined || operation.ownerId !== ownerId)
      throw new Error('Note transfer operation is expired or belongs to another window')
    return operation.state
  }

  continueTransfer(
    input: { decision: DesktopNoteTransferDecision, operationId: string },
    ownerId: number,
  ): DesktopNoteTransferState {
    const operation = this.#ownedOperation(input.operationId, ownerId)
    if (input.decision.kind === 'cancel') {
      operation.controller.abort(new Error('Note transfer cancelled by the user'))
    }
    return operation.state
  }

  cancelTransfer(operationId: string, ownerId: number): DesktopNoteTransferState {
    return this.continueTransfer({ decision: { kind: 'cancel' }, operationId }, ownerId)
  }

  #ownedOperation(operationId: string, ownerId: number): TransferOperation {
    const operation = this.#transferOperations.get(operationId)
    if (operation === undefined || operation.ownerId !== ownerId)
      throw new Error('Note transfer operation is expired or belongs to another window')
    return operation
  }

  #startOperation(ownerId: number, input: { format?: DesktopNoteExportFormat, kind: 'export' | 'import' }): TransferOperation {
    if (this.#closed)
      throw new Error('Note transfer service is closed')
    const previousId = this.#ownerOperations.get(ownerId)
    if (previousId !== undefined) {
      const previous = this.#transferOperations.get(previousId)
      if (previous !== undefined && (previous.state.phase === 'preparing' || previous.state.phase === 'markdown'))
        throw new Error('Another Note transfer is already in progress')
      this.#ownerOperations.delete(ownerId)
    }
    const id = randomUUID()
    const operation: TransferOperation = {
      controller: new AbortController(),
      ...(input.format === undefined ? {} : { format: input.format }),
      id,
      kind: input.kind,
      ownerId,
      state: input.kind === 'export'
        ? { format: input.format!, kind: 'export', operationId: id, phase: 'preparing' }
        : { kind: 'import', operationId: id, phase: 'preparing' },
    }
    this.#transferOperations.set(id, operation)
    this.#ownerOperations.set(ownerId, id)
    return operation
  }

  #finishOperation(operation: TransferOperation, state: DesktopNoteTransferState): void {
    if (this.#closed)
      return
    operation.state = state
    operation.expiresAt = setTimeout(() => {
      this.#transferOperations.delete(operation.id)
      if (this.#ownerOperations.get(operation.ownerId) === operation.id)
        this.#ownerOperations.delete(operation.ownerId)
    }, 5 * 60 * 1000)
    operation.expiresAt.unref?.()
  }

  #failOperation(operation: TransferOperation, error: unknown): void {
    if (operation.controller.signal.aborted) {
      this.#finishOperation(operation, operation.kind === 'export'
        ? { format: operation.format!, kind: 'export', operationId: operation.id, phase: 'cancelled' }
        : { kind: 'import', operationId: operation.id, phase: 'cancelled' })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    this.#finishOperation(operation, operation.kind === 'export'
      ? { error: { code: 'transfer-failed', message }, format: operation.format!, kind: 'export', operationId: operation.id, phase: 'failed' }
      : { error: { code: 'transfer-failed', message }, kind: 'import', operationId: operation.id, phase: 'failed' })
  }

  async #runExport(
    format: DesktopNoteExportFormat,
    noteId: string,
    owner: BrowserWindow | null,
    signal: AbortSignal,
  ): Promise<Extract<DesktopNoteExportResult, { status: 'saved' }> | { status: 'cancelled' }> {
    if (format === 'memo')
      return this.#exportMemo(noteId, owner, signal)
    return this.#exportPdf(noteId, owner, signal)
  }

  async exportMemo(noteId: string, owner: BrowserWindow | null): Promise<DesktopNoteExportResult> {
    const result = await this.#operations.runSingleFlight(() => this.#exportMemo(noteId, owner))
    if (result.status === 'busy')
      throw new Error('Another Note transfer is already in progress')
    return result.value
  }

  async #createMemoArchive(note: ExportNote, source: ReturnType<typeof createEditorNote>, signal?: AbortSignal): Promise<Uint8Array> {
    const identity = source.getIdentity()
    if (identity.kind !== note.kind || source.getTitle() !== note.title)
      throw new Error('The Note changed while it was being prepared for export')
    if (identity.kind === 'journal' && (note.kind !== 'journal' || identity.journalDate !== note.journalDate))
      throw new Error('The Journal identity changed while it was being prepared for export')
    const references = projectMemoAssetReferences(source)
    const assets = await this.#collectAssets(references)
    const books = await this.#collectBooks(source)
    throwIfAborted(signal)
    const root = await mkdtemp(join(tmpdir(), 'memorilo-memo-export-'))
    try {
      const snapshot = new Uint8Array(note.snapshot)
      await writeFile(join(root, snapshotPath), snapshot, { flag: 'wx' })
      if (assets.length > 0)
        await mkdir(join(root, 'assets'))
      if (books.length > 0)
        await mkdir(join(root, 'books'))
      for (const asset of assets)
        await writeFile(join(root, asset.descriptor.path), asset.bytes, { flag: 'wx' })
      for (const book of books)
        await writeFile(join(root, book.descriptor.path), book.bytes, { flag: 'wx' })
      const manifest: MemoManifest = {
        assets: assets.map(asset => asset.descriptor),
        books: books.map(book => book.descriptor),
        exportedAt: new Date().toISOString(),
        format: memoFormat,
        formatVersion: memoVersion,
        note: {
          ...(identity.kind === 'journal' ? { journalDate: identity.journalDate } : {}),
          kind: identity.kind,
          schemaVersion: NOTE_SCHEMA_VERSION,
          sourceId: note.id,
          title: source.getTitle(),
        },
        snapshot: { byteLength: snapshot.byteLength, path: snapshotPath, sha256: digest(snapshot) },
        sourceAppVersion: this.#dependencies.appVersion,
      }
      await writeFile(join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
      throwIfAborted(signal)
      return await createArchiveBytes(root)
    }
    finally {
      await rm(root, { force: true, recursive: true })
    }
  }

  async #exportMemo(noteId: string, owner: BrowserWindow | null, signal?: AbortSignal): Promise<DesktopNoteExportResult> {
    throwIfAborted(signal)
    if (!(await this.#dependencies.flushRenderer()))
      throw new Error('The Note could not be flushed before export')
    throwIfAborted(signal)
    const note = await this.#dependencies.notes.getNote({ noteId })
    const source = createEditorNote({ id: note.id, snapshot: note.snapshot })
    const archive = await this.#createMemoArchive(note, source, signal)
    throwIfAborted(signal)
    const destination = await showSaveDialog(owner, {
      defaultPath: `${source.getTitle().replaceAll(/[\\/:*?"<>|]/gu, '_')}.memo`,
      filters: [{ extensions: ['memo'], name: 'Memorilo Memo' }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (destination.canceled || !destination.filePath)
      return { status: 'cancelled' }
    throwIfAborted(signal)
    await atomicWrite(destination.filePath, archive)
    return { diagnostics: [], path: destination.filePath, status: 'saved' }
  }

  async exportPdf(noteId: string, owner: BrowserWindow | null): Promise<DesktopNoteExportResult> {
    const result = await this.#operations.runSingleFlight(() => this.#exportPdf(noteId, owner))
    if (result.status === 'busy')
      throw new Error('Another Note transfer is already in progress')
    return result.value
  }

  async #exportPdf(noteId: string, owner: BrowserWindow | null, signal?: AbortSignal): Promise<DesktopNoteExportResult> {
    throwIfAborted(signal)
    if (!(await this.#dependencies.flushRenderer()))
      throw new Error('The Note could not be flushed before export')
    throwIfAborted(signal)
    const note = await this.#dependencies.notes.getNote({ noteId })
    const source = createEditorNote({ id: note.id, snapshot: note.snapshot })
    const memo = await this.#createMemoArchive(note, source, signal)
    const resources = await this.#resolveExportResources(source)
    throwIfAborted(signal)
    const document = projectExportDocument(source)
    const diagnostics: DesktopExportDiagnostic[] = []
    const inlineAsset = (src: string): string => resources.pdf.get(src)?.path ?? ''
    const sceneInlineAsset = (src: string): string => resources.inline.get(src) ?? ''
    const whiteboardScenes = new Map<string, { path: string, source: string }>()
    const visitScenes = (entries: readonly ExportDocumentEntry[]): void => {
      for (const entry of entries) {
        if (entry.kind === 'topic' && entry.validation !== undefined && 'scene' in entry.validation) {
          const scene = renderWhiteboardSceneSvg(entry.validation.scene, sceneInlineAsset, diagnostics, `topic:${entry.id}.whiteboard`)
          if (scene !== null)
            whiteboardScenes.set(entry.id, { path: `assets/whiteboard-${randomUUID()}.svg`, source: scene })
        }
        visitScenes(entry.children)
      }
    }
    visitScenes(document.entries)
    const projectionDiagnostics = resources.diagnostics.concat(diagnostics)
    const warningText = projectionDiagnostics.length === 0
      ? ''
      : `= Export warnings\n\n${projectionDiagnostics.map(diagnostic => `- ${escapeTypst(diagnostic.message)}`).join('\n')}\n\n`
    // The bundled Xiaolai files are browser-only WOFF2 Unicode subsets; Typst 0.7
    // cannot discover a family from them, so naming Xiaolai here creates a false
    // warning and silently falls back anyway. Keep Typst's portable CJK fallback.
    const typst = `#set page(paper: "a4", margin: 2cm)\n#set text(font: ("Libertinus Serif", "Hiragino Sans GB"), size: 11pt)\n${typstTaskPrelude}\n= ${escapeTypst(note.title)}\n\n${warningText}${entriesTypst(document, inlineAsset, topicId => whiteboardScenes.get(topicId)?.path ?? '')}`
    const root = await mkdtemp(join(tmpdir(), 'memorilo-typst-export-'))
    try {
      const sourcePath = join(root, 'note.typ')
      await writeFile(sourcePath, typst, { flag: 'wx' })
      if (resources.pdf.size > 0) {
        await mkdir(join(root, 'assets'))
        for (const resource of resources.pdf.values())
          await writeFile(join(root, resource.path), resource.bytes, { flag: 'wx' })
      }
      if (whiteboardScenes.size > 0) {
        await mkdir(join(root, 'assets'), { recursive: true })
        for (const scene of whiteboardScenes.values())
          await writeFile(join(root, scene.path), scene.source, { flag: 'wx' })
      }
      const compilerPackage = '@myriaddreamin/typst-ts-node-compiler'
      const compilerModule = await import(compilerPackage)
      const fontPaths = await existingTypstFontDirectories(this.#dependencies.typstFontDirectories)
      const compiler = compilerModule.NodeCompiler.create({
        fontArgs: fontPaths.length === 0 ? undefined : [{ fontPaths }],
        workspace: root,
      })
      throwIfAborted(signal)
      const compiled = compiler.compile({ mainFilePath: sourcePath })
      if (compiled.hasError()) {
        const error = compiled.takeError()
        throw new Error(`Typst failed to compile the Note${error === null ? '' : `: ${JSON.stringify(error.shortDiagnostics)}`}`)
      }
      if (!compiled.result)
        throw new Error('Typst failed to compile the Note')
      const warning = compiled.takeWarnings()
      if (warning !== null) {
        diagnostics.push({
          code: 'typst-warning',
          message: JSON.stringify(warning.shortDiagnostics),
          severity: 'warning',
        })
      }
      const pdf = embedMemoAttachment(
        compiler.pdf(compiled.result),
        memo,
        `${note.title.replaceAll(/[\\/:*?"<>|]/gu, '_')}.memo`,
      )
      const destination = await showSaveDialog(owner, {
        defaultPath: `${note.title.replaceAll(/[\\/:*?"<>|]/gu, '_')}.memo.pdf`,
        filters: [{ extensions: ['pdf'], name: 'PDF' }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      if (destination.canceled || !destination.filePath)
        return { status: 'cancelled' }
      throwIfAborted(signal)
      await atomicWrite(destination.filePath, pdf)
      return { diagnostics: resources.diagnostics.concat(diagnostics), path: destination.filePath, status: 'saved' }
    }
    finally {
      await rm(root, { force: true, recursive: true })
    }
  }

  async importNote(owner: BrowserWindow | null): Promise<DesktopNoteImportResult> {
    const result = await this.#operations.runSingleFlight(() => this.#importNote(owner))
    if (result.status === 'busy')
      throw new Error('Another Note transfer is already in progress')
    return result.value
  }

  async #importMemoPdf(sourcePath: string, owner: BrowserWindow | null, signal?: AbortSignal): Promise<DesktopNoteImportResult> {
    const memo = extractMemoAttachment(await readFile(sourcePath))
    const root = await mkdtemp(join(tmpdir(), 'memorilo-memo-pdf-import-'))
    const memoPath = join(root, 'attachment.memo')
    try {
      await writeFile(memoPath, memo, { flag: 'wx', mode: 0o600 })
      return await this.#importMemo(memoPath, owner, signal)
    }
    finally {
      await rm(root, { force: true, recursive: true })
    }
  }

  async #importNote(owner: BrowserWindow | null, signal?: AbortSignal): Promise<DesktopNoteImportResult> {
    throwIfAborted(signal)
    const selected = await showOpenDialog(owner, {
      filters: [{ extensions: ['memo', 'pdf', 'md', 'markdown'], name: 'Note files' }],
      properties: ['openFile'],
    })
    if (selected.canceled || selected.filePaths.length === 0)
      return { status: 'cancelled' }
    throwIfAborted(signal)
    const sourcePath = selected.filePaths[0]!
    if (/\.(?:md|markdown)$/iu.test(sourcePath)) {
      return {
        fileName: basename(sourcePath),
        source: await readFile(sourcePath, 'utf8'),
        status: 'markdown',
      }
    }
    if (/\.memo\.pdf$/iu.test(sourcePath))
      return this.#importMemoPdf(sourcePath, owner, signal)
    if (!/\.memo$/iu.test(sourcePath))
      throw new Error('Unsupported Note file extension')
    return this.#importMemo(sourcePath, owner, signal)
  }

  async #resolveExportResources(note: ReturnType<typeof createEditorNote>): Promise<ExportResources> {
    const diagnostics: DesktopExportDiagnostic[] = []
    const inline = new Map<string, string>()
    const pdf = new Map<string, { bytes: Uint8Array, path: string }>()
    const managed = new Map((await this.#dependencies.storage.assets.list()).map(asset => [asset.fileName, asset]))
    const sources = collectExportImageSources(note)
    for (const resource of sources) {
      const managedFileName = parseAssetFileName(resource.source)
      try {
        let resolved: { bytes: Uint8Array, mimeType: string }
        if (managedFileName !== null) {
          const bytes = await this.#readAsset(managedFileName)
          if (!bytes)
            throw new Error(`Managed asset ${managedFileName} is missing`)
          const mimeType = exportImageMimeType(managed.get(managedFileName)?.mimeType ?? null)
          if (mimeType === null)
            throw new Error(`Managed asset ${managedFileName} has an unsupported MIME type`)
          resolved = { bytes, mimeType }
        }
        else if (resource.source.startsWith('data:')) {
          const data = decodeImageDataUrl(resource.source)
          if (data === null)
            throw new Error('Data URL is not a supported base64 image')
          resolved = data
        }
        else {
          if (!isHttpImageSource(resource.source))
            throw new Error('Image source is not a supported managed, data, or HTTP(S) URL')
          resolved = await fetchExportImage(resource.source)
        }
        if (resolved.bytes.byteLength === 0)
          throw new Error('Image is empty')
        if (resolved.bytes.byteLength > maxExportImageBytes)
          throw new Error('Image exceeds the 50 MiB export limit')
        const dataUrl = `data:${resolved.mimeType};base64,${Buffer.from(resolved.bytes).toString('base64')}`
        inline.set(resource.source, dataUrl)
        const extension = exportImageMimeExtensions[resolved.mimeType]
        if (extension !== undefined) {
          const fileName = `${randomUUID()}${extension}`
          const path = `assets/${fileName}`
          pdf.set(resource.source, { bytes: resolved.bytes, path })
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const invalidManagedUri = managedFileName === null && resource.source.startsWith('memorilo:')
        diagnostics.push({
          code: invalidManagedUri ? 'invalid-managed-uri' : 'missing-image',
          fallback: 'visible-placeholder',
          kind: resource.kind,
          message: `${resource.path}: ${message}`,
          path: resource.path,
          reason: message,
          severity: 'warning',
        })
      }
    }
    return { diagnostics, inline, pdf }
  }

  async #importMemo(sourcePath: string, owner: BrowserWindow | null, signal?: AbortSignal): Promise<DesktopNoteImportResult> {
    throwIfAborted(signal)
    const root = await mkdtemp(join(tmpdir(), 'memorilo-memo-import-'))
    try {
      const archiveMetadata = await stat(sourcePath)
      if (!archiveMetadata.isFile() || archiveMetadata.size > maxArchiveBytes)
        throw new Error('Memo archive exceeds the compressed size limit')
      const seen = new Set<string>()
      let entryCount = 0
      let total = 0
      const extract = tar.extract()
      extract.on('entry', (header, stream, next) => {
        void (async () => {
          assertArchivePath(header.name)
          if (entryCount === 0 && header.name !== manifestPath)
            throw new Error('Memo manifest must be the first TAR entry')
          entryCount += 1
          if (header.type !== 'file')
            throw new Error(`Memo contains unsupported TAR entry: ${header.type ?? 'unknown'}`)
          if (seen.has(header.name))
            throw new Error(`Memo contains duplicate path: ${header.name}`)
          seen.add(header.name)
          const size = header.size ?? 0
          if (!Number.isSafeInteger(size) || size < 0)
            throw new Error(`Memo entry ${header.name} has an invalid size`)
          if (header.name === snapshotPath && size > maxSnapshotBytes)
            throw new Error('Memo snapshot exceeds the size limit')
          if (header.name.startsWith('assets/') && size > maxAssetBytes)
            throw new Error(`Memo asset exceeds the size limit: ${header.name}`)
          if (header.name.startsWith('assets/') && [...seen].filter(path => path.startsWith('assets/')).length >= maxAssets)
            throw new Error(`Memo contains too many assets (maximum ${maxAssets})`)
          total += size
          if (total > maxArchiveBytes)
            throw new Error('Memo archive exceeds the uncompressed size limit')
          const destination = join(root, ...assertArchivePath(header.name))
          await mkdir(dirname(destination), { recursive: true })
          await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
          next()
        })().catch(error => next(error))
      })
      await pipeline(createReadStream(sourcePath), createZstdDecompress(), extract)
      if (!seen.has(manifestPath) || !seen.has(snapshotPath))
        throw new Error('Memo archive is missing its manifest or snapshot')
      const manifest = parseManifest(JSON.parse(await readFile(join(root, manifestPath), 'utf8')))
      const expected = new Set([manifestPath, manifest.snapshot.path, ...manifest.assets.map(asset => asset.path), ...manifest.books.map(book => book.path)])
      const unexpected = [...seen].filter(path => !expected.has(path))
      if (unexpected.length > 0)
        throw new Error(`Memo contains undeclared entries: ${unexpected.join(', ')}`)
      const snapshot = new Uint8Array(await readFile(join(root, snapshotPath)))
      if (snapshot.byteLength !== manifest.snapshot.byteLength || digest(snapshot) !== manifest.snapshot.sha256)
        throw new Error('Memo snapshot does not match its manifest')
      if (snapshot.byteLength > maxSnapshotBytes)
        throw new Error('Memo snapshot exceeds the size limit')
      const source = createEditorNote({ id: manifest.note.sourceId, snapshot })
      const identity = source.getIdentity()
      if (identity.kind !== manifest.note.kind)
        throw new Error('Memo manifest Note kind does not match its snapshot')
      if (source.getTitle() !== manifest.note.title)
        throw new Error('Memo manifest Note title does not match its snapshot')
      if (identity.kind === 'journal' && identity.journalDate !== manifest.note.journalDate)
        throw new Error('Memo manifest Journal date does not match its snapshot')
      this.#assertManifestMatchesNote(manifest, source)
      const assets = await this.#stageAssets(root, manifest)
      const books = await this.#stageBooks(root, manifest)
      throwIfAborted(signal)
      const isJournal = identity.kind === 'journal'
      const id = isJournal ? source.id : await this.#resolveRegularImportId(source.id, owner)
      const title = isJournal ? source.getTitle() : await this.#resolveRegularImportTitle(source.getTitle(), owner)
      const imported = isJournal ? source : cloneEditorNote({ id: source.id, snapshot }, id)
      if (!isJournal)
        imported.remapLearningIdentities()
      if (!isJournal && imported.getTitle() !== title)
        imported.renameNote(title)
      await this.#assertImportDestinationAvailable(id, isJournal ? identity.journalDate : undefined)
      const assetConflictDecisions = await this.#resolveAssetConflicts(assets, owner)
      throwIfAborted(signal)
      const publishedAssets = await this.#publishAssets(assets, assetConflictDecisions)
      try {
        throwIfAborted(signal)
        imported.rewriteResourceReferences((source) => {
          const fileName = parseAssetFileName(source)
          const renamed = fileName === null ? undefined : publishedAssets.fileNameMap.get(fileName)
          return renamed === undefined ? source : assetSource(renamed)
        })
        const publishedBooks = await this.#publishBooks(imported, root, books)
        try {
          throwIfAborted(signal)
          const stored = await this.#createImported(imported, id, isJournal ? 'journal' : 'regular', publishedAssets.registrations, books)
          return {
            ...(isJournal && identity.kind === 'journal' ? { journalDate: identity.journalDate } : {}),
            kind: isJournal ? 'journal' : 'regular',
            noteId: stored.id,
            status: 'imported',
            title: stored.title,
          }
        }
        catch (error) {
          await this.#cleanupPublishedBooks(publishedBooks)
          throw error
        }
      }
      catch (error) {
        await this.#cleanupPublishedAssets(publishedAssets)
        throw error
      }
    }
    finally {
      await rm(root, { force: true, recursive: true })
    }
  }

  #assertManifestMatchesNote(manifest: MemoManifest, note: ReturnType<typeof createEditorNote>): void {
    const referencedAssets = new Set(projectMemoAssetReferences(note).map(reference => reference.fileName))
    const manifestAssets = new Set(manifest.assets.map(asset => asset.fileName))
    if (referencedAssets.size !== manifestAssets.size || [...referencedAssets].some(fileName => !manifestAssets.has(fileName)))
      throw new Error('Memo asset manifest does not match the Note snapshot')

    const referencedBooks = new Set(note.getEntries()
      .filter((entry): entry is Extract<ReturnType<typeof note.getEntries>[number], { kind: 'topic', topicType: 'book' }> => entry.kind === 'topic' && entry.topicType === 'book')
      .map(entry => `${entry.book.file.sha256}:${entry.book.file.format}`))
    const manifestBooks = new Set(manifest.books.map(book => `${book.sha256}:${book.format}`))
    if (referencedBooks.size !== manifestBooks.size || [...referencedBooks].some(identity => !manifestBooks.has(identity)))
      throw new Error('Memo BookFile manifest does not match the Note snapshot')
    for (const entry of note.getEntries()) {
      if (entry.kind !== 'topic' || entry.topicType !== 'book')
        continue
      const descriptor = manifest.books.find(book => book.sha256 === entry.book.file.sha256 && book.format === entry.book.file.format)
      if (!descriptor || descriptor.byteLength !== entry.book.file.byteLength)
        throw new Error(`Memo BookFile descriptor does not match the Note snapshot: ${entry.book.file.sha256}`)
    }
  }

  async #collectAssets(references: readonly { fileName: string }[]): Promise<readonly { bytes: Uint8Array, descriptor: MemoAssetDescriptor }[]> {
    const known = new Map((await this.#dependencies.storage.assets.list()).map(asset => [asset.fileName, asset]))
    const collected = await Promise.all(references.map(async (reference) => {
      const bytes = await this.#readAsset(reference.fileName)
      if (!bytes)
        throw new Error(`Managed asset is missing: ${reference.fileName}`)
      if (bytes.byteLength > maxAssetBytes)
        throw new Error(`Managed asset exceeds the size limit: ${reference.fileName}`)
      const asset = known.get(reference.fileName)
      const mimeType = exportImageMimeType(asset?.mimeType ?? null)
      if (mimeType === null)
        throw new Error(`Managed asset has an unsupported MIME type: ${reference.fileName}`)
      return {
        bytes,
        descriptor: {
          byteLength: bytes.byteLength,
          fileName: reference.fileName,
          mimeType,
          originalFileName: asset?.originalFileName ?? reference.fileName,
          path: `assets/${reference.fileName}`,
          sha256: digest(bytes),
        },
      }
    }))
    return collected.sort((left, right) => left.descriptor.fileName.localeCompare(right.descriptor.fileName))
  }

  async #collectBooks(note: ReturnType<typeof createEditorNote>): Promise<readonly { bytes: Uint8Array, descriptor: MemoBookDescriptor }[]> {
    const books: { bytes: Uint8Array, descriptor: MemoBookDescriptor }[] = []
    const seen = new Set<string>()
    for (const entry of note.getEntries()) {
      if (entry.kind !== 'topic' || entry.topicType !== 'book')
        continue
      const binding = note.getBookTopic(entry.id).getBook()
      const identity = `${binding.file.sha256}:${binding.file.format}`
      if (seen.has(identity))
        continue
      seen.add(identity)
      const bytes = await readBookBytes(this.#dependencies.shelfReadingFiles, binding)
      books.push({
        bytes,
        descriptor: {
          byteLength: bytes.byteLength,
          format: binding.file.format,
          originalName: binding.file.originalName,
          path: `books/${binding.file.sha256}.${binding.file.format}`,
          sha256: binding.file.sha256,
        },
      })
    }
    return books.sort((left, right) => left.descriptor.path.localeCompare(right.descriptor.path))
  }

  async #readAsset(fileName: string): Promise<Uint8Array | null> {
    if (this.#dependencies.assetDirectory === null)
      return null
    try {
      return new Uint8Array(await readFile(join(this.#dependencies.assetDirectory, fileName)))
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    }
  }

  async #stageAssets(root: string, manifest: MemoManifest): Promise<readonly StagedAsset[]> {
    const registrations: StagedAsset[] = []
    for (const descriptor of manifest.assets) {
      const bytes = new Uint8Array(await readFile(join(root, ...assertArchivePath(descriptor.path))))
      if (bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256)
        throw new Error(`Memo asset does not match its manifest: ${descriptor.fileName}`)
      registrations.push({ bytes, descriptor })
    }
    return registrations
  }

  async #resolveAssetConflicts(
    assets: readonly StagedAsset[],
    owner: BrowserWindow | null,
  ): Promise<ReadonlyMap<string, AssetConflictDecision>> {
    if (assets.length === 0 || this.#dependencies.assetDirectory === null)
      return new Map()
    const conflicts: string[] = []
    for (const asset of assets) {
      const destination = join(this.#dependencies.assetDirectory, asset.descriptor.fileName)
      try {
        const metadata = await stat(destination)
        if (metadata.isFile()) {
          const localBytes = new Uint8Array(await readFile(destination))
          if (digest(localBytes) !== asset.descriptor.sha256)
            conflicts.push(asset.descriptor.fileName)
        }
      }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw error
      }
    }
    if (conflicts.length === 0)
      return new Map()

    const listed = conflicts.length > 12
      ? `${conflicts.slice(0, 12).join(', ')} and ${conflicts.length - 12} more`
      : conflicts.join(', ')
    const decision = await showMessageBox(owner, {
      buttons: ['Use local for all', 'Import copies for all', 'Review individually', 'Cancel'],
      cancelId: 3,
      defaultId: 1,
      detail: `These assets already exist with different contents: ${listed}`,
      message: 'Review asset conflicts before importing',
      type: 'warning',
    })
    if (decision.response === 3)
      throw new Error('Memo import cancelled because of asset conflicts')
    const choices = new Map<string, AssetConflictDecision>()
    if (decision.response === 0 || decision.response === 1) {
      const choice: AssetConflictDecision = decision.response === 0 ? 'local' : 'copy'
      conflicts.forEach(fileName => choices.set(fileName, choice))
      return choices
    }
    for (const fileName of conflicts) {
      const item = await showMessageBox(owner, {
        buttons: ['Use local asset', 'Import a new copy', 'Cancel'],
        cancelId: 2,
        defaultId: 1,
        detail: `${fileName} already exists with different contents.`,
        message: 'Asset conflict',
        type: 'warning',
      })
      if (item.response === 2)
        throw new Error('Memo import cancelled because of an asset conflict')
      choices.set(fileName, item.response === 0 ? 'local' : 'copy')
    }
    return choices
  }

  async #publishAssets(
    assets: readonly StagedAsset[],
    conflictDecisions: ReadonlyMap<string, AssetConflictDecision>,
  ): Promise<PublishedAssets> {
    if (assets.length === 0)
      return { createdFileNames: [], fileNameMap: new Map(), registrations: [] }
    if (this.#dependencies.assetDirectory === null)
      throw new Error('Managed assets cannot be imported into an in-memory workspace')
    await mkdir(this.#dependencies.assetDirectory, { recursive: true })
    const created: string[] = []
    try {
      const registrations: RegisterAssetInput[] = []
      const fileNameMap = new Map<string, string>()
      for (const asset of assets) {
        const originalFileName = asset.descriptor.fileName
        let fileName = originalFileName
        let destination = join(this.#dependencies.assetDirectory, fileName)
        let exists = false
        try {
          const metadata = await stat(destination)
          exists = metadata.isFile()
        }
        catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
            throw error
        }
        if (exists) {
          const localBytes = new Uint8Array(await readFile(destination))
          if (digest(localBytes) !== asset.descriptor.sha256) {
            const decision = conflictDecisions.get(originalFileName)
            if (decision === undefined)
              throw new Error(`Asset conflict decision is missing for ${originalFileName}`)
            if (decision === 'local') {
              registrations.push({
                byteSize: localBytes.byteLength,
                fileName,
                mimeType: asset.descriptor.mimeType,
                originalFileName: asset.descriptor.originalFileName,
              })
              continue
            }
            const extension = fileName.slice(fileName.lastIndexOf('.'))
            fileName = `${randomUUID()}${extension}`
            destination = join(this.#dependencies.assetDirectory, fileName)
          }
          else {
            registrations.push({
              byteSize: localBytes.byteLength,
              fileName,
              mimeType: asset.descriptor.mimeType,
              originalFileName: asset.descriptor.originalFileName,
            })
            continue
          }
        }
        const temporary = join(this.#dependencies.assetDirectory, `.${fileName}.${randomUUID()}.tmp`)
        try {
          await writeFile(temporary, asset.bytes, { flag: 'wx', mode: 0o600 })
          await rename(temporary, destination)
        }
        catch (error) {
          await rm(temporary, { force: true })
          throw error
        }
        created.push(fileName)
        fileNameMap.set(originalFileName, fileName)
        registrations.push({
          byteSize: asset.bytes.byteLength,
          fileName,
          mimeType: asset.descriptor.mimeType,
          originalFileName: asset.descriptor.originalFileName,
        })
      }
      for (const asset of assets) {
        if (!fileNameMap.has(asset.descriptor.fileName))
          fileNameMap.set(asset.descriptor.fileName, asset.descriptor.fileName)
      }
      return { createdFileNames: created, fileNameMap, registrations }
    }
    catch (error) {
      await Promise.all(created.map(fileName => rm(join(this.#dependencies.assetDirectory!, fileName), { force: true })))
      throw error
    }
  }

  async #assertImportDestinationAvailable(noteId: string, journalDate: string | undefined): Promise<void> {
    if ((await this.#dependencies.storage.notes.listNoteIds()).includes(noteId))
      throw new Error(`Note ${noteId} already exists; the Memo was not imported`)
    if (journalDate !== undefined) {
      // Future Journal dates have no canonical workspace identity yet, so accepting one would bypass the Journal lifecycle.
      if (journalDate > localJournalDateNow())
        throw new Error(`Future Journal ${journalDate} cannot be imported`)
      const dates = await this.#dependencies.storage.journals.listDates({ from: journalDate, through: journalDate })
      if (dates.includes(journalDate))
        throw new Error(`Journal ${journalDate} already exists; the Memo was not imported`)
    }
  }

  async #resolveRegularImportId(sourceId: string, owner: BrowserWindow | null): Promise<string> {
    if (!(await this.#dependencies.storage.notes.listNoteIds()).includes(sourceId))
      return sourceId
    const decision = await showMessageBox(owner, {
      buttons: ['Assign a new Note ID', 'Cancel'],
      cancelId: 1,
      defaultId: 0,
      detail: `The Note ID ${sourceId} already exists in this workspace. Assigning a new ID keeps both Notes independent.`,
      message: 'Note ID conflict',
      type: 'warning',
    })
    if (decision.response !== 0)
      throw new Error('Memo import cancelled because of a Note ID conflict')
    return randomUUID()
  }

  async #resolveRegularImportTitle(sourceTitle: string, owner: BrowserWindow | null): Promise<string> {
    const titles = new Set<string>()
    let page = 1
    while (true) {
      const result = await this.#dependencies.storage.notes.listNotes({ page, pageSize: 100 })
      for (const note of result.items) {
        if (note.journalDate === undefined)
          titles.add(note.title.toLowerCase())
      }
      if (page >= result.totalPages)
        break
      page += 1
    }
    if (!titles.has(sourceTitle.toLowerCase()))
      return sourceTitle
    let suffix = 2
    let candidate = `${sourceTitle} (Imported)`
    while (titles.has(candidate.toLowerCase()))
      candidate = `${sourceTitle} (Imported ${suffix++})`
    const decision = await showMessageBox(owner, {
      buttons: [`Use "${candidate}"`, 'Cancel'],
      cancelId: 1,
      defaultId: 0,
      detail: `Regular Note titles must be unique in this workspace. The imported Note ID will remain independent.`,
      message: `The Note title "${sourceTitle}" already exists`,
      type: 'warning',
    })
    if (decision.response !== 0)
      throw new Error('Memo import cancelled because of a duplicate Note title')
    return candidate
  }

  async #publishBooks(
    note: ReturnType<typeof createEditorNote>,
    root: string,
    books: readonly MemoBookDescriptor[],
  ): Promise<PublishedBooks> {
    const entries = note.getEntries()
    const createdReadingIds: string[] = []
    try {
      for (const descriptor of books) {
        const bindingEntries = entries.filter((entry): entry is Extract<typeof entries[number], { kind: 'topic', topicType: 'book' }> => entry.kind === 'topic'
          && entry.topicType === 'book'
          && entry.book.file.format === descriptor.format
          && entry.book.file.sha256 === descriptor.sha256)
        if (bindingEntries.length === 0)
          throw new Error(`Memo BookFile ${descriptor.sha256} is not bound by the imported Note`)
        const bytes = new Uint8Array(await readFile(join(root, ...assertArchivePath(descriptor.path))))
        const binding = bindingEntries[0]!
        let matchingHint: (typeof binding.book.retrievalHints)[number] | undefined
        for (const candidate of binding.book.retrievalHints) {
          const existing = await this.#dependencies.shelfReadingFiles.find(candidate.readingId)
          if (!existing
            || existing.document.byteLength !== bytes.byteLength
            || existing.document.format !== descriptor.format) {
            continue
          }
          const existingBytes = await readBookBytes(this.#dependencies.shelfReadingFiles, {
            ...binding.book,
            retrievalHints: [candidate],
          })
          if (digest(existingBytes) === descriptor.sha256) {
            matchingHint = candidate
            break
          }
        }
        if (matchingHint)
          continue

        const sourceShelfHint = binding.book.retrievalHints.find(candidate => candidate.kind === 'shelf')
        let readingId = sourceShelfHint?.readingId ?? importedReadingId(descriptor)
        if (await this.#dependencies.shelfReadingFiles.find(readingId)) {
          do {
            readingId = importedReadingId(descriptor)
          } while (await this.#dependencies.shelfReadingFiles.find(readingId))
        }
        const shelfHint = sourceShelfHint === undefined
          ? {
              kind: 'shelf' as const,
              publicationId: `memorilo-memo:${descriptor.sha256}:${descriptor.format}`,
              readingId,
              sourceId: `memorilo-memo:${descriptor.sha256}`,
            }
          : { ...sourceShelfHint, readingId }
        for (const entry of bindingEntries) {
          if (entry.kind !== 'topic' || entry.topicType !== 'book')
            continue
          note.getBookTopic(entry.id).rebind({
            ...entry.book,
            retrievalHints: [
              shelfHint,
              ...entry.book.retrievalHints.filter(candidate => candidate.kind !== 'shelf' || candidate.readingId !== sourceShelfHint?.readingId),
            ],
          })
        }
        const saved = await this.#dependencies.shelfReadingFiles.save({
          book: binding.book.book,
          bytes,
          format: binding.book.file.format,
          name: descriptor.originalName,
          publicationId: shelfHint.publicationId,
          readingId,
          retention: 'library',
          sourceId: shelfHint.sourceId,
        })
        createdReadingIds.push(readingId)
        if (saved.document.byteLength !== descriptor.byteLength || saved.document.format !== descriptor.format)
          throw new Error(`Shelf BookFile ${descriptor.sha256} was saved with a mismatched descriptor`)
        const savedBytes = await readBookBytes(this.#dependencies.shelfReadingFiles, {
          ...binding.book,
          retrievalHints: [{ ...shelfHint, readingId }],
        })
        if (digest(savedBytes) !== descriptor.sha256)
          throw new Error(`Shelf BookFile ${descriptor.sha256} was saved with a mismatched digest`)
      }
      return { createdReadingIds }
    }
    catch (error) {
      await this.#cleanupPublishedBooks({ createdReadingIds })
      throw error
    }
  }

  async #cleanupPublishedAssets(published: PublishedAssets): Promise<void> {
    if (this.#dependencies.assetDirectory === null)
      return
    await Promise.all(published.createdFileNames.map(fileName => (
      rm(join(this.#dependencies.assetDirectory!, fileName), { force: true })
    )))
  }

  async #cleanupPublishedBooks(published: PublishedBooks): Promise<void> {
    await Promise.all(published.createdReadingIds.map(readingId => (
      this.#dependencies.shelfReadingFiles.deleteFromLibrary(readingId)
    )))
  }

  async #stageBooks(root: string, manifest: MemoManifest): Promise<readonly MemoBookDescriptor[]> {
    for (const descriptor of manifest.books) {
      const bytes = new Uint8Array(await readFile(join(root, ...assertArchivePath(descriptor.path))))
      if (bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256)
        throw new Error(`Memo BookFile does not match its manifest: ${descriptor.sha256}`)
    }
    return manifest.books
  }

  async #createImported(
    note: ReturnType<typeof createEditorNote>,
    id: string,
    kind: 'journal' | 'regular',
    assets: readonly RegisterAssetInput[] = [],
    _books: readonly MemoBookDescriptor[] = [],
  ) {
    const identity = note.getIdentity()
    const input: CreateImportedNoteInput = {
      assetReferences: projectMemoAssetReferences(note),
      assets,
      entries: toStoredEntries(note.getEntries()),
      id,
      journalDate: kind === 'journal' && identity.kind === 'journal' ? identity.journalDate : undefined,
      kind,
      learningCards: projectNoteLearningCards(note),
      learningReadingItems: projectNoteReadingItems(note),
      snapshot: note.exportSnapshot(),
      title: note.getTitle(),
      topics: note.getEntries().flatMap(entry => entry.kind === 'topic' ? [toStoredTopic(note.getTopicContent(entry.id))] : []),
    }
    if (kind === 'journal')
      input.hasUserContent = note.hasUserContent()
    const stored = await this.#dependencies.storage.notes.createImportedNote(input)
    return stored
  }
}

function entriesTypst(
  document: ExportDocument,
  inlineAsset: (src: string) => string,
  whiteboardScenePath: (topicId: string) => string,
): string {
  const render = (entries: readonly ExportDocumentEntry[]): string => entries.map((entry) => {
    if (entry.kind === 'folder')
      return `== ${escapeTypst(entry.title)}\n\n${render(entry.children)}`
    const validation = entry.validation
    if (validation === undefined)
      return `== ${escapeTypst(entry.title)}\n\n[content unavailable]\n\n${render(entry.children)}`
    const readerReference = entry.readerReference
    const readerSource = readerReference?.source.kind === 'region'
      ? (() => {
          const src = inlineAsset(readerReference.source.imageSrc)
          return src.length === 0
            ? `[Reader region: ${escapeTypst(readerReference.source.location)} — image unavailable]\n\n`
            : `#image("${escapeTypstString(src)}", width: 100%)\n_${escapeTypst(readerReference.source.location)}_\n\n`
        })()
      : readerReference?.source.kind === 'text'
        ? `#quote[${escapeTypst(readerReference.source.text)}] — ${escapeTypst(readerReference.source.location)}\n\n`
        : ''
    const content = 'document' in validation
      ? renderTypstContent(validation.document, { inlineAsset })
      : 'embeddedEditors' in validation
        ? `${whiteboardScenePath(entry.id).length === 0 ? '[Whiteboard scene unavailable]\n\n' : `#image("${escapeTypstString(whiteboardScenePath(entry.id))}", width: 100%)\n\n`}${Object.values(validation.embeddedEditors).map(editor => renderTypstContent(editor.document, { inlineAsset })).join('')}`
        : 'state' in validation
          ? renderImageOcclusionTypst(validation.state as ImageOcclusionExportState, inlineAsset)
          : '[content unavailable]\n\n'
    return `== ${escapeTypst(entry.title)}\n\n${readerSource}${content}${render(entry.children)}`
  }).join('')
  return render(document.entries)
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  }
  catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
