import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

export function mainDatabasePath(userDataPath: string): string {
  const configured = process.env.MEMORILO_DATABASE_PATH
  if (configured === undefined)
    return join(userDataPath, 'memorilo.sqlite')
  if (configured.length === 0)
    throw new TypeError('MEMORILO_DATABASE_PATH must not be empty')
  return configured
}

export function applicationDataDirectory(userDataPath: string, developmentDirectory: string, packaged: boolean): string {
  // E2E launches the unpackaged app with isolated user-data paths, so identities and configuration must not leak through .dev.
  if (process.env.MEMORILO_E2E_USE_USER_DATA === '1')
    return userDataPath
  return packaged ? userDataPath : developmentDirectory
}

export function workspaceDirectory(databasePath: string): string | null {
  if (databasePath === ':memory:')
    return null
  const absoluteDatabase = isAbsolute(databasePath) ? databasePath : resolve(databasePath)
  return dirname(absoluteDatabase)
}

export function assetDirectory(databasePath: string): string | null {
  const directory = workspaceDirectory(databasePath)
  return directory === null ? null : join(directory, 'assets')
}

export function automaticBackupDirectory(databasePath: string): string | null {
  const directory = workspaceDirectory(databasePath)
  return directory === null ? null : join(directory, 'backup')
}

export function shelfLibraryDirectory(databasePath: string, userDataPath: string): string {
  const directory = workspaceDirectory(databasePath)
  return directory === null ? join(userDataPath, 'shelf') : join(directory, 'shelf')
}
