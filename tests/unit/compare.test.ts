import { describe, expect, it } from 'vitest'
import {
  diffLines,
  diffRasters,
  diffSequences,
  diffWords,
  hasTextChanges,
  isDifference,
  isWord,
  linesFromPieces,
  MASK_ADDED,
  MASK_REMOVED,
  MASK_SAME,
  nextDifference,
  pageRows,
  presenceStatus,
  type Raster
} from '@shared/compare'

/** Белый растр с чёрными прямоугольниками [x, y, w, h]. */
function raster(width: number, height: number, boxes: number[][] = [], gray = 0): Raster {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [bx = 0, by = 0, bw = 0, bh = 0] of boxes) {
    for (let y = by; y < by + bh; y += 1) {
      for (let x = bx; x < bx + bw; x += 1) {
        const i = (y * width + x) * 4
        data[i] = gray
        data[i + 1] = gray
        data[i + 2] = gray
      }
    }
  }
  return { width, height, data }
}

describe('diffRasters', () => {
  it('одинаковые растры не отличаются', () => {
    const a = raster(40, 30, [[5, 5, 10, 4]])
    const diff = diffRasters(a, raster(40, 30, [[5, 5, 10, 4]]))
    expect(diff.count).toBe(0)
    expect(diff.regions).toEqual([])
    expect(diff.mask.every((v) => v === MASK_SAME)).toBe(true)
  })

  it('находит добавленный и удалённый блоки с рамками и маской', () => {
    const a = raster(100, 80, [[10, 10, 8, 6]])
    const b = raster(100, 80, [[60, 50, 12, 5]])
    const diff = diffRasters(a, b)
    expect(diff.regions).toEqual([
      { x: 10, y: 10, width: 8, height: 6 },
      { x: 60, y: 50, width: 12, height: 5 }
    ])
    expect(diff.count).toBe(8 * 6 + 12 * 5)
    expect(diff.mask[12 * 100 + 12]).toBe(MASK_REMOVED)
    expect(diff.mask[52 * 100 + 65]).toBe(MASK_ADDED)
  })

  it('не считает отличием слабую разницу оттенка и сдвиг края на пиксель', () => {
    const a = raster(60, 40, [[10, 10, 20, 8]], 0)
    const lighter = diffRasters(a, raster(60, 40, [[10, 10, 20, 8]], 30))
    expect(lighter.count).toBe(0)
    const shifted = diffRasters(a, raster(60, 40, [[11, 10, 20, 8]]))
    expect(shifted.count).toBe(0)
    // Без допуска на сглаживание тот же сдвиг виден по краям.
    expect(diffRasters(a, raster(60, 40, [[11, 10, 20, 8]]), { tolerance: 0 }).count).toBe(16)
  })

  it('отбрасывает одиночные пиксели шума', () => {
    const a = raster(50, 50)
    const b = raster(50, 50, [[25, 25, 1, 1]])
    const diff = diffRasters(a, b)
    expect(diff.count).toBe(0)
    expect(diff.mask[25 * 50 + 25]).toBe(MASK_SAME)
    expect(diffRasters(a, b, { minPixels: 1 }).count).toBe(1)
  })

  it('сравнивает растры разного размера в общей рамке поверх белой бумаги', () => {
    const a = raster(30, 20)
    const b = raster(30, 40, [[0, 30, 30, 10]])
    const diff = diffRasters(a, b)
    expect(diff.width).toBe(30)
    expect(diff.height).toBe(40)
    expect(diff.regions).toEqual([{ x: 0, y: 30, width: 30, height: 10 }])
  })

  it('учитывает прозрачность: прозрачный пиксель — бумага', () => {
    const a = raster(20, 20)
    const b = raster(20, 20, [[5, 5, 6, 6]])
    for (let i = 3; i < b.data.length; i += 4) (b.data as Uint8ClampedArray)[i] = 0
    expect(diffRasters(a, b).count).toBe(0)
  })

  it('сводит соседние отличия в одну область', () => {
    const a = raster(100, 40)
    const b = raster(100, 40, [
      [10, 10, 6, 10],
      [20, 10, 6, 10]
    ])
    const diff = diffRasters(a, b)
    expect(diff.regions).toEqual([{ x: 10, y: 10, width: 16, height: 10 }])
  })
})

describe('diffSequences', () => {
  it('выделяет общую часть, удалённое и добавленное', () => {
    const parts = diffSequences(['a', 'b', 'c', 'd'], ['a', 'c', 'x', 'd'])
    expect(parts).toEqual([
      { kind: 'same', value: 'a' },
      { kind: 'removed', value: 'b' },
      { kind: 'same', value: 'c' },
      { kind: 'added', value: 'x' },
      { kind: 'same', value: 'd' }
    ])
  })

  it('пустые последовательности', () => {
    expect(diffSequences([], [])).toEqual([])
    expect(diffSequences(['a'], [])).toEqual([{ kind: 'removed', value: 'a' }])
    expect(diffSequences([], ['b'])).toEqual([{ kind: 'added', value: 'b' }])
  })

  it('длина общих элементов равна LCS', () => {
    const a = 'ABCBDAB'.split('')
    const b = 'BDCABA'.split('')
    const parts = diffSequences(a, b)
    expect(parts.filter((p) => p.kind === 'same')).toHaveLength(4)
    expect(parts.filter((p) => p.kind !== 'added').map((p) => p.value)).toEqual(a)
    expect(parts.filter((p) => p.kind !== 'removed').map((p) => p.value)).toEqual(b)
  })
})

