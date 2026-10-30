import { describe, expect, it } from 'vitest'
import { isPortableBuild, PORTABLE_MARKER } from '../../src/main/services/app-paths'

// node:path разбирает пути по правилам системы, на которой идут тесты: на Windows
// примеры с буквой диска, на macOS — пути POSIX.
const onWindows = process.platform === 'win32'

describe('isPortableBuild', () => {
  const exe = onWindows ? 'C:\\Apps\\PDFwright\\PDFwright.exe' : '/Apps/PDFwright/PDFwright'
  const marker = onWindows
    ? `C:\\Apps\\PDFwright\\${PORTABLE_MARKER}`
    : `/Apps/PDFwright/${PORTABLE_MARKER}`

  it('узнаёт portable по переменной окружения electron-builder', () => {
    const dir = onWindows ? 'C:\\Apps' : '/Apps'
    expect(isPortableBuild({ PORTABLE_EXECUTABLE_DIR: dir }, exe, () => false)).toBe(true)
  })

  it('узнаёт portable по файлу-маркеру рядом с exe', () => {
    const seen: string[] = []
    const exists = (path: string): boolean => {
      seen.push(path)
      return path.endsWith(PORTABLE_MARKER)
    }
    expect(isPortableBuild({}, exe, exists)).toBe(true)
    expect(seen[0]).toBe(marker)
  })

  it('установленная версия — не portable', () => {
    expect(isPortableBuild({}, exe, () => false)).toBe(false)
  })
})
