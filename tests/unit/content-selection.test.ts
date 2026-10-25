import { describe, expect, it } from 'vitest'
import { pickPageObject } from '@shared/pdf-content/hit-test'
import type { PageImage, PageTextLine } from '@shared/pdf-content/types'

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

describe('выбор объекта документа под указателем', () => {
  const objects = [image, line]

  it('из перекрывающихся рамок выбирает самую маленькую: строку поверх картинки', () => {
    expect(pickPageObject(objects, { x: 120, y: 307 }, 1)).toBe(line)
    expect(pickPageObject(objects, { x: 80, y: 210 }, 1)).toBe(image)
  })

  it('учитывает допуск у края рамки и не находит объект мимо рамок', () => {
    expect(pickPageObject([line], { x: 99, y: 307 }, 0)).toBeNull()
    expect(pickPageObject([line], { x: 99, y: 307 }, 2)).toBe(line)
    expect(pickPageObject(objects, { x: 500, y: 700 }, 1)).toBeNull()
  })
})
