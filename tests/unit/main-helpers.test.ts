import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractPdfPaths } from '../../src/main/open-args'
import { resolveWithinDir } from '../../src/main/services/fs-utils'
import { normalizeRecent, RecentFilesStore } from '../../src/main/services/recent-files'

// node:path разбирает пути по правилам системы, на которой идут тесты: на Windows
// примеры с диском C: (atRoot('docs', 'a.pdf') — C:\docs\a.pdf), на macOS — /docs/a.pdf.
const onWindows = process.platform === 'win32'
const atRoot = (...parts: string[]): string =>
  onWindows ? `C:\\${parts.join('\\')}` : `/${parts.join('/')}`

describe('extractPdfPaths', () => {
  const cwd = resolve(onWindows ? 'D:\\work' : '/work')

  it('берёт .pdf-аргумент и разрешает относительный путь', () => {
    expect(extractPdfPaths(['app.exe', atRoot('docs', 'a.pdf')], cwd)).toEqual([
      atRoot('docs', 'a.pdf')
    ])
    expect(extractPdfPaths(['app.exe', 'b.PDF'], cwd)).toEqual([resolve(cwd, 'b.PDF')])
  })

  it('отдаёт все PDF по порядку без повторов: несколько файлов, брошенных на ярлык', () => {
    const a = atRoot('a.pdf')
    expect(extractPdfPaths(['app.exe', a, '--flag', 'notes.txt', 'b.pdf', a], cwd)).toEqual([
      a,
      resolve(cwd, 'b.pdf')
    ])
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
    const a = atRoot('a.pdf')
    const b = atRoot('b.pdf')
    const result = normalizeRecent([
      { path: a, lastOpenedMs: 5 },
      { path: a, lastOpenedMs: 6 },
      { path: '', lastOpenedMs: 1 },
      'nope',
      { path: b, lastOpenedMs: 'x' }
    ])
    expect(result).toEqual([
      { path: a, name: 'a.pdf', lastOpenedMs: 5 },
      { path: b, name: 'b.pdf', lastOpenedMs: 0 }
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
    await store.touch(atRoot('one.pdf'))
    await store.touch(atRoot('two.pdf'))
    await store.touch(atRoot('three.pdf'))
    const list = await store.list()
    expect(list.map((i) => i.name)).toEqual(['three.pdf', 'two.pdf'])

    const reloaded = await RecentFilesStore.forUserData(dir, () => 2).load()
    expect(reloaded.map((i) => i.name)).toEqual(['three.pdf', 'two.pdf'])
    expect(JSON.parse(await readFile(join(dir, 'recent.json'), 'utf8'))).toHaveLength(2)
  })

  it('помнит число страниц: новое значение заменяет старое, без значения оно остаётся', async () => {
    const store = RecentFilesStore.forUserData(dir, () => 10)
    const one = atRoot('one.pdf')
    await store.touch(one, 3)
    await store.touch(one)
    expect((await store.list())[0]?.pages).toBe(3)
    await store.touch(one, 5)
    const reloaded = await RecentFilesStore.forUserData(dir, () => 10).load()
    expect(reloaded[0]?.pages).toBe(5)
    expect(normalizeRecent([{ path: atRoot('x.pdf'), pages: -1 }])[0]).not.toHaveProperty('pages')
  })

  it('удаляет запись и переживает повреждённый файл', async () => {
    const store = RecentFilesStore.forUserData(dir, () => 10)
    await store.touch(atRoot('one.pdf'))
    expect(await store.remove(atRoot('one.pdf'))).toEqual([])
  })
})
