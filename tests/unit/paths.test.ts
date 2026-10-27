import { describe, expect, it } from 'vitest'
import {
  basenameOf,
  dirnameOf,
  freePath,
  joinPath,
  numberedPath,
  safeFileName,
  stripExtension
} from '@shared/paths'

describe('paths', () => {
  it('разбирает пути Windows и POSIX', () => {
    expect(dirnameOf('C:\\Документы\\a.pdf')).toBe('C:\\Документы')
    expect(basenameOf('C:\\Документы\\a.pdf')).toBe('a.pdf')
    expect(dirnameOf('/home/u/a.pdf')).toBe('/home/u')
    expect(basenameOf('a.pdf')).toBe('a.pdf')
  })

  it('склеивает путь разделителем исходной папки', () => {
    expect(joinPath('C:\\Документы', 'b.pdf')).toBe('C:\\Документы\\b.pdf')
    expect(joinPath('C:\\Документы\\', 'b.pdf')).toBe('C:\\Документы\\b.pdf')
    expect(joinPath('/tmp', 'b.pdf')).toBe('/tmp/b.pdf')
  })

  it('убирает расширение и запрещённые символы', () => {
    expect(stripExtension('Договор.v2.pdf')).toBe('Договор.v2')
    expect(stripExtension('.hidden')).toBe('.hidden')
    expect(safeFileName('a<b>:c?.pdf')).toBe('a_b__c_.pdf')
    expect(safeFileName('   ')).toBe('document')
  })

  it('подбирает свободное имя, как Проводник: «имя (2).pdf», «имя (3).pdf»', () => {
    expect(numberedPath('C:\\Папка\\Договор_стр1-2.pdf', 2)).toBe(
      'C:\\Папка\\Договор_стр1-2 (2).pdf'
    )
    expect(numberedPath('notes', 3)).toBe('notes (3)')
    const taken = new Set(['c:\\папка\\договор.pdf', 'c:\\папка\\договор (2).pdf'])
    const has = (lower: string): boolean => taken.has(lower)
    expect(freePath('C:\\Папка\\ДОГОВОР.pdf', has)).toBe('C:\\Папка\\ДОГОВОР (3).pdf')
    expect(freePath('C:\\Папка\\Новый.pdf', has)).toBe('C:\\Папка\\Новый.pdf')
  })
})
