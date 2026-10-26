import { describe, expect, it } from 'vitest'
import {
  boxContentSize,
  transformRect,
  viewMatrix,
  type PageBox,
  type Rect
} from '@shared/markup/geometry'
import type { ImageObject, InkObject, TextObject } from '@shared/markup/model'
import { dragFrame, FRAME_HANDLES, resizeInView, type FrameHandle } from '@shared/markup/resize'
import {
  FONT_ASCENT,
  FONT_DESCENT,
  fitTextBox,
  layoutText,
  layoutTextObject,
  LINE_HEIGHT,
  TEXT_PADDING,
  wrapParagraph
} from '@shared/markup/text-layout'

const LETTER: PageBox = [0, 0, 612, 792]
/** Моноширинный измеритель: буква (и пробел) — полкегля. */
const measure = (text: string, size: number): number => Array.from(text).length * size * 0.5
const base = { page: 1, color: '#000000', opacity: 1 }

function handle(id: string): FrameHandle {
  const found = FRAME_HANDLES.find((h) => h.id === id)
  if (!found) throw new Error(id)
  return found
}

function expectRect(actual: Rect, expected: Rect): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.width).toBeCloseTo(expected.width, 6)
  expect(actual.height).toBeCloseTo(expected.height, 6)
}

/** Высота блока из n строк кегля size. */
function textHeight(lines: number, size: number): number {
  return (
    size * TEXT_PADDING * 2 + (lines - 1) * size * LINE_HEIGHT + size * (FONT_ASCENT + FONT_DESCENT)
  )
}

function newText(text: string, rotate: TextObject['rotate'] = 0): TextObject {
  return fitTextBox(
    {
      ...base,
      id: 't',
      kind: 'text',
      rect: { x: 100, y: 600, width: 0, height: 0 },
      rotate,
      text,
      fontSize: 10
    },
    measure
  )
}

describe('перенос текста в рамке', () => {
  it('переносит по словам; пробел на месте переноса в строку не входит', () => {
    // Строка вмещает 8 букв: 40 пт при кегле 10.
    expect(wrapParagraph('один два три', 40, 10, measure)).toEqual(['один два', 'три'])
    expect(wrapParagraph('  отступ', 40, 10, measure)).toEqual(['  отступ'])
    expect(wrapParagraph('', 40, 10, measure)).toEqual([''])
  })

  it('слово длиннее строки разрывается по буквам', () => {
    expect(wrapParagraph('я абвгдежзиклм', 40, 10, measure)).toEqual(['я', 'абвгдежз', 'иклм'])
    expect(wrapParagraph('абв', 0, 10, measure)).toEqual(['а', 'б', 'в'])
  })

  it('раскладка рамки: ширина задана, переводы строк сохраняются, высота по строкам', () => {
    const layout = layoutText('один два три\n\nб', 10, measure, 45)
    expect(layout.lines.map((l) => l.text)).toEqual(['один два', 'три', '', 'б'])
    expect(layout.width).toBe(45)
    expect(layout.height).toBeCloseTo(textHeight(4, 10))
    expect(layout.lines[1]?.baseline).toBeCloseTo(2.5 + 10 * FONT_ASCENT + 13)
    // Без ширины блок растёт по тексту, как раньше.
    expect(layoutText('один два три', 10, measure).lines).toHaveLength(1)
  })

  it('рамка заданной ширины держит ширину и пустое место, блок без неё — по тексту', () => {
    const auto = newText('один два три')
    expect(auto.rect.width).toBeCloseTo(12 * 5 + 5)
    const frame: TextObject = {
      ...auto,
      fixedWidth: true,
      rect: { x: 100, y: 500, width: 45, height: 120 }
    }
    const fitted = fitTextBox({ ...frame, text: 'один два три четыре' }, measure)
    expect(fitted.rect).toEqual(frame.rect)
    const grown = fitTextBox({ ...frame, fontSize: 30 }, measure)
    expect(grown.rect.width).toBeCloseTo(45)
    // Верх рамки (начало текста) на месте, вниз добирается высота текста.
    expect(grown.rect.y + grown.rect.height).toBeCloseTo(620)
    expect(grown.rect.height).toBeCloseTo(layoutTextObject(grown, measure).height)
  })
})

