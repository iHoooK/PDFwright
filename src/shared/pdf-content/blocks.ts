import { sameFamily } from './to-unicode'
import type { PageTextBlock, PageTextLine, PdfSpacePoint, PdfSpaceRect, RgbColor } from './types'

/**
 * Абзацы страницы из строк: строка присоединяется к абзацу, если у неё тот
 * же шрифт, кегль, цвет и направление, тот же левый край, и она стоит прямо
 * под последней строкой абзаца с тем же шагом, что и предыдущие. Всё
 * считается в системе строки (вдоль письма и поперёк), поэтому работает и на
 * повёрнутых страницах.
 */

const BULLET = /^\s*([-•–—*·▪●○■□►‣]|\d{1,2}[.)])\s/

function dot(a: PdfSpacePoint, b: PdfSpacePoint): number {
  return a.x * b.x + a.y * b.y
}

/** Нормаль к направлению письма — «вверх» относительно текста. */
function normalOf(d: PdfSpacePoint): PdfSpacePoint {
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
function extentAlong(rect: PdfSpaceRect, d: PdfSpacePoint): [number, number] {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ].map((p) => dot(p, d))
  return [Math.min(...corners), Math.max(...corners)]
}

interface Draft {
  lines: PageTextLine[]
  gap: number | null
}

function fits(draft: Draft, line: PageTextLine): boolean {
  const last = draft.lines[draft.lines.length - 1]
  const first = draft.lines[0]
  if (!last || !first) return false
  const d = first.direction
  if (Math.abs(d.x - line.direction.x) > 1e-3 || Math.abs(d.y - line.direction.y) > 1e-3)
    return false
  if (!sameFamily(first.fontName, line.fontName) || first.bold !== line.bold) return false
  if (Math.abs(first.fontSize - line.fontSize) > 0.05 * first.fontSize) return false
  if (!sameColor(first.color, line.color)) return false
  const size = first.fontSize
  const start = dot(first.origin, d)
  if (Math.abs(dot(line.origin, d) - start) > Math.max(1.5, 0.2 * size)) return false
  const n = normalOf(d)
  const gap = dot(last.origin, n) - dot(line.origin, n)
  if (gap < 0.9 * size || gap > 1.9 * size) return false
  return draft.gap === null || Math.abs(gap - draft.gap) <= 0.15 * size
}

/** Разрыв перед строкой next: новый пункт списка или короткая предыдущая строка. */
function hardBreak(
  prev: PageTextLine,
  next: PageTextLine,
  width: number,
  d: PdfSpacePoint
): boolean {
  if (BULLET.test(next.text)) return true
  const [a, b] = extentAlong(prev.rect, d)
  return b - a < 0.7 * width && /[.:;!?)»"]\s*$/.test(prev.text)
}

export function groupBlocks(lines: readonly PageTextLine[]): PageTextBlock[] {
  const drafts: Draft[] = []
  for (const line of lines) {
    // Ищем абзац, последняя строка которого стоит прямо над этой.
    const target = drafts.find((draft) => fits(draft, line))
    if (target) {
      const last = target.lines[target.lines.length - 1]
      if (last && target.gap === null) {
        const n = normalOf(line.direction)
        target.gap = dot(last.origin, n) - dot(line.origin, n)
      }
      target.lines.push(line)
    } else {
      drafts.push({ lines: [line], gap: null })
    }
  }
  return drafts.flatMap((draft, index) => {
    const [first, ...rest] = draft.lines
    if (!first) return []
    const d = first.direction
    const rect = draft.lines.reduce((acc, l) => union(acc, l.rect), first.rect)
    const start = dot(first.origin, d)
    const width = Math.max(...draft.lines.map((l) => extentAlong(l.rect, d)[1] - start))
    let text = first.text.trim()
    let prev = first
    for (const next of rest) {
      text += (hardBreak(prev, next, width, d) ? '\n' : ' ') + next.text.trim()
      prev = next
    }
    const block: PageTextBlock = {
      kind: 'block',
      index,
      text,
      rect,
      origin: first.origin,
      direction: d,
      width,
      lineHeight: draft.gap ?? first.fontSize * 1.4,
      lines: draft.lines.map((l) => l.index),
      refs: draft.lines.map((l) => ({ text: l.text, rect: l.rect })),
      style: {
        fontName: first.fontName,
        fontSize: first.fontSize,
        color: first.color,
        bold: first.bold,
        italic: first.italic
      }
    }
    return [block]
  })
}
