/**
 * Сравнение текста страниц: строки и слова через наибольшую общую
 * подпоследовательность (LCS). Строка, которую заменили другой, показывается
 * парой «было / стало» с отличиями по словам.
 */

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffPart<T> {
  kind: DiffKind
  value: T
}

/** Слово или знаки препинания строки; space — перед ним в строке был пробел. */
export interface WordPart extends DiffPart<string> {
  space: boolean
}

export type LineChange =
  | { kind: DiffKind; text: string }
  | { kind: 'changed'; before: string; after: string; words: WordPart[] }

/** Предел таблицы LCS: дальше середина считается заменённой целиком. */
const MAX_CELLS = 4_000_000

/**
 * Разница двух последовательностей: общие элементы — same, лишние в a —
 * removed, новые в b — added. Удалённое идёт раньше добавленного на том же месте.
 */
export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean = Object.is
): DiffPart<T>[] {
  let head = 0
  while (head < a.length && head < b.length && equal(a[head] as T, b[head] as T)) head += 1
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    equal(a[a.length - 1 - tail] as T, b[b.length - 1 - tail] as T)
  ) {
    tail += 1
  }
  const same = (value: T): DiffPart<T> => ({ kind: 'same', value })
  const out: DiffPart<T>[] = a.slice(0, head).map(same)
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const n = midA.length
  const m = midB.length

  if (n * m > MAX_CELLS) {
    for (const value of midA) out.push({ kind: 'removed', value })
    for (const value of midB) out.push({ kind: 'added', value })
  } else if (n > 0 || m > 0) {
    // lcs[i][j] — длина LCS суффиксов midA[i..] и midB[j..].
    const w = m + 1
    const lcs = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * w + j] = equal(midA[i] as T, midB[j] as T)
          ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && equal(midA[i] as T, midB[j] as T)) {
        out.push(same(midA[i] as T))
        i += 1
        j += 1
      } else if (j >= m || (i < n && (lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))) {
        out.push({ kind: 'removed', value: midA[i] as T })
        i += 1
      } else {
        out.push({ kind: 'added', value: midB[j] as T })
        j += 1
      }
    }
  }
  for (const value of a.slice(a.length - tail)) out.push(same(value))
  return out
}

export function splitWords(line: string): string[] {
  return line.split(/\s+/).filter((word) => word.length > 0)
}

interface Token {
  text: string
  space: boolean
}

/**
 * Слова и знаки препинания строки. Знаки у слова — отдельные части, чтобы
 * «анкету» и «анкету,» совпали словом, а запятая считалась добавленной.
 * Точка, запятая, дефис и апостроф между буквами или цифрами остаются в
 * слове: «30.12.2026», «1,5», «какой-то».
 */
function tokenize(line: string): Token[] {
  const out: Token[] = []
  const re = /[\p{L}\p{N}]+(?:[.,'’/-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]+/gu
  let end = 0
  for (const match of line.matchAll(re)) {
    const start = match.index
    out.push({ text: match[0], space: start > end && /\s/.test(line.slice(end, start)) })
    end = start + match[0].length
  }
  return out
}

/** Часть строки — слово (есть буква или цифра), а не только знаки препинания. */
export function isWord(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

export function diffWords(before: string, after: string): WordPart[] {
  const parts = diffSequences(tokenize(before), tokenize(after), (x, y) => x.text === y.text)
  return parts.map((part) => ({ kind: part.kind, value: part.value.text, space: part.value.space }))
}

/**
 * Построчная разница. Подряд идущие удалённые и добавленные строки
 * сопоставляются попарно как изменённые, остаток остаётся удалённым или добавленным.
 */
export function diffLines(a: readonly string[], b: readonly string[]): LineChange[] {
  const parts = diffSequences(a, b)
  const out: LineChange[] = []
  let removed: string[] = []
  let added: string[] = []
  const flush = (): void => {
    const pairs = Math.min(removed.length, added.length)
    for (let k = 0; k < pairs; k += 1) {
      const before = removed[k] ?? ''
      const after = added[k] ?? ''
      out.push({ kind: 'changed', before, after, words: diffWords(before, after) })
    }
    for (const text of removed.slice(pairs)) out.push({ kind: 'removed', text })
    for (const text of added.slice(pairs)) out.push({ kind: 'added', text })
    removed = []
    added = []
  }
  for (const part of parts) {
    if (part.kind === 'removed') removed.push(part.value)
    else if (part.kind === 'added') added.push(part.value)
    else {
      flush()
      out.push({ kind: 'same', text: part.value })
    }
  }
  flush()
  return out
}

export function hasTextChanges(changes: readonly LineChange[]): boolean {
  return changes.some((change) => change.kind !== 'same')
}

/** Фрагмент текстового слоя: строка, признак конца строки и базовая линия, пт. */
export interface TextPiece {
  str: string
  hasEOL?: boolean | undefined
  y?: number | undefined
}

export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

/**
 * Строки страницы из фрагментов текстового слоя: новая строка — после
 * признака конца строки или при смене базовой линии больше чем на tolerance пт.
 * Пустые строки отбрасываются, пробелы схлопываются.
 */
export function linesFromPieces(pieces: readonly TextPiece[], tolerance = 2): string[] {
  const lines: string[] = []
  let current = ''
  let baseline: number | null = null
  const push = (): void => {
    const line = normalizeLine(current)
    if (line.length > 0) lines.push(line)
    current = ''
  }
  for (const piece of pieces) {
    if (piece.y !== undefined) {
      if (baseline !== null && Math.abs(piece.y - baseline) > tolerance) push()
      baseline = piece.y
    }
    current += piece.str
    if (piece.hasEOL) push()
  }
  push()
  return lines
}
