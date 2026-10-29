import { describe, expect, it } from 'vitest'
import {
  forPlatform,
  isDoneKey,
  isMac,
  isPageDeleteKey,
  macChip,
  platform,
  shortcutKey
} from '@renderer/app/platform'
import { applyOverrides } from '@renderer/i18n/overrides'
import { en, enMac } from '../../src/renderer/src/i18n/en'
import { ru, ruMac } from '../../src/renderer/src/i18n/ru'
import { OpenFileQueue } from '../../src/main/open-file-queue'
import { isPdfPath } from '../../src/main/open-args'

const key = (name: string, mods: { ctrl?: boolean; meta?: boolean } = {}) => ({
  key: name,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false
})

describe('платформа в renderer', () => {
  it('без preload (браузер, unit-тесты) — Windows', () => {
    expect(platform).toBe('win32')
    expect(isMac).toBe(false)
  })

  it('клавиша сочетаний: в Windows только Ctrl, на Mac ещё и ⌘', () => {
    expect(shortcutKey(key('a', { ctrl: true }), false)).toBe(true)
    expect(shortcutKey(key('a', { meta: true }), false)).toBe(false)
    expect(shortcutKey(key('a', { meta: true }), true)).toBe(true)
    expect(shortcutKey(key('a', { ctrl: true }), true)).toBe(true)
    expect(shortcutKey(key('a'), true)).toBe(false)
  })

  it('«Готово» в поле: Ctrl+Enter везде, ⌘↩ — только на Mac', () => {
    expect(isDoneKey(key('Enter', { ctrl: true }), false)).toBe(true)
    expect(isDoneKey(key('Enter', { meta: true }), false)).toBe(false)
    expect(isDoneKey(key('Enter', { meta: true }), true)).toBe(true)
    expect(isDoneKey(key('Enter'), true)).toBe(false)
    expect(isDoneKey(key('a', { meta: true }), true)).toBe(false)
  })

  it('удаление страниц: Delete везде, Backspace (delete на Mac) — только на Mac', () => {
    expect(isPageDeleteKey('Delete', false)).toBe(true)
    expect(isPageDeleteKey('Backspace', false)).toBe(false)
    expect(isPageDeleteKey('Delete', true)).toBe(true)
    expect(isPageDeleteKey('Backspace', true)).toBe(true)
    expect(isPageDeleteKey('Escape', true)).toBe(false)
  })

  it('подписи выбираются по системе, процессор Mac — по arch', () => {
    expect(forPlatform('Ctrl+S', '⌘S', false)).toBe('Ctrl+S')
    expect(forPlatform('Ctrl+S', '⌘S', true)).toBe('⌘S')
    expect(macChip('arm64')).toBe('Apple Silicon')
    expect(macChip('x64')).toBe('Intel')
  })
})

/** Все строки словаря с путями: функции вызываются с пробными аргументами. */
function texts(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (typeof value === 'function') {
    const result = (value as (...args: unknown[]) => unknown)('1.2.3', 'x', 'y')
    return typeof result === 'string' ? [{ path, text: result }] : []
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k))
  }
  return []
}

function keys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return [path]
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => keys(v, path ? `${path}.${k}` : k))
  }
  return [path]
}

/** На Mac не показываются: обновление там ставится вручную (canInstall: false). */
const NOT_SHOWN_ON_MAC = new Set(['settings.updatesInstallText'])

describe('словари для Mac', () => {
  it('у русского и английского одни и те же замены', () => {
    expect(keys(enMac)).toEqual(keys(ruMac))
  })

  it('каждая замена — существующий ключ словаря', () => {
    const known = new Set(keys(ru))
    for (const path of keys(ruMac)) expect(known.has(path), path).toBe(true)
  })

  it('без Ctrl, Проводника и Windows: всё, что показывается на Mac', () => {
    for (const [name, dict] of [
      ['ru', applyOverrides(ru, ruMac)],
      ['en', applyOverrides(en, enMac)]
    ] as const) {
      for (const { path, text } of texts(dict)) {
        if (NOT_SHOWN_ON_MAC.has(path)) continue
        expect(/Ctrl|Проводник|File Explorer|Windows/.test(text), `${name} ${path}: ${text}`).toBe(
          false
        )
      }
    }
  })

  it('по-русски клавиша удаления на Mac — delete, как на клавиатуре', () => {
    for (const { path, text } of texts(applyOverrides(ru, ruMac))) {
      expect(text.includes('Delete'), `${path}: ${text}`).toBe(false)
    }
  })

  it('в английских заменах нет кириллицы', () => {
    for (const { path, text } of texts(enMac)) {
      expect(/[Ѐ-ӿ]/.test(text), `${path}: ${text}`).toBe(false)
    }
  })

  it('замены не трогают остальные строки и исходный словарь', () => {
    const mac = applyOverrides(ru, ruMac)
    expect(mac.settings.title).toBe(ru.settings.title)
    expect(mac.markup.hint.hand).toBe(ru.markup.hint.hand)
    expect(mac.tools.showInFolder).toBe('Показать в Finder')
    expect(ru.tools.showInFolder).toBe('Показать в папке')
    expect(mac.shortcuts).toHaveLength(ru.shortcuts.length)
  })

  it('«О программе»: система подставляется, у Windows прежний текст', () => {
    expect(ru.settings.aboutLead('1.0.0', 'установленная версия', 'Windows x64')).toBe(
      'PDFwright 1.0.0 · Windows x64 · установленная версия'
    )
    expect(en.settings.aboutLead('1.0.0', 'installed version', 'macOS · Apple Silicon')).toBe(
      'PDFwright 1.0.0 · macOS · Apple Silicon · installed version'
    )
  })
})

describe('файлы из Finder (open-file)', () => {
  it('до подключения обработчика копятся по порядку без повторов', () => {
    const queue = new OpenFileQueue()
    queue.push('/Users/me/a.pdf')
    queue.push('/Users/me/b.pdf')
    queue.push('/Users/me/a.pdf')
    expect(queue.take()).toEqual(['/Users/me/a.pdf', '/Users/me/b.pdf'])
    expect(queue.take()).toEqual([])
  })

  it('обработчик получает накопленные пути, а затем каждый новый сразу', () => {
    const queue = new OpenFileQueue()
    const opened: string[] = []
    queue.push('/a.pdf')
    queue.attach((path) => opened.push(path))
    expect(opened).toEqual(['/a.pdf'])
    queue.push('/b.pdf')
    queue.push('/c.pdf')
    expect(opened).toEqual(['/a.pdf', '/b.pdf', '/c.pdf'])
    expect(queue.take()).toEqual([])
  })

  it('открываются только PDF', () => {
    expect(isPdfPath('/Users/me/Отчёт.PDF')).toBe(true)
    expect(isPdfPath('/Users/me/notes.txt')).toBe(false)
  })
})
