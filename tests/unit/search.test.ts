import { describe, expect, it } from 'vitest'
import { findMatches, segmentItem } from '@shared/pdf-search'

describe('findMatches', () => {
  const items = ['Арендная ', 'плата вносится ', 'ежемесячно. Арендная плата']

  it('находит совпадения без учёта регистра и возвращает контекст', () => {
    const matches = findMatches(items, 'АРЕНДНАЯ')
    expect(matches).toHaveLength(2)
    expect(matches[0]?.pieces).toEqual([{ item: 0, start: 0, end: 8 }])
    expect(matches[1]?.pieces).toEqual([{ item: 2, start: 12, end: 20 }])
    expect(matches[0]?.snippet).toContain('Арендная')
  })

  it('режет совпадение по границам фрагментов', () => {
    const matches = findMatches(items, 'арендная плата')
    expect(matches).toHaveLength(2)
    expect(matches[0]?.pieces).toEqual([
      { item: 0, start: 0, end: 9 },
      { item: 1, start: 0, end: 5 }
    ])
  })

  it('пустой или пробельный запрос ничего не находит', () => {
    expect(findMatches(items, '   ')).toEqual([])
    expect(findMatches([], 'плата')).toEqual([])
  })

  it('схлопывает повторные пробелы в запросе', () => {
    expect(findMatches(items, 'плата   вносится')).toHaveLength(1)
  })

  it('не склеивает слова соседних строк: по концу строки встаёт пробел', () => {
    // Так pdf.js отдаёт строки: пустой фрагмент с hasEOL или hasEOL у самой строки.
    const lines = ['ул. Образцовая, 1', '', 'Договор оказания', 'Стороны заключили', 'настоящий']
    const breaks = [false, true, true, true, false]
    const [heading] = findMatches(lines, 'договор', breaks)
    expect(heading?.snippet).toContain('1 Договор оказания')
    expect(heading?.pieces).toEqual([{ item: 2, start: 0, end: 7 }])
    const [across] = findMatches(lines, 'заключили настоящий', breaks)
    expect(across?.snippet).toContain('заключили настоящий')
    expect(across?.pieces).toEqual([
      { item: 3, start: 8, end: 17 },
      { item: 4, start: 0, end: 9 }
    ])
    // Без отметок концов строк поведение прежнее.
    expect(findMatches(lines, 'заключилинастоящий')).toHaveLength(1)
    expect(findMatches(lines, 'заключилинастоящий', breaks)).toHaveLength(0)
  })
})

describe('segmentItem', () => {
  it('без диапазонов возвращает один сегмент', () => {
    expect(segmentItem('abc', [])).toEqual([{ text: 'abc', mark: 'none' }])
  })

  it('делит текст и отдаёт приоритет активному диапазону', () => {
    const segments = segmentItem('0123456789', [
      { start: 2, end: 6, active: false },
      { start: 4, end: 8, active: true }
    ])
    expect(segments).toEqual([
      { text: '01', mark: 'none' },
      { text: '23', mark: 'match' },
      { text: '4567', mark: 'active' },
      { text: '89', mark: 'none' }
    ])
  })

  it('обрезает диапазоны за пределами текста', () => {
    expect(segmentItem('abc', [{ start: -5, end: 99, active: false }])).toEqual([
      { text: 'abc', mark: 'match' }
    ])
  })
})
