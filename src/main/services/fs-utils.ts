import { copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, normalize, resolve, sep } from 'node:path'

/** Атомарная запись текста: во временный файл рядом и переименование. */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  await writeAtomicBytes(filePath, Buffer.from(content, 'utf8'))
}

/**
 * Атомарная запись байтов. Файл сначала пишется рядом под временным именем
 * и переименовывается поверх цели: при сбое исходный файл остаётся целым.
 * При `backup` существующая цель предварительно копируется в `<файл>.bak`.
 */
export async function writeAtomicBytes(
  filePath: string,
  data: Buffer,
  backup = false
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  if (backup && (await exists(filePath))) await copyFile(filePath, `${filePath}.bak`)
  const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(tempPath, data)
  await rename(tempPath, filePath)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }
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

/** Байты из IPC приходят как ArrayBuffer или типизированный массив; сводим к Buffer без копии. */
export function toBuffer(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError('Ожидаются байты файла')
}
