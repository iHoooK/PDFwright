import { sameFamily } from './to-unicode'
import type {
  PageTextBlock,
  PageTextLine,
  PdfSpacePoint,
  PdfSpaceRect,
  RgbColor,
  TextStyle
} from './types'

/**
 * Абзацы страницы. Сначала из отрезков (частей строк одного стиля) собираются
 * строки: отрезки на одной базовой линии, идущие вплотную, — одна строка, даже
 * если среди них жирное слово или другой цвет. Затем строка присоединяется к
 * абзацу, если у неё тот же кегль и направление, тот же левый край и она
 * стоит прямо под последней строкой абзаца с тем же шагом. Всё считается в
 * системе строки (вдоль письма и поперёк), поэтому работает и на повёрнутых
 * страницах.
 */

const BULLET = /^\s*([-•–—*·▪●○■□►‣]|\d{1,2}[.)])\s/

export function dot(a: PdfSpacePoint, b: PdfSpacePoint): number {
  return a.x * b.x + a.y * b.y
}

/** Нормаль к направлению письма — «вверх» относительно текста. */
export function normalOf(d: PdfSpacePoint): PdfSpacePoint {
  return { x: -d.y, y: d.x }
}

function sameColor(a: RgbColor, b: RgbColor): boolean {
  return a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.02)
}

function union(a: PdfSpaceRect, b: PdfSpaceRect): PdfSpaceRect {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.width, b.x + b.width)
  const y1 = Math.max(a.y + a.height, b.y + b.height)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Протяжённость рамки вдоль направления d: [начало, конец]. */
export function extentAlong(rect: PdfSpaceRect, d: PdfSpacePoint): [number, number] {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ].map((p) => dot(p, d))
  return [Math.min(...corners), Math.max(...corners)]
}

function sameDirection(a: PdfSpacePoint, b: PdfSpacePoint): boolean {
  return Math.abs(a.x - b.x) <= 1e-3 && Math.abs(a.y - b.y) <= 1e-3
}

function styleOf(line: PageTextLine): TextStyle {
  return {
    fontName: line.fontName,
    fontSize: line.fontSize,
    color: line.color,
    bold: line.bold,
    italic: line.italic
  }
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    sameFamily(a.fontName, b.fontName) &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    Math.abs(a.fontSize - b.fontSize) <= 0.05 * a.fontSize &&
    sameColor(a.color, b.color)
  )
}

/** Строка абзаца: отрезки одной базовой линии и её текст с отрезком каждой буквы. */
export interface TextRow {
  readonly segments: readonly PageTextLine[]
  readonly direction: PdfSpacePoint
  readonly origin: PdfSpacePoint
  readonly rect: PdfSpaceRect
  /** Начало и конец строки вдоль письма. */
  readonly start: number
  readonly end: number
  /** Кегль и стиль большинства букв. */
  readonly size: number
  readonly style: TextStyle
  readonly text: string
  /** Для каждой буквы text — индекс отрезка в segments. */
  readonly owners: readonly number[]
}

interface RowDraft {
  segments: PageTextLine[]
}

