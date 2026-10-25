import { describe, expect, it } from 'vitest'
import type { PageImage, PageTextLine } from '@shared/pdf-content/types'
import {
  contentSource,
  hitSources,
  markupSource,
  selectedMarkupId
} from '@renderer/features/markup/selection'

const line: PageTextLine = {
  kind: 'text',
  index: 0,
  text: 'Caption',
  rect: { x: 100, y: 300, width: 80, height: 14 },
  origin: { x: 100, y: 303 },
  direction: { x: 1, y: 0 },
  fontName: 'ABCDEF+Helvetica',
  fontSize: 12,
  bold: false,
  italic: false,
  color: [0, 0, 0]
}

const image: PageImage = {
  kind: 'image',
  index: 0,
  rect: { x: 72, y: 200, width: 300, height: 200 },
  pixelWidth: 600,
  pixelHeight: 400
}

describe('выбор объектов документа', () => {
  const source = contentSource(2, [image, line])

  it('из перекрывающихся рамок выбирает самую маленькую: строку поверх картинки', () => {
    const hit = source.hitTest(2, { x: 120, y: 307 }, 1)
    expect(hit).toMatchObject({ source: 'content', page: 2, id: '2:text:0' })
    expect(source.hitTest(2, { x: 80, y: 210 }, 1)).toMatchObject({ id: '2:image:0' })
  })

  it('не находит объект на другой странице и мимо рамок', () => {
    expect(source.hitTest(1, { x: 120, y: 307 }, 1)).toBeNull()
    expect(source.hitTest(2, { x: 500, y: 700 }, 1)).toBeNull()
  })

  it('разметка опрашивается раньше содержимого и только она даёт id разметки', () => {
    const markup = markupSource([
      {
        id: 'm1',
        page: 2,
        kind: 'rect',
        color: '#000000',
        opacity: 1,
        width: 2,
        rect: { x: 110, y: 290, width: 50, height: 40 }
      }
    ])
    const hit = hitSources([markup, source], 2, { x: 110, y: 300 }, 2)
    expect(hit).toEqual({ source: 'markup', id: 'm1' })
    expect(selectedMarkupId(hit)).toBe('m1')
    expect(selectedMarkupId(source.hitTest(2, { x: 120, y: 307 }, 1))).toBeNull()
  })
})
