import { describe, expect, it } from 'vitest'
import { isPortableBuild, PORTABLE_MARKER } from '../../src/main/services/app-paths'

describe('isPortableBuild', () => {
  const exe = 'C:\\Apps\\PDFwright\\PDFwright.exe'

  it('узнаёт portable по переменной окружения electron-builder', () => {
    expect(isPortableBuild({ PORTABLE_EXECUTABLE_DIR: 'C:\\Apps' }, exe, () => false)).toBe(true)
  })

  it('узнаёт portable по файлу-маркеру рядом с exe', () => {
    const seen: string[] = []
    const exists = (path: string): boolean => {
      seen.push(path)
      return path.endsWith(PORTABLE_MARKER)
    }
    expect(isPortableBuild({}, exe, exists)).toBe(true)
    expect(seen[0]).toBe(`C:\\Apps\\PDFwright\\${PORTABLE_MARKER}`)
  })

  it('установленная версия — не portable', () => {
    expect(isPortableBuild({}, exe, () => false)).toBe(false)
  })
})
