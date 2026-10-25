import { deflateSync } from 'node:zlib'
import * as mupdf from 'mupdf'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  eraseRegions,
  listPageObjects,
  moveImage,
  PdfContentError,
  removeImage,
  removeTextLine,
  replaceImage,
  replaceText,
  type PageImage,
  type PageObjects,
  type PageTextLine,
  type PdfSpaceRect
} from '@shared/pdf-content'
import { blankRanges, findXObjectCalls } from '@shared/pdf-content/content-stream'

// --- Фикстуры --------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/** RGB PNG без альфа-канала с градиентом, чтобы картинки отличались данными. */
function makePng(width: number, height: number, red: number): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw[y * row + 1 + x * 3] = red
      raw[y * row + 2 + x * 3] = (x * 8) & 255
      raw[y * row + 3 + x * 3] = (y * 8) & 255
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array(0))
  ])
}

const LOGO: PdfSpaceRect = { x: 100, y: 150, width: 128, height: 64 }
const BACKGROUND: PdfSpaceRect = { x: 40, y: 120, width: 320, height: 120 }

/**
 * Страница 1: три строки латиницей (две с обычным интерлиньяжем), фон-картинка,
 * поверх неё логотип и синий прямоугольник. Страница 2 повёрнута на 90°.
 * Страница 3: одна и та же картинка нарисована дважды.
 */
async function makeFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const background = await doc.embedPng(makePng(20, 10, 40))
  const logo = await doc.embedPng(makePng(32, 16, 200))

  const page = doc.addPage([400, 500])
  page.drawText('Hello brave world', { x: 50, y: 400, size: 18, font, color: rgb(0.8, 0.1, 0.1) })
  page.drawText('Second line stays', { x: 50, y: 378, size: 18, font })
  page.drawText('Footer note', { x: 50, y: 60, size: 10, font })
  page.drawImage(background, BACKGROUND)
  page.drawImage(logo, LOGO)
  page.drawRectangle({ x: 300, y: 20, width: 40, height: 40, color: rgb(0, 0, 1) })

  const rotated = doc.addPage([400, 500])
  rotated.setRotation(degrees(90))
  rotated.drawText('Rotated page text', { x: 60, y: 300, size: 14, font })

  // Своя копия логотипа, чтобы удаление со страницы 1 убирало картинку из файла.
  const shared = await doc.embedPng(makePng(32, 16, 120))
  const twice = doc.addPage([400, 500])
  twice.drawImage(shared, { x: 20, y: 20, width: 64, height: 32 })
  twice.drawImage(shared, { x: 200, y: 300, width: 64, height: 32 })
  twice.drawText('Two logos', { x: 20, y: 450, size: 12, font })
  return doc.save()
}

// --- Проверки через MuPDF --------------------------------------------------

function withMupdfPage<T>(bytes: Uint8Array, pageIndex: number, fn: (page: mupdf.PDFPage) => T): T {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const page = doc.loadPage(pageIndex)
    try {
      return fn(page)
    } finally {
      page.destroy()
    }
  } finally {
    doc.destroy()
  }
}

function found(bytes: Uint8Array, needle: string, pageIndex = 0): boolean {
  return withMupdfPage(bytes, pageIndex, (page) => page.search(needle, '').length > 0)
}

/** Имена картинок в /Resources /XObject страницы. */
function xobjectNames(bytes: Uint8Array, pageIndex = 0): string[] {
  return withMupdfPage(bytes, pageIndex, (page) => {
    const names: string[] = []
    const xobjects = page.getObject().getInheritable('Resources').get('XObject')
    if (xobjects.isDictionary()) {
      xobjects.forEach((_value, key) => names.push(String(key)))
    }
    return names.sort()
  })
}

/** Имя ресурса → размер картинки в пикселях, например { Im1: '20x10' }. */
function xobjectSizes(bytes: Uint8Array, pageIndex = 0): Record<string, string> {
  return withMupdfPage(bytes, pageIndex, (page) => {
    const sizes: Record<string, string> = {}
    const xobjects = page.getObject().getInheritable('Resources').get('XObject')
    if (xobjects.isDictionary()) {
      xobjects.forEach((value, key) => {
        sizes[String(key)] = `${value.get('Width').asNumber()}x${value.get('Height').asNumber()}`
      })
    }
    return sizes
  })
}

function countImageObjects(bytes: Uint8Array): number {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    let count = 0
    for (let num = 1; num < doc.countObjects(); num += 1) {
      const subtype = doc.newIndirect(num).get('Subtype')
      if (subtype.isName() && subtype.asName() === 'Image') count += 1
    }
    return count
  } finally {
    doc.destroy()
  }
}

