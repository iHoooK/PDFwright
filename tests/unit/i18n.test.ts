import { afterEach, describe, expect, it } from 'vitest'
import { m, setMessageLanguage } from '@shared/messages'
import { parsePageRanges } from '@shared/pdf-ops/ranges'
import { en } from '../../src/renderer/src/i18n/en'
import { ru } from '../../src/renderer/src/i18n/ru'
import { mainStrings } from '../../src/main/strings'

const CYRILLIC = /[Ѐ-ӿ]/

/** Все листья словаря: строки и результаты функций с пробными аргументами. */
function leaves(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown
    const samples = [fn(2, 3, 4), fn(1, 1, 1), fn('x', 2, 3), fn('x', 'y', 'z')].filter(
      (v): v is string => typeof v === 'string'
    )
    return samples.map((text) => ({ path: `${path}()`, text }))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => leaves(v, path ? `${path}.${key}` : key))
  }
  return []
}

function keys(value: unknown, path = ''): string[] {
  if (value && typeof value === 'object' && typeof value !== 'function') {
    return Object.entries(value).flatMap(([key, v]) => keys(v, path ? `${path}.${key}` : key))
  }
  return [path]
}

describe('словари интерфейса', () => {
  it('у русского и английского одинаковые ключи', () => {
    expect(keys(en)).toEqual(keys(ru))
  })

  it('в английском нет пустых строк и кириллицы', () => {
    for (const { path, text } of leaves(en)) {
      expect(text.trim(), path).not.toBe('')
      expect(CYRILLIC.test(text), `${path}: ${text}`).toBe(false)
    }
  })

  it('в русском нет пустых строк', () => {
    for (const { path, text } of leaves(ru)) expect(text.trim(), path).not.toBe('')
  })

  it('меню и диалоги main переведены', () => {
    for (const { path, text } of leaves(mainStrings('en'))) {
      expect(CYRILLIC.test(text), `${path}: ${text}`).toBe(false)
    }
    expect(keys(mainStrings('en'))).toEqual(keys(mainStrings('ru')))
  })
})

describe('сообщения общего кода', () => {
  afterEach(() => {
    setMessageLanguage('ru')
  })

  it('выбираются по языку сообщений', () => {
    expect(m({ ru: 'привет', en: 'hello' })).toBe('привет')
    setMessageLanguage('en')
    expect(m({ ru: 'привет', en: 'hello' })).toBe('hello')
    expect(() => parsePageRanges('', 10)).toThrow('Enter at least one range')
  })
})
