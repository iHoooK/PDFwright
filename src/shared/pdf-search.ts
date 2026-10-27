/**
 * Поиск по тексту страницы. pdf.js отдаёт текст как список фрагментов
 * (`TextItem.str`), каждому соответствует свой span в текстовом слое.
 * Совпадение может пересекать границы фрагментов, поэтому результат —
 * список кусков `{item, start, end}` по фрагментам.
 */

export interface MatchPiece {
  /** Индекс фрагмента текста (и span в текстовом слое). */
  item: number
  start: number
  end: number
}

export interface TextMatch {
  pieces: MatchPiece[]
  /** Короткий контекст для списка результатов. */
  snippet: string
}

const SNIPPET_RADIUS = 28

export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ')
}

/**
 * breaks[i] — после фрагмента i конец строки (`hasEOL` у pdf.js). Там в
 * склеенный текст встаёт пробел: слова соседних строк не слипаются ни
 * в контексте результата, ни в самом поиске. Этого пробела нет ни в одном
 * фрагменте, поэтому подсветка его пропускает.
 */
export function findMatches(
  items: readonly string[],
  rawQuery: string,
  breaks: readonly boolean[] = []
): TextMatch[] {
  const query = normalizeQuery(rawQuery)
  if (query.length === 0) return []

  // Склеиваем фрагменты и запоминаем, где начинается каждый.
  const offsets: number[] = []
  let joined = ''
  items.forEach((item, index) => {
    offsets.push(joined.length)
    joined += item
    const next = items[index + 1]
    if (breaks[index] === true && next !== undefined && !/\s$/.test(joined) && !/^\s/.test(next)) {
      joined += ' '
    }
  })
  const haystack = joined.toLocaleLowerCase('ru')
  if (haystack.length !== joined.length) return findMatchesSlow(items, query)

  const matches: TextMatch[] = []
  let from = 0
  while (from <= haystack.length - query.length) {
    const at = haystack.indexOf(query, from)
    if (at === -1) break
    matches.push({
      pieces: toPieces(offsets, items, at, at + query.length),
      snippet: snippet(joined, at, at + query.length)
    })
    from = at + Math.max(1, query.length)
  }
  return matches
}

/** Запасной путь, если приведение к нижнему регистру меняет длину строки (редкие символы). */
function findMatchesSlow(items: readonly string[], query: string): TextMatch[] {
  const matches: TextMatch[] = []
  items.forEach((item, index) => {
    const lower = item.toLocaleLowerCase('ru')
    if (lower.length !== item.length) return
    let from = 0
    while (from <= lower.length - query.length) {
      const at = lower.indexOf(query, from)
      if (at === -1) break
      matches.push({
        pieces: [{ item: index, start: at, end: at + query.length }],
        snippet: snippet(item, at, at + query.length)
      })
      from = at + Math.max(1, query.length)
    }
  })
  return matches
}

function toPieces(
  offsets: readonly number[],
  items: readonly string[],
  start: number,
  end: number
): MatchPiece[] {
  const pieces: MatchPiece[] = []
  for (let index = 0; index < items.length; index += 1) {
    const itemStart = offsets[index] ?? 0
    const itemEnd = itemStart + (items[index]?.length ?? 0)
    if (itemEnd <= start || itemStart >= end) continue
    pieces.push({
      item: index,
      start: Math.max(start, itemStart) - itemStart,
      end: Math.min(end, itemEnd) - itemStart
    })
  }
  return pieces
}

function snippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_RADIUS)
  const to = Math.min(text.length, end + SNIPPET_RADIUS)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`
}

export interface Segment {
  text: string
  mark: 'none' | 'match' | 'active'
}

/**
 * Режет текст фрагмента на сегменты по диапазонам подсветки.
 * Диапазоны могут перекрываться; активный приоритетнее обычного.
 */
export function segmentItem(
  text: string,
  ranges: readonly { start: number; end: number; active: boolean }[]
): Segment[] {
  if (ranges.length === 0) return [{ text, mark: 'none' }]
  const marks: ('none' | 'match' | 'active')[] = new Array<'none' | 'match' | 'active'>(
    text.length
  ).fill('none')
  for (const range of ranges) {
    for (let i = Math.max(0, range.start); i < Math.min(text.length, range.end); i += 1) {
      if (range.active || marks[i] === 'none') marks[i] = range.active ? 'active' : 'match'
    }
  }
  const segments: Segment[] = []
  for (let i = 0; i < text.length; i += 1) {
    const mark = marks[i] ?? 'none'
    const char = text[i] ?? ''
    const last = segments[segments.length - 1]
    if (last?.mark === mark) last.text += char
    else segments.push({ text: char, mark })
  }
  return segments
}