function lineByText(objects: PageObjects, text: string): PageTextLine {
  const line = objects.lines.find((l) => l.text === text)
  if (!line)
    throw new Error(`нет строки «${text}» среди: ${objects.lines.map((l) => l.text).join(' | ')}`)
  return line
}

function imageBySize(objects: PageObjects, width: number, height: number): PageImage {
  const image = objects.images.find((i) => i.pixelWidth === width && i.pixelHeight === height)
  if (!image) throw new Error(`нет картинки ${width}×${height}`)
  return image
}

function expectRect(actual: PdfSpaceRect, expected: PdfSpaceRect, precision = 1): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
  expect(actual.width).toBeCloseTo(expected.width, precision)
  expect(actual.height).toBeCloseTo(expected.height, precision)
}

let fixture: Uint8Array
let objects: PageObjects

beforeAll(async () => {
  fixture = await makeFixture()
  objects = await listPageObjects(fixture, 0)
})

// --- Тесты -----------------------------------------------------------------

describe('content-stream', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

  it('находит вызовы Do с текущей матрицей и учитывает q/Q', () => {
    const stream = bytes(
      'q 2 0 0 2 10 20 cm q 50 0 0 25 1 1 cm /Im1 Do Q /Im2 Do Q (/Fake Do) Tj /Im3 Do'
    )
    const calls = findXObjectCalls(stream)
    expect(calls.map((c) => c.name)).toEqual(['Im1', 'Im2', 'Im3'])
    expect(calls[0]?.ctm).toEqual([100, 0, 0, 50, 12, 22])
    expect(calls[1]?.ctm).toEqual([2, 0, 0, 2, 10, 20])
    expect(calls[2]?.ctm).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('пропускает встроенные картинки и экранированные имена', () => {
    const stream = bytes('BI /W 1 /H 1 ID \x00Do\xff EI /A#20B Do')
    const calls = findXObjectCalls(stream)
    expect(calls.map((c) => c.name)).toEqual(['A B'])
  })

  it('стирает вызов, не сдвигая остальной поток', () => {
    const stream = bytes('q /Im1 Do Q')
    const [call] = findXObjectCalls(stream)
    if (!call) throw new Error('нет вызова')
    expect(new TextDecoder().decode(blankRanges(stream, [call]))).toBe('q         Q')
  })
})

describe('listPageObjects', () => {
  it('отдаёт строки со шрифтом, кеглем и цветом в координатах PDF', () => {
    expect(objects.pageBox).toEqual({ x: 0, y: 0, width: 400, height: 500 })
    expect(objects.lines.map((l) => l.text)).toEqual([
      'Hello brave world',
      'Second line stays',
      'Footer note'
    ])
    const hello = lineByText(objects, 'Hello brave world')
    expect(hello.origin.x).toBeCloseTo(50, 1)
    expect(hello.origin.y).toBeCloseTo(400, 1)
    expect(hello.direction).toEqual({ x: 1, y: 0 })
    expect(hello.fontName).toBe('Helvetica')
    expect(hello.fontSize).toBeCloseTo(18, 3)
    expect(hello.color[0]).toBeCloseTo(0.8, 1)
    expect(hello.color[1]).toBeCloseTo(0.1, 1)
    // Рамка строки охватывает базовую линию: снизу выносные, сверху прописные.
    expect(hello.rect.x).toBeCloseTo(50, 1)
    expect(hello.rect.y).toBeLessThan(400)
    expect(hello.rect.y + hello.rect.height).toBeGreaterThan(400 + 12)
  })

  it('отдаёт картинки с рамкой и размером в пикселях', () => {
    expect(objects.images).toHaveLength(2)
    expectRect(imageBySize(objects, 32, 16).rect, LOGO)
    expectRect(imageBySize(objects, 20, 10).rect, BACKGROUND)
  })

  it('на повёрнутой странице координаты остаются в неповёрнутом пространстве PDF', async () => {
    const rotated = await listPageObjects(fixture, 1)
    expect(rotated.pageBox).toEqual({ x: 0, y: 0, width: 400, height: 500 })
    const line = lineByText(rotated, 'Rotated page text')
    expect(line.origin.x).toBeCloseTo(60, 1)
    expect(line.origin.y).toBeCloseTo(300, 1)
    expect(line.direction.x).toBeCloseTo(1, 3)
  })

  it('отклоняет несуществующую страницу и не-PDF', async () => {
    await expect(listPageObjects(fixture, 5)).rejects.toBeInstanceOf(PdfContentError)
    await expect(listPageObjects(new TextEncoder().encode('not a pdf'), 0)).rejects.toThrow()
  })
})

describe('eraseRegions', () => {
  it('вырезает текст из файла, остальные строки на месте, исходный буфер не меняется', async () => {
    const before = fixture.slice()
    const hello = lineByText(objects, 'Hello brave world')
    const out = await eraseRegions(fixture, 0, [
      { x: hello.rect.x, y: 395, width: hello.rect.width, height: 10 }
    ])
    expect(fixture).toEqual(before)
    expect(found(out, 'Hello')).toBe(false)
    expect(found(out, 'brave')).toBe(false)
    expect(found(out, 'Second line stays')).toBe(true)
    expect(found(out, 'Footer note')).toBe(true)
    expect(found(fixture, 'Hello')).toBe(true)
    // Без заливки: на месте строки ничего не нарисовано, картинки не тронуты.
    expect((await listPageObjects(out, 0)).images).toHaveLength(2)
  })

  it('картинка целиком в области исчезает из ресурсов и из файла', async () => {
    expect(xobjectNames(fixture)).toHaveLength(2)
    const out = await eraseRegions(fixture, 0, [
      { x: LOGO.x - 1, y: LOGO.y - 1, width: LOGO.width + 2, height: LOGO.height + 2 }
    ])
    const after = await listPageObjects(out, 0)
    expect(after.images.map((i) => [i.pixelWidth, i.pixelHeight])).toEqual([[20, 10]])
    expect(xobjectNames(out)).toHaveLength(1)
    expect(countImageObjects(out)).toBe(countImageObjects(fixture) - 1)
    expect(found(out, 'Hello brave world')).toBe(true)
  })

  it('с text: false текст в области остаётся', async () => {
    const out = await eraseRegions(fixture, 0, [{ x: 40, y: 370, width: 300, height: 50 }], {
      text: false
    })
    expect(found(out, 'Hello brave world')).toBe(true)
  })

  it('не применяет чужие неприменённые redaction-аннотации', async () => {
    // Разметка под удаление, сделанная в другой программе, — над строкой «Footer note».
    const doc = new mupdf.PDFDocument(fixture)
    const page = doc.loadPage(0)
    page.createAnnotation('Redact').setRect([40, 425, 200, 450])
    page.update()
    const buffer = doc.saveToBuffer('')
    const marked = buffer.asUint8Array().slice()
    buffer.destroy()
    page.destroy()
    doc.destroy()

    const out = await eraseRegions(marked, 0, [{ x: 300, y: 450, width: 50, height: 30 }])
    expect(found(out, 'Footer note')).toBe(true)
    const redacts = withMupdfPage(out, 0, (p) =>
      p.getAnnotations().filter((a) => a.getType() === 'Redact')
    )
    expect(redacts).toHaveLength(1)
  })

  it('отклоняет пустую область', async () => {
    await expect(
      eraseRegions(fixture, 0, [{ x: 0, y: 0, width: 0, height: 10 }])
    ).rejects.toBeInstanceOf(PdfContentError)
  })
})

describe('replaceText', () => {
  it('меняет строку латиницей тем же шрифтом, кеглем и цветом', async () => {
    const hello = lineByText(objects, 'Hello brave world')
    const out = await replaceText(fixture, 0, hello, 'Goodbye cruel world')
    expect(found(out, 'Hello')).toBe(false)
    expect(found(out, 'Goodbye cruel world')).toBe(true)
    expect(found(out, 'Second line stays')).toBe(true)

    const line = lineByText(await listPageObjects(out, 0), 'Goodbye cruel world')
    // Тот же шрифт: стандартный Helvetica MuPDF встраивает своей копией Nimbus Sans.
    expect(line.fontName).toMatch(/^(Helvetica|NimbusSans-Regular)$/)
    expect(line.fontSize).toBeCloseTo(18, 3)
    expect(line.origin.x).toBeCloseTo(50, 1)
    expect(line.origin.y).toBeCloseTo(400, 1)
    expect(line.color[0]).toBeCloseTo(0.8, 1)
    expect(line.color[1]).toBeCloseTo(0.1, 1)
  })

  it('пишет кириллицу запасным шрифтом того же кегля и цвета', async () => {
    const hello = lineByText(objects, 'Hello brave world')
    const out = await replaceText(fixture, 0, hello, 'Привет, мир')
    expect(found(out, 'Hello')).toBe(false)
    expect(found(out, 'Привет, мир')).toBe(true)
    expect(found(out, 'Second line stays')).toBe(true)

    const line = lineByText(await listPageObjects(out, 0), 'Привет, мир')
    expect(line.fontSize).toBeCloseTo(18, 3)
    expect(line.origin.y).toBeCloseTo(400, 1)
    expect(line.color[0]).toBeCloseTo(0.8, 1)
  })

  it('заменяет строку повторно в уже изменённом документе', async () => {
    const first = await replaceText(fixture, 0, lineByText(objects, 'Footer note'), 'Сноска')
    const second = await replaceText(
      first,
      0,
      lineByText(await listPageObjects(first, 0), 'Сноска'),
      'Footnote'
    )
    expect(found(second, 'Сноска')).toBe(false)
    expect(found(second, 'Footer')).toBe(false)
    expect(found(second, 'Footnote')).toBe(true)
  })

  it('removeTextLine вырезает строку целиком', async () => {
    const out = await removeTextLine(fixture, 0, lineByText(objects, 'Second line stays'))
    expect(found(out, 'Second')).toBe(false)
    expect(found(out, 'Hello brave world')).toBe(true)
    expect((await listPageObjects(out, 0)).lines.map((l) => l.text)).toEqual([
      'Hello brave world',
      'Footer note'
    ])
  })

  it('не находит строку, если документ изменился', async () => {
    const stale = { text: 'Hello brave world', rect: { x: 200, y: 50, width: 10, height: 10 } }
    await expect(replaceText(fixture, 0, stale, 'x')).rejects.toBeInstanceOf(PdfContentError)
  })
})

describe('картинки', () => {
  it('removeImage удаляет только выбранную картинку', async () => {
    const out = await removeImage(fixture, 0, imageBySize(objects, 32, 16))
    const after = await listPageObjects(out, 0)
    expect(after.images).toHaveLength(1)
    // Фон под логотипом не испорчен: та же картинка в той же рамке и тех же данных.
    expectRect(imageBySize(after, 20, 10).rect, BACKGROUND)
    // Ресурс фона тот же (redaction переименовал бы ресурсы и пересобрал картинку).
    const backgroundOnly = Object.entries(xobjectSizes(fixture)).filter(
      ([, size]) => size === '20x10'
    )
    expect(Object.entries(xobjectSizes(out))).toEqual(backgroundOnly)
    expect(countImageObjects(out)).toBe(countImageObjects(fixture) - 1)
    expect(found(out, 'Hello brave world')).toBe(true)
  })

  it('removeImage оставляет второй вызов той же картинки', async () => {
    const page = await listPageObjects(fixture, 2)
    const [first] = page.images
    if (!first) throw new Error('нет картинки')
    const out = await removeImage(fixture, 2, first)
    const after = await listPageObjects(out, 2)
    expect(after.images).toHaveLength(1)
    expectRect(after.images[0]?.rect ?? first.rect, { x: 200, y: 300, width: 64, height: 32 })
    expect(xobjectNames(out, 2)).toHaveLength(1)
  })

  it('replaceImage вписывает новую картинку в прежнюю рамку', async () => {
    const out = await replaceImage(fixture, 0, imageBySize(objects, 32, 16), makePng(40, 40, 90))
    const after = await listPageObjects(out, 0)
    expect(after.images.some((i) => i.pixelWidth === 32)).toBe(false)
    // 40×40 в рамке 128×64 — квадрат 64×64 по центру.
    expectRect(imageBySize(after, 40, 40).rect, { x: 132, y: 150, width: 64, height: 64 })
    expect(xobjectNames(out)).toHaveLength(2)
    expect(countImageObjects(out)).toBe(countImageObjects(fixture))
  })

  it('replaceImage отклоняет не картинку', async () => {
    await expect(
      replaceImage(fixture, 0, imageBySize(objects, 32, 16), new TextEncoder().encode('nope'))
    ).rejects.toBeInstanceOf(PdfContentError)
  })

  it('moveImage переносит картинку без перекодирования', async () => {
    const target: PdfSpaceRect = { x: 20, y: 300, width: 64, height: 32 }
    const out = await moveImage(fixture, 0, imageBySize(objects, 32, 16), target)
    const after = await listPageObjects(out, 0)
    expectRect(imageBySize(after, 32, 16).rect, target)
    expectRect(imageBySize(after, 20, 10).rect, BACKGROUND)
    expect(xobjectNames(out)).toEqual(xobjectNames(fixture))
    expect(countImageObjects(out)).toBe(countImageObjects(fixture))
  })
})