describe('изменение размера за ручки', () => {
  const view = (rotation: number, scale = 1.5): ReturnType<typeof viewMatrix> =>
    viewMatrix(LETTER, rotation, scale)

  it('dragFrame: противоположная сторона стоит, боковая ручка меняет одну ось', () => {
    const frame = { x: 10, y: 10, width: 100, height: 50 }
    const options = { min: 4, keepAspect: false }
    expect(dragFrame(frame, handle('right'), { x: 200, y: 999 }, options)).toEqual({
      x: 10,
      y: 10,
      width: 190,
      height: 50
    })
    expect(dragFrame(frame, handle('top'), { x: 0, y: 40 }, options)).toEqual({
      x: 10,
      y: 40,
      width: 100,
      height: 20
    })
    expect(dragFrame(frame, handle('0'), { x: 108, y: 58 }, options)).toEqual({
      x: 106,
      y: 56,
      width: 4,
      height: 4
    })
  })

  it('картинка: угол сохраняет пропорции, с Shift — свободно, сторона тянет одну ось', () => {
    const image: ImageObject = {
      ...base,
      id: 'i',
      kind: 'image',
      rect: { x: 100, y: 100, width: 200, height: 100 },
      rotate: 0,
      src: 'data:image/png;base64,',
      signature: false
    }
    const ctx = { matrix: view(0), scale: 1.5, measure }
    const frame = transformRect(ctx.matrix, image.rect)
    const corner = { x: frame.x + frame.width + 60, y: frame.y + frame.height }
    expectRect(resizeInView(image, handle('2'), corner, false, ctx).rect, {
      x: 100,
      y: 80,
      width: 240,
      height: 120
    })
    expectRect(resizeInView(image, handle('2'), corner, true, ctx).rect, {
      x: 100,
      y: 100,
      width: 240,
      height: 100
    })
    expectRect(resizeInView(image, handle('right'), corner, false, ctx).rect, {
      x: 100,
      y: 100,
      width: 240,
      height: 100
    })
  })

  it('рисунок пером растягивается по одной оси масштабированием точек', () => {
    const ink: InkObject = {
      ...base,
      id: 'p',
      kind: 'ink',
      width: 2,
      paths: [
        [
          { x: 100, y: 100 },
          { x: 200, y: 150 }
        ]
      ]
    }
    const ctx = { matrix: view(0, 1), scale: 1, measure }
    // Правая сторона на 100 пт правее: ширина 100 → 200.
    const out = resizeInView(ink, handle('right'), { x: 300, y: 0 }, false, ctx)
    expect(out.paths[0]).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 150 }
    ])
  })

  it('текст: сужение переносит строки, кегль прежний, высота растёт вниз от начала', () => {
    const text = newText('один два три четыре')
    const ctx = { matrix: view(0), scale: 1.5, measure }
    const before = transformRect(ctx.matrix, text.rect)
    // Рамка 60 пт: в строку входит 11 букв.
    const out = resizeInView(text, handle('right'), { x: before.x + 60 * 1.5, y: 0 }, false, ctx)
    expect(out.fontSize).toBe(10)
    expect(out.fixedWidth).toBe(true)
    expect(layoutTextObject(out, measure).lines.map((l) => l.text)).toEqual([
      'один два',
      'три четыре'
    ])
    expectRect(out.rect, {
      x: 100,
      y: 600 - textHeight(2, 10),
      width: 60,
      height: textHeight(2, 10)
    })
  })

  it('текст: высоту не сжать меньше текста, лишняя высота остаётся пустым местом', () => {
    const text = newText('один')
    const ctx = { matrix: view(0, 1), scale: 1, measure }
    const before = transformRect(ctx.matrix, text.rect)
    const squeezed = resizeInView(text, handle('top'), { x: 0, y: before.y + 10 }, false, ctx)
    // Тянули верх — стоит низ.
    expectRect(squeezed.rect, text.rect)
    const taller = resizeInView(text, handle('bottom'), { x: 0, y: before.y + 80 }, false, ctx)
    expect(taller.rect.height).toBeCloseTo(80)
    expect(taller.rect.y + taller.rect.height).toBeCloseTo(text.rect.y + text.rect.height)
    expect(layoutTextObject(taller, measure).lines).toHaveLength(1)
  })

  it('/Rotate 90: текст стоит ровно, правая ручка на экране сужает строку', () => {
    // Страница с /Rotate 90 без поворота вида: полный поворот 90, текст выпрямлен под него.
    const text = newText('один два три четыре', 90)
    const ctx = { matrix: view(90, 1), scale: 1, measure }
    const before = transformRect(ctx.matrix, text.rect)
    expect(before.width).toBeCloseTo(boxContentSize(text.rect, 90).width)
    const out = resizeInView(text, handle('right'), { x: before.x + 60, y: 0 }, false, ctx)
    expect(out.fontSize).toBe(10)
    expect(boxContentSize(out.rect, 90).width).toBeCloseTo(60)
    expect(layoutTextObject(out, measure).lines).toHaveLength(2)
    const after = transformRect(ctx.matrix, out.rect)
    expectRect(after, { x: before.x, y: before.y, width: 60, height: textHeight(2, 10) })
  })

  it('текст повёрнут относительно вида: высота добирается от начала текста по оси экрана', () => {
    // Текст писали без поворота, потом вид повернули на 90°: строки идут сверху вниз,
    // начало текста — у правого края рамки на экране.
    const text = newText('один два три четыре', 0)
    const ctx = { matrix: view(90, 1), scale: 1, measure }
    const before = transformRect(ctx.matrix, text.rect)
    expect(before.height).toBeCloseTo(text.rect.width)
    const out = resizeInView(text, handle('bottom'), { x: 0, y: before.y + 60 }, false, ctx)
    expect(out.fontSize).toBe(10)
    expect(out.rect.width).toBeCloseTo(60)
    expect(layoutTextObject(out, measure).lines).toHaveLength(2)
    const after = transformRect(ctx.matrix, out.rect)
    expect(after.x + after.width).toBeCloseTo(before.x + before.width)
    expect(after.width).toBeCloseTo(textHeight(2, 10))
    expect(after.y).toBeCloseTo(before.y)
  })
})
