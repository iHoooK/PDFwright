import {
  apply,
  arrowHead,
  boundsOfPoints,
  containsPoint,
  distanceToSegment,
  inflate,
  rectToRectMatrix,
  transformRect,
  unionRects,
  type Matrix,
  type Point,
  type QuarterTurn,
  type Rect
} from './geometry'

/**
 * Объекты разметки, добавленные пользователем поверх страницы. Пока документ
 * не сохранён, они живут в состоянии вкладки и рисуются overlay-слоем; при
 * сохранении `applyMarkup` (src/shared/pdf-ops/markup.ts) записывает их в PDF
 * аннотациями или впечатывает в содержимое страницы. Координаты — в пунктах
 * пространства страницы (см. geometry.ts), страницы нумеруются с 1.
 */

export type TextMarkKind = 'highlight' | 'underline' | 'strikeout'
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'

interface MarkupBase {
  id: string
  page: number
  /** #rrggbb */
  color: string
  /** 0..1 */
  opacity: number
}

export interface TextMarkObject extends MarkupBase {
  kind: TextMarkKind
  /** Прямоугольники строк выделенного текста. */
  rects: Rect[]
}

export interface InkObject extends MarkupBase {
  kind: 'ink'
  paths: Point[][]
  width: number
}

export interface BoxShapeObject extends MarkupBase {
  kind: 'rect' | 'ellipse'
  /** Осевая линия контура. */
  rect: Rect
  width: number
}

export interface LineObject extends MarkupBase {
  kind: 'line' | 'arrow'
  from: Point
  to: Point
  width: number
}

export interface TextObject extends MarkupBase {
  kind: 'text'
  rect: Rect
  /**
   * Под какой поворот выпрямлен текст: /Rotate страницы плюс поворот вида в
   * момент создания (см. boxContentMatrix) — текст стоит ровно там, где его писали.
   */
  rotate: QuarterTurn
  text: string
  fontSize: number
  /**
   * Ширину рамки задал пользователь (потянул за ручку): строки переносятся по
   * словам внутри неё. Без признака (по умолчанию) блок растёт по тексту.
   */
  fixedWidth?: boolean
}

export interface ImageObject extends MarkupBase {
  kind: 'image'
  rect: Rect
  rotate: QuarterTurn
  /** data:image/png;base64,… или data:image/jpeg;base64,… */
  src: string
  /** Подпись из библиотеки: в панели свойств называется «Подпись». */
  signature: boolean
}

export type MarkupObject =
  TextMarkObject | InkObject | BoxShapeObject | LineObject | TextObject | ImageObject

export type MarkupKind = MarkupObject['kind']

export const MIN_OBJECT_SIZE = 4

export function isTextMark(o: MarkupObject): o is TextMarkObject {
  return o.kind === 'highlight' || o.kind === 'underline' || o.kind === 'strikeout'
}

export function isBoxObject(o: MarkupObject): o is TextObject | ImageObject {
  return o.kind === 'text' || o.kind === 'image'
}

/** Можно ли объект двигать и тянуть за ручки (пометки текста привязаны к тексту). */
export function isMovable(o: MarkupObject): boolean {
  return !isTextMark(o)
}

/**
 * Сохраняет ли объект пропорции, когда его тянут за угол (с Shift — свободно).
 * Картинки и подписи — да; рамка текста меняется свободно, кегль не трогается.
 */
export function keepsAspect(o: MarkupObject): boolean {
  return o.kind === 'image'
}

/** Геометрические границы без учёта толщины линии: их тянут за углы. */
export function geometryBounds(o: MarkupObject): Rect {
  switch (o.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return unionRects(o.rects)
    case 'ink':
      return boundsOfPoints(o.paths.flat())
    case 'rect':
    case 'ellipse':
    case 'text':
    case 'image':
      return o.rect
    case 'line':
    case 'arrow':
      return boundsOfPoints([o.from, o.to])
  }
}

/** Границы всего, что рисуется (с толщиной линии и наконечником стрелки): /Rect аннотации. */
export function visualBounds(o: MarkupObject): Rect {
  switch (o.kind) {
    case 'ink':
    case 'rect':
    case 'ellipse':
    case 'line':
      return inflate(geometryBounds(o), o.width / 2 + 1)
    case 'arrow':
      return inflate(boundsOfPoints([o.from, o.to, ...arrowHead(o.from, o.to, o.width)]), o.width)
    default:
      return geometryBounds(o)
  }
}