describe('diffLines и diffWords', () => {
  it('заменённую строку показывает парой с отличиями по словам', () => {
    const changes = diffLines(
      ['Договор поставки', 'Цена 100 рублей', 'Подписи сторон'],
      ['Договор поставки', 'Цена 120 рублей', 'Подписи сторон', 'Приложение 1']
    )
    expect(changes).toEqual([
      { kind: 'same', text: 'Договор поставки' },
      {
        kind: 'changed',
        before: 'Цена 100 рублей',
        after: 'Цена 120 рублей',
        words: [
          { kind: 'same', value: 'Цена', space: false },
          { kind: 'removed', value: '100', space: true },
          { kind: 'added', value: '120', space: true },
          { kind: 'same', value: 'рублей', space: true }
        ]
      },
      { kind: 'same', text: 'Подписи сторон' },
      { kind: 'added', text: 'Приложение 1' }
    ])
    expect(hasTextChanges(changes)).toBe(true)
  })

  it('без изменений — только same', () => {
    const changes = diffLines(['a', 'b'], ['a', 'b'])
    expect(hasTextChanges(changes)).toBe(false)
  })

  it('удалённые строки сверх пары остаются удалёнными', () => {
    expect(diffLines(['x', 'y', 'z'], ['w'])).toEqual([
      { kind: 'changed', before: 'x', after: 'w', words: diffWords('x', 'w') },
      { kind: 'removed', text: 'y' },
      { kind: 'removed', text: 'z' }
    ])
  })

  it('слова разделяются любыми пробелами', () => {
    expect(diffWords('one  two\tthree', 'one three')).toEqual([
      { kind: 'same', value: 'one', space: false },
      { kind: 'removed', value: 'two', space: true },
      { kind: 'same', value: 'three', space: true }
    ])
  })

  it('слово со знаком препинания совпадает со словом без него (QA C12)', () => {
    const words = diffWords('Заполните анкету', 'Заполните анкету, проверьте данные')
    expect(words.filter((w) => w.kind === 'removed')).toEqual([])
    expect(words.map((w) => [w.kind, w.value, w.space])).toEqual([
      ['same', 'Заполните', false],
      ['same', 'анкету', true],
      ['added', ',', false],
      ['added', 'проверьте', true],
      ['added', 'данные', true]
    ])
    expect(isWord(',')).toBe(false)
    expect(isWord('данные')).toBe(true)
    // Числа и даты с точками и запятыми внутри — одно слово.
    expect(diffWords('до 30.12.2026 года', 'до 31.12.2026 года').map((w) => w.value)).toEqual([
      'до',
      '30.12.2026',
      '31.12.2026',
      'года'
    ])
  })
})

describe('linesFromPieces', () => {
  it('собирает строки по признаку конца строки и базовой линии', () => {
    const lines = linesFromPieces([
      { str: 'The quick ', y: 700 },
      { str: 'brown fox', y: 700, hasEOL: true },
      { str: '', y: 700 },
      { str: 'Second   line', y: 680 },
      { str: 'Third', y: 660 }
    ])
    expect(lines).toEqual(['The quick brown fox', 'Second line', 'Third'])
  })
})

describe('страницы', () => {
  it('сопоставляет страницы по номеру', () => {
    expect(pageRows(3, 5)).toBe(5)
    expect(presenceStatus(2, 3, 5)).toBeNull()
    expect(presenceStatus(4, 3, 5)).toBe('added')
    expect(presenceStatus(4, 5, 3)).toBe('removed')
    expect(isDifference('changed')).toBe(true)
    expect(isDifference('same')).toBe(false)
    expect(isDifference('pending')).toBe(false)
  })

  it('следующее отличие идёт по кругу', () => {
    expect(nextDifference([5, 2, 9], 2)).toBe(5)
    expect(nextDifference([5, 2, 9], 9)).toBe(2)
    expect(nextDifference([5, 2, 9], 0)).toBe(2)
    expect(nextDifference([], 1)).toBeNull()
  })

  it('первое нажатие не пропускает отличие на открытой странице (QA C12)', () => {
    expect(nextDifference([1, 2], 1, true)).toBe(1)
    expect(nextDifference([1, 2], 1)).toBe(2)
    expect(nextDifference([2, 5], 1, true)).toBe(2)
    expect(nextDifference([2, 5], 6, true)).toBe(2)
  })
})
