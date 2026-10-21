import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

export interface DesktopPathsOptions {
  developmentDirectory: string
  homePath: string
  localCachePath?: string
  mainDirectory: string
  packaged: boolean
  platform: NodeJS.Platform
  resourcesPath: string
  shelfImageCachePath?: string
  userDataPath: string
}

export interface DesktopPaths {
  automaticBackupDirectory: string | null
  assetDirectory: string | null
  dataDirectory: string
  databasePath: string
  embeddingModelCacheDirectory: string
  shelfBookCacheDirectory: string
  shelfImageCacheDatabasePath: string
  shelfLibraryDirectory: string
}

export function createDesktopPaths(options: DesktopPathsOptions): DesktopPaths {
  const dataDirectory = options.packaged ? options.userDataPath : options.developmentDirectory
  const databasePath = join(dataDirectory, 'memorilo.sqlite')
  const workspace = workspaceDirectory(databasePath)
  const shelfImageCacheDatabasePath = configuredShelfImageCachePath(options)
    ?? (options.packaged
      ? packagedCachePath(options, 'shelf-images.sqlite')
      : join(dataDirectory, 'shelf-images.sqlite'))
  const shelfBookCacheDirectory = options.shelfImageCachePath === ':memory:' || !options.packaged
    ? join(dataDirectory, 'shelf-book-cache')
    : packagedCachePath(options, 'shelf-books')

  return {
    automaticBackupDirectory: workspace === null ? null : join(workspace, 'backup'),
    assetDirectory: workspace === null ? null : join(workspace, 'assets'),
    dataDirectory,
    databasePath,
    embeddingModelCacheDirectory: options.packaged
      ? join(options.resourcesPath, 'embedding-models')
      : resolve(options.mainDirectory, '../../../../.cache/embedding-models'),
    shelfBookCacheDirectory,
    shelfImageCacheDatabasePath,
    shelfLibraryDirectory: workspace === null ? join(dataDirectory, 'shelf') : join(workspace, 'shelf'),
  }
}

function configuredShelfImageCachePath(options: DesktopPathsOptions): string | null {
  const configured = options.shelfImageCachePath
  if (configured === undefined)
    return null
  if (configured.length === 0)
    throw new TypeError('MEMORILO_SHELF_IMAGE_CACHE_PATH must not be empty')
  return configured
}

function packagedCachePath(options: DesktopPathsOptions, ...segments: string[]): string {
  const root = options.platform === 'darwin'
    ? join(options.homePath, 'Library', 'Caches', 'Memorilo')
    : options.platform === 'win32'
      ? join(options.localCachePath ?? join(options.homePath, 'AppData', 'Local'), 'Memorilo', 'Cache')
      : join(process.env.XDG_CACHE_HOME || join(options.homePath, '.cache'), 'memorilo')
  return join(root, ...segments)
}

export function workspaceDirectory(databasePath: string): string | null {
  if (databasePath === ':memory:')
    return null
  const absoluteDatabase = isAbsolute(databasePath) ? databasePath : resolve(databasePath)
  return dirname(absoluteDatabase)
}

export function automaticBackupDirectory(databasePath: string): string | null {
  const directory = workspaceDirectory(databasePath)
  return directory === null ? null : join(directory, 'backup')
}
