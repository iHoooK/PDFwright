import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractPdfPaths } from '../../src/main/open-args'
import { resolveWithinDir } from '../../src/main/services/fs-utils'
import { normalizeRecent, RecentFilesStore } from '../../src/main/services/recent-files'

describe('extractPdfPaths', () => {
  const cwd = resolve('D:\\work')

  it('берёт .pdf-аргумент и разрешает относительный путь', () => {
    expect(extractPdfPaths(['app.exe', 'C:\\docs\\a.pdf'], cwd)).toEqual(['C:\\docs\\a.pdf'])
    expect(extractPdfPaths(['app.exe', 'b.PDF'], cwd)).toEqual([resolve(cwd, 'b.PDF')])
  })

  it('отдаёт все PDF по порядку без повторов: несколько файлов, брошенных на ярлык', () => {
    expect(
      extractPdfPaths(['app.exe', 'C:\\a.pdf', '--flag', 'notes.txt', 'b.pdf', 'C:\\a.pdf'], cwd)
    ).toEqual(['C:\\a.pdf', resolve(cwd, 'b.pdf')])
  })

  it('игнорирует флаги, точку и не-PDF аргументы', () => {
    expect(extractPdfPaths(['electron', '.', '--inspect=9229'], cwd)).toEqual([])
    expect(extractPdfPaths(['app.exe', 'notes.txt'], cwd)).toEqual([])
    expect(extractPdfPaths(['app.exe'], cwd)).toEqual([])
    // Первый аргумент — сама программа, даже если её путь кончается на .pdf.
    expect(extractPdfPaths(['x.pdf'], cwd)).toEqual([])
  })
})

describe('resolveWithinDir', () => {
  const base = resolve('D:\\app\\renderer')

  it('разрешает обычные пути внутри каталога', () => {
    expect(resolveWithinDir(base, '/index.html')).toBe(join(base, 'index.html'))
    expect(resolveWithinDir(base, 'assets/x.js')).toBe(join(base, 'assets', 'x.js'))
  })

  it('отвергает выход за пределы каталога', () => {
    expect(resolveWithinDir(base, '/../secret.txt')).toBeNull()
    expect(resolveWithinDir(base, 'a/../../x')).toBeNull()
    expect(resolveWithinDir(base, '')).toBeNull()
    expect(resolveWithinDir(base, 'a\0b')).toBeNull()
    expect(resolveWithinDir(base, `..${sep}..${sep}x`)).toBeNull()
  })
})

describe('normalizeRecent', () => {
  it('отбрасывает мусор и дубликаты', () => {
    const result = normalizeRecent([
      { path: 'C:\\a.pdf', lastOpenedMs: 5 },
      { path: 'C:\\a.pdf', lastOpenedMs: 6 },
      { path: '', lastOpenedMs: 1 },
      'nope',
      { path: 'C:\\b.pdf', lastOpenedMs: 'x' }
    ])
    expect(result).toEqual([
      { path: 'C:\\a.pdf', name: 'a.pdf', lastOpenedMs: 5 },
      { path: 'C:\\b.pdf', name: 'b.pdf', lastOpenedMs: 0 }
    ])
  })
})

describe('RecentFilesStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfwright-recent-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('добавляет в начало, обрезает по лимиту и сохраняет на диск', async () => {
    const store = RecentFilesStore.forUserData(dir, () => 2)
    await store.touch('C:\\one.pdf')
    await store.touch('C:\\two.pdf')
    await store.touch('C:\\three.pdf')
    const list = await store.list()
    expect(list.map((i) => i.name)).toEqual(['three.pdf', 'two.pdf'])

    const reloaded = await RecentFilesStore.forUserData(dir, () => 2).load()
    expect(reloaded.map((i) => i.name)).toEqual(['three.pdf', 'two.pdf'])
    expect(JSON.parse(await readFile(join(dir, 'recent.json'), 'utf8'))).toHaveLength(2)
  })

  it('помнит число страниц: новое значение заменяет старое, без значения оно остаётся', async () => {
    const store = RecentFilesStore.forUserData(dir, () => 10)
    await store.touch('C:\\one.pdf', 3)
    await store.touch('C:\\one.pdf')
    expect((await store.list())[0]?.pages).toBe(3)
    await store.touch('C:\\one.pdf', 5)
    const reloaded = await RecentFilesStore.forUserData(dir, () => 10).load()
    expect(reloaded[0]?.pages).toBe(5)
    expect(normalizeRecent([{ path: 'C:\\x.pdf', pages: -1 }])[0]).not.toHaveProperty('pages')
  })

  it('удаляет запись и переживает повреждённый файл', async () => {
    const store = RecentFilesStore.forUserData(dir, () => 10)
    await store.touch('C:\\one.pdf')
    expect(await store.remove('C:\\one.pdf')).toEqual([])
  })
})
