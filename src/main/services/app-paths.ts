import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Имя файла-маркера, который лежит рядом с PDFwright.exe в portable-архиве. */
export const PORTABLE_MARKER = 'PDFwright.portable'

/**
 * Portable-сборка — распакованная папка `win-unpacked` с файлом-маркером
 * рядом с exe (его кладёт scripts/package-release.ps1). Такая сборка не
 * установлена через установщик, поэтому обновления предлагаются только ссылкой.
 * Переменная PORTABLE_EXECUTABLE_DIR оставлена для совместимости с portable-целью
 * electron-builder.
 */
export function isPortableBuild(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
  exists: (path: string) => boolean = existsSync
): boolean {
  const dir = env.PORTABLE_EXECUTABLE_DIR
  if (typeof dir === 'string' && dir.length > 0) return true
  return exists(join(dirname(execPath), PORTABLE_MARKER))
}
