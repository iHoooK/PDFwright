import type { PdfSpacePoint, PdfSpaceRect } from './types'

/**
 * Геометрия в соглашениях PDF и MuPDF: матрица [a b c d e f] умножается на
 * вектор-строку, x' = a·x + c·y + e, y' = b·x + d·y + f; concat(m, n) — сначала m, потом n.
 * Прямоугольник MuPDF — [x0, y0, x1, y1].
 */

export type Matrix = [number, number, number, number, number, number]
export type BoxRect = [number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function concat(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5]
  ]
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return [...IDENTITY]
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -m[4] * a - m[5] * c, -m[4] * b - m[5] * d]
}

export function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Поворот и масштаб без сдвига: для векторов направления. */
export function transformVector(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]
}

/** Описанный прямоугольник после преобразования всех четырёх углов. */
export function transformBox(m: Matrix, box: BoxRect): BoxRect {
  const corners = [
    transformPoint(m, box[0], box[1]),
    transformPoint(m, box[2], box[1]),
    transformPoint(m, box[0], box[3]),
    transformPoint(m, box[2], box[3])
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function boxToRect(box: BoxRect): PdfSpaceRect {
  return { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] }
}

export function rectToBox(rect: PdfSpaceRect): BoxRect {
  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]
}

export function normalizeVector(x: number, y: number): PdfSpacePoint {
  const length = Math.hypot(x, y)
  return length > 0 ? { x: x / length, y: y / length } : { x: 1, y: 0 }
}

/** Наибольшее расхождение координат двух прямоугольников. */
export function rectDistance(a: PdfSpaceRect, b: PdfSpaceRect): number {
  const p = rectToBox(a)
  const q = rectToBox(b)
  return Math.max(...p.map((v, i) => Math.abs(v - (q[i] ?? 0))))
}

/** Матрица, переводящая прямоугольник from в прямоугольник to (оба в одном пространстве). */
export function rectToRectMatrix(from: BoxRect, to: BoxRect): Matrix {
  const sx = (to[2] - to[0]) / (from[2] - from[0] || 1)
  const sy = (to[3] - to[1]) / (from[3] - from[1] || 1)
  return [sx, 0, 0, sy, to[0] - from[0] * sx, to[1] - from[1] * sy]
}

/** Вписывает содержимое с пропорциями width:height в прямоугольник по центру. */
export function fitContain(box: BoxRect, width: number, height: number): BoxRect {
  const boxWidth = box[2] - box[0]
  const boxHeight = box[3] - box[1]
  const scale = Math.min(boxWidth / width, boxHeight / height)
  const w = width * scale
  const h = height * scale
  const x = box[0] + (boxWidth - w) / 2
  const y = box[1] + (boxHeight - h) / 2
  return [x, y, x + w, y + h]
}

export function isValidRect(rect: PdfSpaceRect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

/** Число для потока содержимого PDF: без экспоненты и лишних нулей. */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(4).replace(/\.?0+$/, '')
  return fixed === '-0' ? '0' : fixed
}
