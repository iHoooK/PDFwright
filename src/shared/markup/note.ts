import { parseHexColor, type Point, type Rect } from './geometry'

/**
 * Значок заметки-стикера: листок с загнутым уголком и тремя строчками.
 * Один и тот же контур рисуют слой разметки (SVG в координатах страницы) и
 * applyMarkup (внешний вид аннотации /Text или содержимое страницы), поэтому
 * значок на экране и в файле совпадает.
 */

/** Сторона значка, пт. */
export const NOTE_SIZE = 20

/** Цвет заметки по умолчанию — жёлтый, как у бумажных стикеров. */
export const NOTE_COLOR = '#ffd86b'

export interface NoteIcon {
  /** Листок с загнутым уголком (замкнутый контур). */
  body: Point[]
  /** Загнутый уголок. */
  fold: Point[]
  /** Строчки текста: пары точек. */
  lines: [Point, Point][]
  /** Толщина обводки, пт. */
  stroke: number
}

/** Точки значка в квадрате rect пространства страницы (ось Y вверх, как в PDF). */
export function noteIcon(rect: Rect): NoteIcon {
  // (u, v) — доли стороны от левого верхнего угла значка, v растёт вниз.
  const at = (u: number, v: number): Point => ({
    x: rect.x + u * rect.width,
    y: rect.y + rect.height - v * rect.height
  })
  return {
    body: [at(0.1, 0.1), at(0.9, 0.1), at(0.9, 0.66), at(0.66, 0.9), at(0.1, 0.9)],
    fold: [at(0.66, 0.9), at(0.66, 0.66), at(0.9, 0.66)],
    lines: [
      [at(0.25, 0.32), at(0.75, 0.32)],
      [at(0.25, 0.48), at(0.75, 0.48)],
      [at(0.25, 0.64), at(0.52, 0.64)]
    ],
    stroke: Math.max(0.5, rect.width * 0.06)
  }
}

/** Тёмный оттенок цвета заметки для обводки и строчек: #rrggbb. */
export function noteInk(color: string): string {
  const hex = (value: number): string =>
    Math.round(value * 255 * 0.45)
      .toString(16)
      .padStart(2, '0')
  const [r, g, b] = parseHexColor(color)
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Квадрат значка с центром в точке щелчка (координаты страницы). */
export function noteRectAt(p: Point): Rect {
  const half = NOTE_SIZE / 2
  return { x: p.x - half, y: p.y - half, width: NOTE_SIZE, height: NOTE_SIZE }
}
