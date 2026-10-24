import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, normalize, resolve, sep } from 'node:path'

/** Атомарная запись: во временный файл рядом и переименование. */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * Разрешает путь внутри каталога и отвергает выход за его пределы
 * (`..`, абсолютные пути, UNC). Возвращает null, если путь небезопасен.
 */
export function resolveWithinDir(baseDir: string, relativePath: string): string | null {
  const base = resolve(baseDir)
  const cleaned = relativePath.replace(/^[/\\]+/, '')
  if (cleaned.length === 0 || cleaned.includes('\0')) return null
  const target = normalize(resolve(base, cleaned))
  if (target !== base && !target.startsWith(base + sep)) return null
  return target
}
