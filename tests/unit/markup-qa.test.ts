import { describe, expect, it } from 'vitest'
import { markColorFor, MARK_KIND_COLORS } from '@shared/markup/colors'
import { viewDeltaToPage, viewMatrix, type PageBox } from '@shared/markup/geometry'
import {
  hitInside,
  hitTest,
  hitTestInside,
  MIN_IMAGE_SIZE,
  type BoxShapeObject,
  type ImageObject
} from '@shared/markup/model'
import { FRAME_HANDLES, resizeInView } from '@shared/markup/resize'

/** Проверки исправлений по отчёту QA разметки (M12, M14). */

const LIGHT = ['#ffd86b', '#9be39b', '#9fd3ff', '#ffb0c8', '#d7bfff']
const base = { page: 1, color: '#c42b1c', opacity: 1 }

const rect: BoxShapeObject = {
  ...base,
  id: 'r',
  kind: 'rect',
  width: 2,
  rect: { x: 100, y: 100, width: 200, height: 100 }
}
const ellipse: BoxShapeObject = { ...rect, id: 'e', kind: 'ellipse' }

describe('щелчок внутри фигуры (M14)', () => {
  it('прямоугольник и эллипс ловятся посередине, контур — как раньше', () => {
    const center = { x: 200, y: 150 }
    // Обычное попадание по-прежнему только по контуру: внутри рамки выделяется текст.
    expect(hitTest([rect], 1, center, 3)).toBeNull()
    expect(hitInside(rect, center)).toBe(true)
    expect(hitInside(ellipse, center)).toBe(true)
    // Угол рамки эллипса — снаружи эллипса.
    expect(hitInside(ellipse, { x: 102, y: 102 })).toBe(false)
    expect(hitInside(rect, { x: 50, y: 50 })).toBe(false)
    expect(hitTestInside([rect, ellipse], 1, center)?.id).toBe('e')
    expect(hitTestInside([rect, ellipse], 2, center)).toBeNull()
  })
})

describe('стрелки двигают объект по экрану (M14)', () => {
  const box: PageBox = [0, 0, 595, 842]
  it.each([0, 90, 180, 270])('при повороте %i «вправо» — вправо на экране', (rotation) => {
    const m = viewMatrix(box, rotation, 1)
    for (const [dx, dy] of [
      [10, 0],
      [0, 10],
      [-1, 0]
    ] as const) {
      const d = viewDeltaToPage(rotation, dx, dy)
      // Линейная часть матрицы вида переводит сдвиг страницы обратно в экранный.
      expect(m[0] * d.x + m[2] * d.y).toBeCloseTo(dx, 9)
      expect(m[1] * d.x + m[3] * d.y).toBeCloseTo(dy, 9)
    }
  })
})

describe('цвет маркера по виду пометки (M14)', () => {
  it('подчёркивание и зачёркивание по умолчанию тёмные, выделение — светлое', () => {
    expect(markColorFor('underline', '#ffd86b', LIGHT)).toBe(MARK_KIND_COLORS.underline)
    expect(markColorFor('strikeout', '#9be39b', LIGHT)).toBe(MARK_KIND_COLORS.strikeout)
    expect(markColorFor('strikeout', MARK_KIND_COLORS.underline, LIGHT)).toBe('#c42b1c')
    expect(markColorFor('highlight', '#c42b1c', LIGHT)).toBe(MARK_KIND_COLORS.highlight)
    // Подходящий выбранный цвет остаётся.
    expect(markColorFor('highlight', '#9fd3ff', LIGHT)).toBe('#9fd3ff')
    expect(markColorFor('underline', '#1b1b1b', LIGHT)).toBe('#1b1b1b')
  })
})

describe('наименьший размер картинки (M12)', () => {
  it('угловая ручка не сжимает картинку мельче MIN_IMAGE_SIZE', () => {
    const image: ImageObject = {
      ...base,
      id: 'i',
      kind: 'image',
      rect: { x: 100, y: 100, width: 200, height: 100 },
      rotate: 0,
      src: '',
      signature: false
    }
    const matrix = viewMatrix([0, 0, 595, 842], 0, 1)
    const corner = FRAME_HANDLES.find((h) => h.id === '2')
    if (!corner) throw new Error('нет ручки')
    // Правый нижний угол тянут почти к левому верхнему.
    const view = { x: 101, y: 842 - 199 }
    const free = resizeInView(image, corner, view, true, { matrix, scale: 1, measure: () => 0 })
    expect(free.rect.width).toBeGreaterThanOrEqual(MIN_IMAGE_SIZE - 1e-9)
    expect(free.rect.height).toBeGreaterThanOrEqual(MIN_IMAGE_SIZE - 1e-9)
    const kept = resizeInView(image, corner, view, false, { matrix, scale: 1, measure: () => 0 })
    expect(Math.min(kept.rect.width, kept.rect.height)).toBeGreaterThanOrEqual(
      MIN_IMAGE_SIZE - 1e-9
    )
    expect(kept.rect.width / kept.rect.height).toBeCloseTo(2, 6)
  })
})
