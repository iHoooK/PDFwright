/**
 * Геометрия разметки. Все объекты хранятся в пользовательском пространстве
 * страницы PDF (пункты, ось Y вверх, начало — как у MediaBox). На экран их
 * переводит та же матрица, что строит pdf.js для PageViewport, поэтому
 * разметка совпадает с растром при любом масштабе, повороте вида и
 * собственном повороте страницы (/Rotate).
 */

export interface Point {
  x: number
  y: number
}

/** Прямоугольник с осями, параллельными осям системы координат; x, y — левый нижний угол в PDF. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type QuarterTurn = 0 | 90 | 180 | 270

/** Аффинная матрица в порядке PDF: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Видимая область страницы в пользовательском пространстве: [x0, y0, x1, y1] (pdf.js `page.view`). */
export type PageBox = readonly [number, number, number, number]

export interface PageGeometry {
  box: PageBox
  /** Собственный поворот страницы (/Rotate), по часовой стрелке. */
  rotate: QuarterTurn
}

export function normalizeTurn(degrees: number): QuarterTurn {
  const value = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360
  return value as QuarterTurn
}

/** Произведение матриц: сначала применяется first, затем second. */
export function multiply(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first
  const [a2, b2, c2, d2, e2, f2] = second
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2
  ]
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (det === 0) throw new Error('Матрица вырождена')
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

/**
 * Матрица «пространство страницы → CSS-пиксели вида» — повторяет конструктор
 * PageViewport из pdf.js: rotation — полный поворот (страница + вид), scale —
 * CSS-пикселей на пункт.
 */
export function viewMatrix(box: PageBox, rotation: number, scale: number): Matrix {
  const [x0, y0, x1, y1] = box
  const centerX = (x0 + x1) / 2
  const centerY = (y0 + y1) / 2
  let ra: number, rb: number, rc: number, rd: number
  switch (normalizeTurn(rotation)) {
    case 90:
      ;[ra, rb, rc, rd] = [0, 1, 1, 0]
      break
    case 180:
      ;[ra, rb, rc, rd] = [-1, 0, 0, 1]
      break
    case 270:
      ;[ra, rb, rc, rd] = [0, -1, -1, 0]
      break
    default:
      ;[ra, rb, rc, rd] = [1, 0, 0, -1]
  }
  const offsetX = ra === 0 ? Math.abs(centerY - y0) * scale : Math.abs(centerX - x0) * scale
  const offsetY = ra === 0 ? Math.abs(centerX - x0) * scale : Math.abs(centerY - y0) * scale
  return [
    ra * scale,
    rb * scale,
    rc * scale,
    rd * scale,
    offsetX - ra * scale * centerX - rc * scale * centerY,
    offsetY - rb * scale * centerX - rd * scale * centerY
  ]
}

/** Размер вида страницы в CSS-пикселях. */
export function viewSize(
  box: PageBox,
  rotation: number,
  scale: number
): {
  width: number
  height: number
} {
  const w = (box[2] - box[0]) * scale
  const h = (box[3] - box[1]) * scale
  const turn = normalizeTurn(rotation)
  return turn === 90 || turn === 270 ? { width: h, height: w } : { width: w, height: h }
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

export function rectCorners(r: Rect): [Point, Point, Point, Point] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height }
  ]
}

/** Образ прямоугольника под матрицей (для поворотов на 90° — снова прямоугольник). */
export function transformRect(m: Matrix, r: Rect): Rect {
  return boundsOfPoints(rectCorners(r).map((p) => apply(m, p)))
}

export function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function unionRects(rects: readonly Rect[]): Rect {
  return boundsOfPoints(rects.flatMap((r) => rectCorners(r)))
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 }
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Аффинное отображение прямоугольника from в прямоугольник to (масштаб по осям и сдвиг). */
export function rectToRectMatrix(from: Rect, to: Rect): Matrix {
  const sx = from.width === 0 ? 1 : to.width / from.width
  const sy = from.height === 0 ? 1 : to.height / from.height
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy]
}

/**
 * Матрица содержимого «коробки» (текст, картинка): локальные координаты
 * u вправо и v вниз от верхнего левого угла содержимого — в пространство
 * страницы. rotate — полный поворот вида, под который содержимое выпрямлено:
 * при /Rotate 90 текст пишется так, чтобы на экране он стоял ровно.
 */
