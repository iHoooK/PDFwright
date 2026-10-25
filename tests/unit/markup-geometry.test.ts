import { describe, expect, it } from 'vitest'
import {
  apply,
  arrowHead,
  boxContentMatrix,
  boxContentSize,
  invert,
  mergeLineRects,
  multiply,
  normalizeTurn,
  parseHexColor,
  resizeBoxKeepingOrigin,
  simplifyPath,
  transformRect,
  viewMatrix,
  viewSize,
  type PageBox,
  type Point,
  type QuarterTurn
} from '@shared/markup/geometry'

const LETTER: PageBox = [0, 0, 612, 792]
const TURNS: QuarterTurn[] = [0, 90, 180, 270]

function close(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('viewMatrix (как PageViewport pdf.js)', () => {
  it('без поворота: верх-лево страницы в (0,0), ось Y вниз, масштаб', () => {
    const m = viewMatrix(LETTER, 0, 1.5)
    close(apply(m, { x: 0, y: 792 }), { x: 0, y: 0 })
    close(apply(m, { x: 612, y: 0 }), { x: 918, y: 1188 })
    close(apply(m, { x: 100, y: 700 }), { x: 150, y: 138 })
  })

  it('поворот на 90° по часовой: левый нижний угол уходит в левый верхний', () => {
    const m = viewMatrix(LETTER, 90, 1)
    close(apply(m, { x: 0, y: 0 }), { x: 0, y: 0 })
    close(apply(m, { x: 612, y: 0 }), { x: 0, y: 612 })
    close(apply(m, { x: 0, y: 792 }), { x: 792, y: 0 })
  })

  it('поворот на 180° и 270°', () => {
    close(apply(viewMatrix(LETTER, 180, 1), { x: 0, y: 0 }), { x: 612, y: 0 })
    close(apply(viewMatrix(LETTER, 180, 1), { x: 612, y: 792 }), { x: 0, y: 792 })
    close(apply(viewMatrix(LETTER, 270, 1), { x: 0, y: 0 }), { x: 792, y: 612 })
    close(apply(viewMatrix(LETTER, 270, 1), { x: 612, y: 792 }), { x: 0, y: 0 })
  })

  it('учитывает смещённую видимую область (CropBox не от нуля)', () => {
    const box: PageBox = [10, 20, 210, 320]
    const m = viewMatrix(box, 0, 2)
    close(apply(m, { x: 10, y: 320 }), { x: 0, y: 0 })
    close(apply(m, { x: 210, y: 20 }), { x: 400, y: 600 })
    for (const turn of TURNS) {
      const size = viewSize(box, turn, 2)
      const corners = [
        { x: 10, y: 20 },
        { x: 210, y: 320 }
      ].map((p) => apply(viewMatrix(box, turn, 2), p))
      const xs = corners.map((p) => p.x).sort((a, b) => a - b)
      const ys = corners.map((p) => p.y).sort((a, b) => a - b)
      expect(xs[0]).toBeCloseTo(0)
      expect(xs[1]).toBeCloseTo(size.width)
      expect(ys[0]).toBeCloseTo(0)
      expect(ys[1]).toBeCloseTo(size.height)
    }
  })

  it('обратное преобразование возвращает точку страницы при любом масштабе и повороте', () => {
    const p = { x: 123.4, y: 567.8 }
    for (const turn of TURNS) {
      for (const scale of [0.25, 1, 1.333, 4]) {
        const m = viewMatrix(LETTER, turn, scale)
        close(apply(invert(m), apply(m, p)), p)
      }
    }
  })

  it('поворот больше 360 и отрицательный приводится к четверти оборота', () => {
    expect(normalizeTurn(450)).toBe(90)
    expect(normalizeTurn(-90)).toBe(270)
    expect(viewSize(LETTER, 450, 1)).toEqual({ width: 792, height: 612 })
  })
})

describe('boxContentMatrix', () => {
  it('содержимое коробки стоит ровно на экране, если повёрнуто под /Rotate страницы', () => {
    const rect = { x: 100, y: 200, width: 80, height: 40 }
    for (const pageTurn of TURNS) {
      const toView = multiply(boxContentMatrix(rect, pageTurn), viewMatrix(LETTER, pageTurn, 1.5))
      const origin = apply(toView, { x: 0, y: 0 })
      const right = apply(toView, { x: 1, y: 0 })
      const down = apply(toView, { x: 0, y: 1 })
      close({ x: right.x - origin.x, y: right.y - origin.y }, { x: 1.5, y: 0 })
      close({ x: down.x - origin.x, y: down.y - origin.y }, { x: 0, y: 1.5 })
    }
  })

  it('отображает содержимое ровно в прямоугольник коробки', () => {
    const rect = { x: 100, y: 200, width: 80, height: 40 }
    for (const turn of TURNS) {
      const size = boxContentSize(rect, turn)
      const image = transformRect(boxContentMatrix(rect, turn), {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height
      })
      expect(image.x).toBeCloseTo(rect.x)
      expect(image.y).toBeCloseTo(rect.y)
      expect(image.width).toBeCloseTo(rect.width)
      expect(image.height).toBeCloseTo(rect.height)
    }
  })

  it('новый размер содержимого сохраняет начало текста', () => {
    const rect = { x: 100, y: 200, width: 80, height: 40 }
    for (const turn of TURNS) {
      const before = apply(boxContentMatrix(rect, turn), { x: 0, y: 0 })
      const resized = resizeBoxKeepingOrigin(rect, turn, 150, 60)
      close(apply(boxContentMatrix(resized, turn), { x: 0, y: 0 }), before)
      expect(boxContentSize(resized, turn)).toEqual({ width: 150, height: 60 })
    }
  })
})

describe('mergeLineRects', () => {
  it('склеивает фрагменты многострочного выделения в прямоугольник на строку', () => {
    const line = (
      y: number,
      xs: [number, number][]
    ): { x: number; y: number; width: number; height: number }[] =>
      xs.map(([from, to]) => ({ x: from, y, width: to - from, height: 12 }))
    const rects = [
      ...line(700, [
        [200, 260],
        [261, 330],
        [332, 540]
      ]),
      ...line(684, [
        [72, 300],
        [301, 540]
      ]),
      ...line(668, [[72, 150]]),
      { x: 300, y: 668, width: 0, height: 12 }
    ]
    const merged = mergeLineRects(rects)
    expect(merged).toHaveLength(3)
    expect(merged[0]).toEqual({ x: 200, y: 700, width: 340, height: 12 })
    expect(merged[1]).toEqual({ x: 72, y: 684, width: 468, height: 12 })
    expect(merged[2]).toEqual({ x: 72, y: 668, width: 78, height: 12 })
  })

  it('не склеивает колонки, разделённые широким промежутком', () => {
    const merged = mergeLineRects([
      { x: 72, y: 500, width: 200, height: 10 },
      { x: 320, y: 500, width: 200, height: 10 }
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('simplifyPath и стрелка', () => {
  it('убирает точки на прямой и оставляет изломы', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0.01 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 5 }
    ]
    expect(simplifyPath(points, 0.2)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 5 }
    ])
  })

  it('усы стрелки симметричны относительно линии', () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 2)
    expect(left.x).toBeCloseTo(right.x)
    expect(left.y).toBeCloseTo(-right.y)
    expect(left.x).toBeLessThan(100)
  })

  it('разбирает цвет #rrggbb', () => {
    expect(parseHexColor('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(parseHexColor('мусор')).toEqual([0, 0, 0])
  })
})