/** Строки из отрезков: та же базовая линия и зазор не больше обычного пробела. */
export function buildRows(lines: readonly PageTextLine[]): TextRow[] {
  const drafts: RowDraft[] = []
  for (const line of lines) {
    if (line.text.trim() === '') continue
    const d = line.direction
    const n = normalOf(d)
    const target = drafts.find((draft) => {
      const last = draft.segments[draft.segments.length - 1]
      if (!last || !sameDirection(last.direction, d)) return false
      const size = Math.max(last.fontSize, line.fontSize)
      if (Math.abs(dot(last.origin, n) - dot(line.origin, n)) > 0.25 * size) return false
      const lastEnd = extentAlong(last.rect, d)[1]
      const start = dot(line.origin, d)
      return start >= lastEnd - 0.5 * size && start - lastEnd <= 0.6 * size
    })
    if (target) target.segments.push(line)
    else drafts.push({ segments: [line] })
  }
  return drafts.flatMap((draft): TextRow[] => {
    const segments = draft.segments
    const first = segments[0]
    if (!first) return []
    const d = first.direction
    let text = ''
    const owners: number[] = []
    segments.forEach((segment, i) => {
      const prev = segments[i - 1]
      if (prev) {
        const gap = dot(segment.origin, d) - extentAlong(prev.rect, d)[1]
        const spaced = /\s$/.test(text) || /^\s/.test(segment.text)
        if (!spaced && gap > 0.15 * Math.max(prev.fontSize, segment.fontSize)) {
          text += ' '
          owners.push(i - 1)
        }
      }
      for (const char of Array.from(segment.text)) {
        text += char
        owners.push(i)
      }
    })
    // Пробелы по краям строки не нужны: обрезаем текст вместе с владельцами.
    const chars = Array.from(text)
    let a = 0
    let b = chars.length
    while (a < b && /\s/.test(chars[a] ?? '')) a += 1
    while (b > a && /\s/.test(chars[b - 1] ?? '')) b -= 1
    const counts = new Map<number, number>()
    for (let k = a; k < b; k += 1) {
      if (/\s/.test(chars[k] ?? '')) continue
      const owner = owners[k] ?? 0
      counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    let main = 0
    for (const [owner, count] of counts) if (count > (counts.get(main) ?? 0)) main = owner
    const dominant = segments[main] ?? first
    const rect = segments.reduce((acc, s) => union(acc, s.rect), first.rect)
    const [, end] = extentAlong(rect, d)
    return [
      {
        segments,
        direction: d,
        origin: first.origin,
        rect,
        start: dot(first.origin, d),
        end,
        size: dominant.fontSize,
        style: styleOf(dominant),
        text: chars.slice(a, b).join(''),
        owners: owners.slice(a, b)
      }
    ]
  })
}

interface Draft {
  rows: TextRow[]
  gap: number | null
}

function fits(draft: Draft, row: TextRow): boolean {
  const last = draft.rows[draft.rows.length - 1]
  const first = draft.rows[0]
  if (!last || !first) return false
  const d = first.direction
  if (!sameDirection(d, row.direction)) return false
  const size = first.size
  if (Math.abs(first.size - row.size) > 0.05 * size) return false
  if (Math.abs(row.start - first.start) > Math.max(1.5, 0.2 * size)) return false
  const n = normalOf(d)
  const gap = dot(last.origin, n) - dot(row.origin, n)
  if (gap < 0.9 * size || gap > 1.9 * size) return false
  return draft.gap === null || Math.abs(gap - draft.gap) <= 0.15 * size
}

/**
 * Разрыв перед строкой next: новый пункт списка, короткая предыдущая строка
 * с концом предложения или смена основного стиля (заголовок над абзацем).
 */
function hardBreak(prev: TextRow, next: TextRow, width: number): boolean {
  if (BULLET.test(next.text)) return true
  if (!sameStyle(prev.style, next.style)) return true
  return prev.end - prev.start < 0.7 * width && /[.:;!?)»"]\s*$/.test(prev.text)
}

/** Абзац с раскладкой по строкам — для движка (стили букв, выключка). */
export interface BlockLayout {
  readonly rows: readonly TextRow[]
  /** Конец абзаца после строки i (явный разрыв или последняя строка). */
  readonly breaks: readonly boolean[]
  readonly text: string
  /** Для каждой буквы text — [строка, буква строки] или null для разделителя. */
  readonly sources: readonly ([number, number] | null)[]
  readonly origin: PdfSpacePoint
  readonly direction: PdfSpacePoint
  readonly width: number
  readonly lineHeight: number
  readonly justified: boolean
  readonly rect: PdfSpaceRect
  readonly style: TextStyle
}

export function layoutBlocks(lines: readonly PageTextLine[]): BlockLayout[] {
  const drafts: Draft[] = []
  for (const row of buildRows(lines)) {
    // Ищем абзац, последняя строка которого стоит прямо над этой.
    const target = drafts.find((draft) => fits(draft, row))
    if (target) {
      const last = target.rows[target.rows.length - 1]
      if (last && target.gap === null) {
        const n = normalOf(row.direction)
        target.gap = dot(last.origin, n) - dot(row.origin, n)
      }
      target.rows.push(row)
    } else {
      drafts.push({ rows: [row], gap: null })
    }
  }
  return drafts.flatMap((draft) => {
    const rows = draft.rows
    const first = rows[0]
    if (!first) return []
    const width = Math.max(...rows.map((r) => r.end - first.start))
    const breaks = rows.map((row, i) => {
      const next = rows[i + 1]
      return !next || hardBreak(row, next, width)
    })
    let text = ''
    const sources: ([number, number] | null)[] = []
    rows.forEach((row, i) => {
      if (i > 0) {
        text += breaks[i - 1] ? '\n' : ' '
        sources.push(null)
      }
      Array.from(row.text).forEach((char, k) => {
        text += char
        sources.push([i, k])
      })
    })
    // Выключка: строки внутри абзацев (не последние) доходят до правого края.
    const inner = rows.filter((_, i) => !breaks[i])
    const right = first.start + width
    const justified = inner.length >= 2 && inner.every((r) => right - r.end <= 1.5)
    // Основной стиль абзаца — у строк с большинством букв.
    const weights = new Map<TextRow, number>()
    for (const row of rows) weights.set(row, Array.from(row.text).length)
    const main = rows.reduce((best, row) =>
      (weights.get(row) ?? 0) > (weights.get(best) ?? 0) ? row : best
    )
    return [
      {
        rows,
        breaks,
        text,
        sources,
        origin: first.origin,
        direction: first.direction,
        width,
        lineHeight: draft.gap ?? first.size * 1.4,
        justified,
        rect: rows.reduce((acc, r) => union(acc, r.rect), first.rect),
        style: main.style
      }
    ]
  })
}

export function groupBlocks(lines: readonly PageTextLine[]): PageTextBlock[] {
  return layoutBlocks(lines).map((layout, index) => {
    const segments = layout.rows.flatMap((row) => row.segments)
    return {
      kind: 'block',
      index,
      text: layout.text,
      rect: layout.rect,
      origin: layout.origin,
      direction: layout.direction,
      width: layout.width,
      lineHeight: layout.lineHeight,
      lines: segments.map((l) => l.index),
      refs: segments.map((l) => ({ text: l.text, rect: l.rect })),
      style: layout.style
    }
  })
}