export function boxContentMatrix(rect: Rect, rotate: QuarterTurn): Matrix {
  const { x, y, width: w, height: h } = rect
  switch (rotate) {
    case 90:
      return [0, 1, 1, 0, x, y]
    case 180:
      return [-1, 0, 0, 1, x + w, y]
    case 270:
      return [0, -1, -1, 0, x + w, y + h]
    default:
      return [1, 0, 0, -1, x, y + h]
  }
}

/** Размер содержимого коробки без поворота: ширина и высота «как читается». */
export function boxContentSize(rect: Rect, rotate: QuarterTurn): { width: number; height: number } {
  return rotate === 90 || rotate === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height }
}

/**
 * Прямоугольник коробки нового размера содержимого с тем же верхним левым
 * углом (точкой начала текста) — например, когда текст стал длиннее.
 */
export function resizeBoxKeepingOrigin(
  rect: Rect,
  rotate: QuarterTurn,
  width: number,
  height: number
): Rect {
  const origin = apply(boxContentMatrix(rect, rotate), { x: 0, y: 0 })
  const probe: Rect =
    rotate === 90 || rotate === 270
      ? { x: 0, y: 0, width: height, height: width }
      : { x: 0, y: 0, width, height }
  const probeOrigin = apply(boxContentMatrix(probe, rotate), { x: 0, y: 0 })
  return { ...probe, x: origin.x - probeOrigin.x, y: origin.y - probeOrigin.y }
}

/**
 * Склейка прямоугольников выделения текста в строки: прямоугольники одной
 * строки (перекрытие по вертикали больше половины меньшей высоты) с
 * небольшим зазором объединяются. Вход и выход — в пространстве страницы.
 */
export function mergeLineRects(rects: readonly Rect[]): Rect[] {
  const sorted = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => b.y + b.height - (a.y + a.height) || a.x - b.x)
  const lines: Rect[] = []
  for (const rect of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.y + l.height, rect.y + rect.height) - Math.max(l.y, rect.y)
      if (overlap <= Math.min(l.height, rect.height) * 0.5) return false
      const gap = Math.max(rect.x - (l.x + l.width), l.x - (rect.x + rect.width))
      return gap <= Math.max(l.height, rect.height) * 0.8
    })
    if (line) Object.assign(line, unionRects([line, rect]))
    else lines.push({ ...rect })
  }
  return lines
}

/** Упрощение ломаной (Рамер — Дуглас — Пекер): убирает точки, отклоняющиеся меньше tolerance. */
export function simplifyPath(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop() ?? [0, 0]
    const a = points[from]
    const b = points[to]
    if (!a || !b) continue
    let index = -1
    let max = tolerance
    for (let i = from + 1; i < to; i += 1) {
      const p = points[i]
      if (!p) continue
      const d = distanceToSegment(p, a, b)
      if (d > max) {
        max = d
        index = i
      }
    }
    if (index !== -1) {
      keep[index] = true
      stack.push([from, index], [index, to])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Наконечник стрелки: две точки «усов» у конца to. Длина зависит от толщины линии. */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point] {
  const length = Math.max(8, width * 4)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const spread = (28 * Math.PI) / 180
  const wing = (sign: number): Point => ({
    x: to.x - length * Math.cos(angle + sign * spread),
    y: to.y - length * Math.sin(angle + sign * spread)
  })
  return [wing(1), wing(-1)]
}

/** Отрезки подчёркивания или зачёркивания для прямоугольника строки. */
export function textLineStroke(
  rect: Rect,
  kind: 'underline' | 'strikeout'
): { from: Point; to: Point; width: number } {
  const width = Math.max(0.6, rect.height * 0.07)
  const y = kind === 'underline' ? rect.y + width : rect.y + rect.height * 0.42
  return { from: { x: rect.x, y }, to: { x: rect.x + rect.width, y }, width }
}

/** Цвет #rrggbb в компоненты 0..1; неверная строка даёт чёрный. */
export function parseHexColor(color: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!match?.[1]) return [0, 0, 0]
  const value = Number.parseInt(match[1], 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** Прямоугольник коробки с содержимым width × height (как читается) и центром в точке center. */
export function boxRectCentered(
  center: Point,
  width: number,
  height: number,
  rotate: QuarterTurn
): Rect {
  const sideways = rotate === 90 || rotate === 270
  const w = sideways ? height : width
  const h = sideways ? width : height
  return { x: center.x - w / 2, y: center.y - h / 2, width: w, height: h }
}
