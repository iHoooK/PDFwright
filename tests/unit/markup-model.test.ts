import { describe, expect, it } from 'vitest'
import {
  decodeImageDataUrl,
  geometryBounds,
  hitTest,
  moveObject,
  resizeObject,
  visualBounds,
  type MarkupObject
} from '@shared/markup/model'
import { HISTORY_LIMITS, distinctBytes, pushSnapshot } from '@shared/markup/history'
import { FONT_ASCENT, layoutText, LINE_HEIGHT, TEXT_PADDING } from '@shared/markup/text-layout'

const base = { page: 1, color: '#c42b1c', opacity: 1 }
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const objects: MarkupObject[] = [
  { ...base, id: 'hl', kind: 'highlight', rects: [{ x: 72, y: 700, width: 200, height: 12 }] },
  {
    ...base,
    id: 'ink',
    kind: 'ink',
    width: 2,
    paths: [
      [
        { x: 100, y: 100 },
        { x: 150, y: 120 }
      ]
    ]
  },
  { ...base, id: 'rect', kind: 'rect', width: 2, rect: { x: 300, y: 300, width: 100, height: 50 } },
  {
    ...base,
    id: 'ell',
    kind: 'ellipse',
    width: 2,
    rect: { x: 300, y: 500, width: 100, height: 50 }
  },
  { ...base, id: 'arr', kind: 'arrow', width: 3, from: { x: 50, y: 400 }, to: { x: 200, y: 400 } },
  {
    ...base,
    id: 'txt',
    kind: 'text',
    rect: { x: 400, y: 100, width: 80, height: 20 },
    rotate: 0,
    text: 'Привет',
    fontSize: 12
  }
]

describe('модель разметки', () => {
  it('находит объект под точкой с допуском, фигуры — только по контуру', () => {
    expect(hitTest(objects, 1, { x: 100, y: 705 }, 2)?.id).toBe('hl')
    expect(hitTest(objects, 1, { x: 125, y: 111 }, 2)?.id).toBe('ink')
    expect(hitTest(objects, 1, { x: 301, y: 330 }, 2)?.id).toBe('rect')
    expect(hitTest(objects, 1, { x: 350, y: 325 }, 2)).toBeNull()
    expect(hitTest(objects, 1, { x: 350, y: 549 }, 2)?.id).toBe('ell')
    expect(hitTest(objects, 1, { x: 350, y: 525 }, 2)).toBeNull()
    expect(hitTest(objects, 1, { x: 120, y: 402 }, 1)?.id).toBe('arr')
    expect(hitTest(objects, 1, { x: 440, y: 110 }, 1)?.id).toBe('txt')
    expect(hitTest(objects, 2, { x: 440, y: 110 }, 1)).toBeNull()
  })

  it('верхний (последний) объект перекрывает нижний', () => {
    const over: MarkupObject = {
      ...base,
      id: 'top',
      kind: 'image',
      rect: { x: 390, y: 90, width: 100, height: 40 },
      rotate: 0,
      src: PNG_1PX,
      signature: true
    }
    expect(hitTest([...objects, over], 1, { x: 440, y: 110 }, 1)?.id).toBe('top')
  })

  it('перемещение и изменение размера переводят геометрию целиком', () => {
    const ink = objects[1]
    if (ink?.kind !== 'ink') throw new Error('fixture')
    const moved = moveObject(ink, 10, -5)
    expect(moved.paths[0]?.[0]).toEqual({ x: 110, y: 95 })
    const resized = resizeObject(ink, { x: 0, y: 0, width: 100, height: 40 })
    expect(geometryBounds(resized)).toEqual({ x: 0, y: 0, width: 100, height: 40 })
    expect(ink.paths[0]?.[0]).toEqual({ x: 100, y: 100 })
  })

  it('увеличение текстового блока увеличивает кегль', () => {
    const text = objects[5]
    if (text?.kind !== 'text') throw new Error('fixture')
    const bigger = resizeObject(text, { x: 400, y: 100, width: 160, height: 40 })
    expect(bigger.fontSize).toBeCloseTo(24)
  })

  it('видимые границы включают толщину линии и наконечник стрелки', () => {
    const arrow = objects[4]
    if (!arrow) throw new Error('fixture')
    const bounds = visualBounds(arrow)
    expect(bounds.x).toBeLessThan(50)
    expect(bounds.y + bounds.height).toBeGreaterThan(400 + 3)
  })

  it('разбирает data URL картинки и отклоняет другие форматы', () => {
    const { format, bytes } = decodeImageDataUrl(PNG_1PX)
    expect(format).toBe('png')
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG')
    expect(() => decodeImageDataUrl('data:image/gif;base64,R0lGOD')).toThrow()
  })
})

describe('раскладка текста', () => {
  it('ставит базовые линии с шагом межстрочного интервала и считает размер блока', () => {
    const layout = layoutText('Первая\nВторая строка', 10, (line, size) => line.length * size * 0.5)
    expect(layout.lines).toHaveLength(2)
    expect(layout.lines[0]?.baseline).toBeCloseTo(10 * TEXT_PADDING + 10 * FONT_ASCENT)
    expect((layout.lines[1]?.baseline ?? 0) - (layout.lines[0]?.baseline ?? 0)).toBeCloseTo(
      10 * LINE_HEIGHT
    )
    expect(layout.width).toBeCloseTo(13 * 5 + 10 * TEXT_PADDING * 2)
  })
})

describe('история отмены', () => {
  it('хранит до 100 шагов разметки на одних и тех же байтах', () => {
    const bytes = new Uint8Array(1)
    let history: { bytes: Uint8Array; markup: number }[] = []
    for (let i = 0; i < 120; i += 1) history = pushSnapshot(history, { bytes, markup: i })
    expect(history).toHaveLength(HISTORY_LIMITS.steps)
    expect(history[0]?.markup).toBe(20)
  })

  it('держит в памяти не больше 12 разных копий байтов', () => {
    let history: { bytes: Uint8Array; markup: number }[] = []
    for (let i = 0; i < 20; i += 1) {
      const bytes = new Uint8Array(1)
      history = pushSnapshot(history, { bytes, markup: i })
      history = pushSnapshot(history, { bytes, markup: i + 0.5 })
    }
    expect(distinctBytes(history)).toBe(HISTORY_LIMITS.byteCopies)
    expect(history.at(-1)?.markup).toBe(19.5)
  })
})
