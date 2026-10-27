import {
  apply,
  boxContentMatrix,
  boxContentSize,
  invert,
  transformRect,
  type Matrix,
  type Point,
  type Rect
} from './geometry'
import {
  geometryBounds,
  keepsAspect,
  MIN_IMAGE_SIZE,
  MIN_OBJECT_SIZE,
  resizeObject,
  type MarkupObject
} from './model'
import { layoutTextObject, TEXT_PADDING, type MeasureText } from './text-layout'

/**
 * Изменение размера объекта за ручки рамки. Рамка считается в пикселях вида
 * (после матрицы viewMatrix), поэтому ручка идёт за указателем при любом
 * масштабе, повороте вида и /Rotate страницы, а «правая» ручка всегда
 * справа на экране. Затем рамка переводится обратно в пространство страницы.
 */

type Side = -1 | 0 | 1

/** Ручка рамки: сторона по x и y вида (-1 — левая/верхняя, 0 — середина, 1 — правая/нижняя). */
export interface FrameHandle {
  /** Углы — 0…3 по часовой стрелке от левого верхнего, стороны — по названию. */
  id: string
  x: Side
  y: Side
  cursor: string
}

export const FRAME_HANDLES: readonly FrameHandle[] = [
  { id: '0', x: -1, y: -1, cursor: 'nwse-resize' },
  { id: '1', x: 1, y: -1, cursor: 'nesw-resize' },
  { id: '2', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: '3', x: -1, y: 1, cursor: 'nesw-resize' },
  { id: 'top', x: 0, y: -1, cursor: 'ns-resize' },
  { id: 'right', x: 1, y: 0, cursor: 'ew-resize' },
  { id: 'bottom', x: 0, y: 1, cursor: 'ns-resize' },
  { id: 'left', x: -1, y: 0, cursor: 'ew-resize' }
]

export function isCornerHandle(handle: FrameHandle): boolean {
  return handle.x !== 0 && handle.y !== 0
}

export function handlePoint(frame: Rect, handle: FrameHandle): Point {
  return {
    x: frame.x + (frame.width * (handle.x + 1)) / 2,
    y: frame.y + (frame.height * (handle.y + 1)) / 2
  }
}

interface Span {
  start: number
  length: number
}

/** Неподвижная сторона рамки по оси, когда тянут за сторону side. */
function fixedEdge(span: Span, side: Side): number {
  return side === 1 ? span.start : span.start + span.length
}

/**
 * Рамка после протягивания ручки до точки pointer (всё в пикселях вида):
 * противоположная сторона стоит, по оси без ручки размер прежний. keepAspect
 * у угловой ручки сохраняет пропорции рамки.
 */
export function dragFrame(
  frame: Rect,
  handle: FrameHandle,
  pointer: Point,
  options: { min: number; keepAspect: boolean }
): Rect {
  const axes = [
    { span: { start: frame.x, length: frame.width }, side: handle.x, p: pointer.x },
    { span: { start: frame.y, length: frame.height }, side: handle.y, p: pointer.y }
  ]
  const lengths = axes.map(({ span, side, p }) =>
    side === 0 ? span.length : Math.max(options.min, Math.abs(p - fixedEdge(span, side)))
  )
  if (options.keepAspect && isCornerHandle(handle) && frame.width > 0 && frame.height > 0) {
    const k = Math.max((lengths[0] ?? 0) / frame.width, (lengths[1] ?? 0) / frame.height)
    lengths[0] = frame.width * k
    lengths[1] = frame.height * k
  }
  const [x, y] = axes.map(({ span, side, p }, i): Span => {
    const length = lengths[i] ?? 0
    if (side === 0) return span
    const fixed = fixedEdge(span, side)
    return { start: p < fixed ? fixed - length : fixed, length }
  })
  return {
    x: x?.start ?? frame.x,
    y: y?.start ?? frame.y,
    width: x?.length ?? frame.width,
    height: y?.length ?? frame.height
  }
}

export interface ResizeView {
  /** Матрица «страница → пиксели вида» (viewMatrix). */
  matrix: Matrix
  /** CSS-пикселей на пункт. */
  scale: number
  /** Измеритель строк текста (перенос в рамке). */
  measure: MeasureText
}

/**
 * Новый объект после протягивания ручки до точки pointer (пиксели вида).
 * free — Shift: угол картинки тянется без сохранения пропорций. Рамка
 * текста не меняет кегль: текст переносится по её ширине, а высота не
 * бывает меньше высоты текста — недостающее добирается от неподвижной
 * стороны (или от начала текста, если тянули другую ось).
 */
export function resizeInView<T extends MarkupObject>(
  o: T,
  handle: FrameHandle,
  pointer: Point,
  free: boolean,
  view: ResizeView
): T {
  const inverse = invert(view.matrix)
  const frame = transformRect(view.matrix, geometryBounds(o))
  const minSize =
    o.kind === 'text'
      ? Math.max(MIN_OBJECT_SIZE, o.fontSize * (1 + TEXT_PADDING * 2))
      : o.kind === 'image'
        ? MIN_IMAGE_SIZE
        : MIN_OBJECT_SIZE
  const rect = dragFrame(frame, handle, pointer, {
    min: minSize * view.scale,
    keepAspect: keepsAspect(o) && !free
  })
  const resized = resizeObject(o, transformRect(inverse, rect))
  if (resized.kind !== 'text') return resized

  const need = layoutTextObject(resized, view.measure).height
  const content = boxContentSize(resized.rect, resized.rotate)
  if (content.height >= need - 1e-6) return resized
  // По какой оси экрана идёт высота текста и в какую сторону от его начала.
  const box = boxContentMatrix(resized.rect, resized.rotate)
  const top = apply(view.matrix, apply(box, { x: 0, y: 0 }))
  const bottom = apply(view.matrix, apply(box, { x: 0, y: content.height }))
  const vertical = Math.abs(bottom.y - top.y) > Math.abs(bottom.x - top.x)
  const side = vertical ? handle.y : handle.x
  const span: Span = vertical
    ? { start: rect.y, length: rect.height }
    : { start: rect.x, length: rect.width }
  let forward: boolean
  if (side === 0) {
    forward = vertical ? bottom.y > top.y : bottom.x > top.x
  } else {
    const was: Span = vertical
      ? { start: frame.y, length: frame.height }
      : { start: frame.x, length: frame.width }
    const fixed = fixedEdge(was, side)
    forward = Math.abs(span.start - fixed) <= Math.abs(span.start + span.length - fixed)
  }
  const length = need * view.scale
  const start = forward ? span.start : span.start + span.length - length
  const grown: Rect = vertical
    ? { ...rect, y: start, height: length }
    : { ...rect, x: start, width: length }
  return resizeObject(o, transformRect(inverse, grown))
}