function mapPoint(m: Matrix, p: Point): Point {
  return apply(m, p)
}

/** Применяет аффинное отображение (сдвиг и масштаб по осям) к объекту. */
export function transformObject<T extends MarkupObject>(o: T, m: Matrix): T {
  switch (o.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { ...o, rects: o.rects.map((r) => transformRect(m, r)) }
    case 'ink':
      return { ...o, paths: o.paths.map((path) => path.map((p) => mapPoint(m, p))) }
    case 'rect':
    case 'ellipse':
    case 'image':
    case 'text':
      return { ...o, rect: transformRect(m, o.rect) }
    case 'line':
    case 'arrow':
      return { ...o, from: mapPoint(m, o.from), to: mapPoint(m, o.to) }
  }
}

export function moveObject<T extends MarkupObject>(o: T, dx: number, dy: number): T {
  return transformObject(o, [1, 0, 0, 1, dx, dy])
}

/**
 * Переводит объект в новые геометрические границы (изменение размера за
 * ручку). У текста меняется только рамка — она становится рамкой заданной
 * ширины, кегль прежний; высоту под текст подгоняет resizeInView (resize.ts).
 */
export function resizeObject<T extends MarkupObject>(o: T, bounds: Rect): T {
  const resized = transformObject(o, rectToRectMatrix(geometryBounds(o), bounds))
  return resized.kind === 'text' ? { ...resized, fixedWidth: true } : resized
}

/**
 * Попадание точки в объект с допуском tolerance (в пунктах). Контуры фигур
 * ловятся только по линии, чтобы внутри рамки по-прежнему выделялся текст.
 */
export function hitObject(o: MarkupObject, p: Point, tolerance: number): boolean {
  switch (o.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return o.rects.some((r) => containsPoint(inflate(r, tolerance / 2), p))
    case 'text':
    case 'image':
      return containsPoint(inflate(o.rect, tolerance / 2), p)
    case 'ink': {
      const reach = o.width / 2 + tolerance
      return o.paths.some((path) =>
        path.length === 1
          ? path[0] !== undefined && Math.hypot(p.x - path[0].x, p.y - path[0].y) <= reach
          : path.some((a, i) => {
              const b = path[i + 1]
              return b !== undefined && distanceToSegment(p, a, b) <= reach
            })
      )
    }
    case 'line':
    case 'arrow':
      return distanceToSegment(p, o.from, o.to) <= o.width / 2 + tolerance
    case 'rect': {
      const reach = o.width / 2 + tolerance
      const { x, y, width: w, height: h } = o.rect
      const corners: Point[] = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h }
      ]
      return corners.some((a, i) => {
        const b = corners[(i + 1) % 4]
        return b !== undefined && distanceToSegment(p, a, b) <= reach
      })
    }
    case 'ellipse': {
      const rx = o.rect.width / 2
      const ry = o.rect.height / 2
      if (rx <= 0 || ry <= 0) return false
      const dx = (p.x - (o.rect.x + rx)) / rx
      const dy = (p.y - (o.rect.y + ry)) / ry
      const radial = Math.abs(Math.hypot(dx, dy) - 1) * Math.min(rx, ry)
      return radial <= o.width / 2 + tolerance
    }
  }
}

/** Верхний объект страницы под точкой (последний добавленный рисуется сверху). */
export function hitTest(
  objects: readonly MarkupObject[],
  page: number,
  p: Point,
  tolerance: number
): MarkupObject | null {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i]
    if (o?.page === page && hitObject(o, p, tolerance)) return o
  }
  return null
}

let idCounter = 0

export function newMarkupId(): string {
  idCounter += 1
  return `m${Date.now().toString(36)}${idCounter.toString(36)}`
}

/** Разбор data URL картинки: формат и байты. Бросает на неподдерживаемом формате. */
export function decodeImageDataUrl(src: string): { format: 'png' | 'jpeg'; bytes: Uint8Array } {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src)
  if (!match?.[1] || match[2] === undefined) {
    throw new Error('Поддерживаются только картинки PNG и JPEG')
  }
  const binary = atob(match[2].replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const format = match[1].toLowerCase() === 'png' ? 'png' : 'jpeg'
  return { format, bytes }
}
