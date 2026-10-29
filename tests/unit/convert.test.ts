import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  orientedSize,
  readImageInfo,
  sniffImageKind,
  withJpegDpi,
  withPngDpi,
  type ExifOrientation
} from '@shared/convert/image-info'
import {
  A4,
  imagesToPdf,
  layoutImagePage,
  naturalSizePt,
  orientationMatrix
} from '@shared/convert/images-to-pdf'
import { compressionGain } from '@shared/convert/compress-gain'
import { pageImageName, pageImageSize, pagesFromSpec } from '@shared/convert/page-images'
import { encodeTextFile, isBlankText, joinPagesText } from '@shared/convert/text-file'
import { compressPdf, extractText, linesToText } from '@shared/pdf-content'
import { PageRangeError } from '@shared/pdf-ops'

// --- Фикстуры --------------------------------------------------------------

type Rgb = [number, number, number]

/** Картинка из двух половин: левая и правая (или верхняя и нижняя) разного цвета. */
function halves(width: number, height: number, a: Rgb, b: Rgb, split: 'x' | 'y'): mupdf.Pixmap {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  const pixels = pixmap.getPixels()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const first = split === 'x' ? x < width / 2 : y < height / 2
      const [r, g, bl] = first ? a : b
      const at = (y * width + x) * 3
      pixels[at] = r
      pixels[at + 1] = g
      pixels[at + 2] = bl
    }
  }
  return pixmap
}

/** «Фотография»: плавный градиент с шумом — так JPEG и PNG ведут себя как на настоящих снимках. */
function photo(width: number, height: number, seed = 1): mupdf.Pixmap {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  const pixels = pixmap.getPixels()
  let state = seed
  const noise = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return (state >> 16) % 24
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3
      pixels[at] = ((x * 255) / width + noise()) & 255
      pixels[at + 1] = ((y * 255) / height + noise()) & 255
      pixels[at + 2] = (128 + noise()) & 255
    }
  }
  return pixmap
}

function jpeg(pixmap: mupdf.Pixmap, quality = 90): Uint8Array {
  return pixmap.asJPEG(quality).slice()
}

function png(pixmap: mupdf.Pixmap): Uint8Array {
  return pixmap.asPNG().slice()
}

/** Вставляет APP1 Exif с тегом Orientation сразу после SOI. */
function withExifOrientation(bytes: Uint8Array, orientation: ExifOrientation): Uint8Array {
  const tiff = new Uint8Array(26)
  const view = new DataView(tiff.buffer)
  tiff.set([0x49, 0x49, 0x2a, 0x00])
  view.setUint32(4, 8, true)
  view.setUint16(8, 1, true)
  view.setUint16(10, 0x0112, true)
  view.setUint16(12, 3, true)
  view.setUint32(14, 1, true)
  view.setUint16(18, orientation, true)
  view.setUint32(22, 0, true)
  const body = new Uint8Array([...new TextEncoder().encode('Exif'), 0, 0, ...tiff])
  const app1 = new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255])
  const out = new Uint8Array(bytes.length + app1.length + body.length)
  out.set(bytes.subarray(0, 2))
  out.set(app1, 2)
  out.set(body, 2 + app1.length)
  out.set(bytes.subarray(2), 2 + app1.length + body.length)
  return out
}

/** Цвет пикселя страницы в долях её размера после рендера MuPDF. */
function sample(bytes: Uint8Array, pageIndex: number, points: [number, number][]): Rgb[] {
  const doc = new mupdf.PDFDocument(bytes)
  const page = doc.loadPage(pageIndex)
  const pixmap = page.toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceRGB, false)
  const width = pixmap.getWidth()
  const height = pixmap.getHeight()
  const pixels = pixmap.getPixels()
  const result = points.map(([fx, fy]): Rgb => {
    const at = (Math.floor(fy * height) * width + Math.floor(fx * width)) * 3
    return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0]
  })
  pixmap.destroy()
  page.destroy()
  doc.destroy()
  return result
}

function isReddish([r, g, b]: Rgb): boolean {
  return r > 180 && g < 90 && b < 90
}

function isBluish([r, g, b]: Rgb): boolean {
  return b > 180 && r < 90 && g < 90
}

const RED: Rgb = [230, 20, 20]
const NONE: Rgb = [0, 0, 0]
const BLUE: Rgb = [20, 20, 230]

async function pdfPageSize(bytes: Uint8Array, index: number): Promise<[number, number]> {
  const doc = await PDFDocument.load(bytes)
  const { width, height } = doc.getPage(index).getSize()
  return [Math.round(width * 100) / 100, Math.round(height * 100) / 100]
}

// --- Заголовки картинок -----------------------------------------------------

describe('image-info', () => {
  it('читает размер, плотность и ориентацию JPEG и PNG', () => {
    const source = halves(40, 30, RED, BLUE, 'x')
    const jpg = jpeg(source)
    expect(sniffImageKind(jpg)).toBe('jpeg')
    expect(readImageInfo(jpg)).toMatchObject({ kind: 'jpeg', width: 40, height: 30 })

    const rotated = withExifOrientation(jpg, 6)
    const info = readImageInfo(rotated)
    expect(info.orientation).toBe(6)
    expect(orientedSize(info)).toEqual({ width: 30, height: 40 })

    expect(readImageInfo(withJpegDpi(jpg, 300)).dpi).toBe(300)
    expect(readImageInfo(withJpegDpi(rotated, 150))).toMatchObject({ dpi: 150, orientation: 6 })

    const pic = png(source)
    expect(readImageInfo(pic)).toMatchObject({ kind: 'png', width: 40, height: 30 })
    const dense = withPngDpi(pic, 300)
    expect(readImageInfo(dense).dpi).toBe(300)
    expect(readImageInfo(withPngDpi(dense, 72)).dpi).toBe(72)
    // MuPDF читает PNG с новым чанком pHYs — CRC верный.
    const decoded = new mupdf.Image(dense)
    expect(decoded.getXResolution()).toBe(300)
    decoded.destroy()
    source.destroy()
  })

  it('узнаёт WebP и отклоняет незнакомые форматы', () => {
    const webp = new Uint8Array([
      ...new TextEncoder().encode('RIFF'),
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode('WEBPVP8 ')
    ])
    expect(sniffImageKind(webp)).toBe('webp')
    expect(() => readImageInfo(new Uint8Array([1, 2, 3, 4]))).toThrow(/PNG и JPEG/)
  })
})

// --- Изображения в PDF ------------------------------------------------------

describe('изображения в PDF', () => {
  it('матрица EXIF переводит углы картинки в углы показанной картинки', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 }
    const apply = (m: number[], u: number, v: number): [number, number] => [
      (m[0] ?? 0) * u + (m[2] ?? 0) * v + (m[4] ?? 0),
      (m[1] ?? 0) * u + (m[3] ?? 0) * v + (m[5] ?? 0)
    ]
    // Куда попадает верхний левый угол хранимой картинки (u=0, v=1).
    const topLeft: Record<ExifOrientation, [number, number]> = {
      1: [10, 70],
      2: [110, 70],
      3: [110, 20],
      4: [10, 20],
      5: [10, 70],
      6: [110, 70],
      7: [110, 20],
      8: [10, 20]
    }
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      expect(apply(orientationMatrix(o, rect), 0, 1)).toEqual(topLeft[o])
    }
  })

  it('раскладывает страницу по картинке и в A4 с полями и ориентацией', () => {
    expect(
      layoutImagePage({ width: 300, height: 200 }, { pageSize: 'image', marginMm: 10 })
    ).toEqual({ width: 300, height: 200, rect: { x: 0, y: 0, width: 300, height: 200 } })
    const huge = layoutImagePage(
      { width: 40_000, height: 20_000 },
      { pageSize: 'image', marginMm: 0 }
    )
    expect(huge.width).toBe(14_400)
    expect(huge.height).toBe(7_200)

    const portrait = layoutImagePage({ width: 1000, height: 2000 }, { pageSize: 'a4', marginMm: 0 })
    expect([portrait.width, portrait.height]).toEqual([A4.width, A4.height])
    expect(portrait.rect.height).toBeCloseTo(A4.height)
    expect(portrait.rect.y).toBeCloseTo(0)

    const landscape = layoutImagePage(
      { width: 1600, height: 1200 },
      { pageSize: 'a4', marginMm: 15 }
    )
    expect([landscape.width, landscape.height]).toEqual([A4.height, A4.width])
    const margin = (15 * 72) / 25.4
    expect(landscape.rect.y).toBeCloseTo(margin)
    expect(landscape.rect.height).toBeCloseTo(A4.width - 2 * margin)
    expect(landscape.rect.width / landscape.rect.height).toBeCloseTo(4 / 3)
    expect(landscape.rect.x + landscape.rect.width / 2).toBeCloseTo(A4.height / 2)

    // Маленькая картинка (30×30 px при 96 dpi) не растягивается на всю страницу.
    const tiny = layoutImagePage({ width: 22.5, height: 22.5 }, { pageSize: 'a4', marginMm: 15 })
    expect([tiny.width, tiny.height]).toEqual([A4.width, A4.height])
    expect(tiny.rect.width).toBeCloseTo(22.5)
    expect(tiny.rect.height).toBeCloseTo(22.5)
    expect(tiny.rect.x + tiny.rect.width / 2).toBeCloseTo(A4.width / 2)
    expect(tiny.rect.y + tiny.rect.height / 2).toBeCloseTo(A4.height / 2)
  })

  it('размер «по картинке» берётся из dpi файла, иначе 96 dpi', () => {
    const jpg = jpeg(halves(300, 600, RED, BLUE, 'y'))
    expect(naturalSizePt(readImageInfo(jpg))).toEqual({ width: 225, height: 450 })
    expect(naturalSizePt(readImageInfo(withJpegDpi(jpg, 300)))).toEqual({ width: 72, height: 144 })
  })

  // Скорость проверяет порог для imagesToPdf, а общий лимит теста шире 5 с по умолчанию:
  // подготовка десяти JPEG на медленной Intel-машине CI (macos-15-intel) идёт дольше.
  it('десять фотографий складываются в документ быстро и в заданном порядке', async () => {
    const photos = Array.from({ length: 10 }, (_, i) => {
      const pixmap = photo(i % 2 === 0 ? 1600 : 1200, i % 2 === 0 ? 1200 : 1600, i + 1)
      const bytes = jpeg(pixmap, 85)
      pixmap.destroy()
      return { name: `photo${i + 1}.jpg`, bytes }
    })
    const started = performance.now()
    const bytes = await imagesToPdf(photos, { pageSize: 'a4', marginMm: 10 })
    expect(performance.now() - started).toBeLessThan(5_000)
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getPageCount()).toBe(10)
    expect(await pdfPageSize(bytes, 0)).toEqual([841.89, 595.28])
    expect(await pdfPageSize(bytes, 1)).toEqual([595.28, 841.89])
    // JPEG встроен без пересжатия: файл не больше суммы снимков с небольшим запасом.
    const total = photos.reduce((sum, p) => sum + p.bytes.length, 0)
    expect(bytes.length).toBeLessThan(total + 20_000)
    expect(doc.getProducer()).toBe('PDFwright')
  }, 30_000)

  it('поворачивает JPEG по EXIF и встраивает PNG', async () => {
    // Хранится: слева красное, справа синее. Ориентация 6 — повернуть на 90° по часовой:
    // на странице красное сверху, синее снизу, страница книжная.
    const stored = halves(400, 300, RED, BLUE, 'x')
    const rotated = withExifOrientation(jpeg(stored, 95), 6)
    const plain = png(halves(200, 100, RED, BLUE, 'y'))
    stored.destroy()
    const bytes = await imagesToPdf(
      [
        { name: 'rotated.jpg', bytes: rotated },
        { name: 'plain.png', bytes: plain }
      ],
      { pageSize: 'image', marginMm: 0 }
    )
    expect(await pdfPageSize(bytes, 0)).toEqual([225, 300])
    const [top = NONE, bottom = NONE] = sample(bytes, 0, [
      [0.5, 0.2],
      [0.5, 0.8]
    ])
    expect(isReddish(top)).toBe(true)
    expect(isBluish(bottom)).toBe(true)

    expect(await pdfPageSize(bytes, 1)).toEqual([150, 75])
    const [pngTop = NONE, pngBottom = NONE] = sample(bytes, 1, [
      [0.5, 0.2],
      [0.5, 0.8]
    ])
    expect(isReddish(pngTop)).toBe(true)
    expect(isBluish(pngBottom)).toBe(true)
  })

  it('называет файл, который не удалось прочитать', async () => {
    await expect(
      imagesToPdf(
        [{ name: 'broken.png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]) }],
        {
          pageSize: 'a4',
          marginMm: 0
        }
      )
    ).rejects.toThrow(/broken\.png/)
    await expect(imagesToPdf([], { pageSize: 'a4', marginMm: 0 })).rejects.toThrow(/хотя бы одну/)
  })
})

describe('compressionGain', () => {
  it('меньше 1 % — не выигрыш: «Применить» не предлагается', () => {
    expect(compressionGain({ before: 100_000, after: 99_800 })).toBeNull()
    expect(compressionGain({ before: 100_000, after: 100_000 })).toBeNull()
    expect(compressionGain({ before: 100_000, after: 120_000 })).toBeNull()
    expect(compressionGain({ before: 0, after: 0 })).toBeNull()
    expect(compressionGain({ before: 100_000, after: 98_000 })).toBe(2)
    expect(compressionGain({ before: 8_100_000, after: 179_000 })).toBe(98)
  })
})

// --- PDF в изображения -------------------------------------------------------

describe('PDF в изображения: расчёты', () => {
  it('размер картинки соответствует DPI', () => {
    expect(pageImageSize(A4.width, A4.height, 150)).toEqual({ width: 1240, height: 1754 })
    expect(pageImageSize(A4.width, A4.height, 300)).toEqual({ width: 2480, height: 3508 })
    expect(pageImageSize(612, 792, 72)).toEqual({ width: 612, height: 792 })
  })

  it('выбирает страницы по диапазонам без повторов', () => {
    expect(pagesFromSpec(null, 3)).toEqual([1, 2, 3])
    expect(pagesFromSpec('3, 1-2, 2', 5)).toEqual([3, 1, 2])
    expect(pagesFromSpec('4-', 5)).toEqual([4, 5])
    expect(() => pagesFromSpec('7', 5)).toThrow(PageRangeError)
  })

  it('дополняет номер страницы нулями до ширины общего числа', () => {
    expect(pageImageName('Отчёт', 7, 120, 'png')).toBe('Отчёт_стр007.png')
    expect(pageImageName('Отчёт', 2, 9, 'jpeg')).toBe('Отчёт_стр2.jpg')
  })
})

// --- Текст --------------------------------------------------------------------

describe('извлечение текста', () => {
  it('упорядочивает строки сверху вниз и склеивает куски одной строки', () => {
    const text = linesToText([
      { text: 'Третья строка', box: [50, 60, 200, 74] },
      { text: 'Первая', box: [50, 20, 100, 34] },
      { text: 'Вторая строка', box: [50, 40, 200, 54] },
      { text: 'справа', box: [104, 21, 150, 33] },
      { text: 'Итого', box: [50, 120, 90, 134] },
      { text: '100 ₽', box: [300, 120, 340, 134] },
      { text: '   ', box: [0, 200, 10, 210] }
    ])
    expect(text).toBe('Первая справа\nВторая строка\nТретья строка\n\nИтого\t100 ₽')
  })

  it('склеивает страницы и кодирует файл в UTF-8 с BOM и CRLF', () => {
    const pages = [
      { page: 1, text: 'Строка 1\nСтрока 2\n' },
      { page: 3, text: '' },
      { page: 4, text: 'Конец' }
    ]
    expect(joinPagesText(pages, false)).toBe('Строка 1\nСтрока 2\n\nКонец\n')
    expect(joinPagesText(pages, true)).toBe(
      '— Страница 1 —\n\nСтрока 1\nСтрока 2\n\n— Страница 3 —\n\n— Страница 4 —\n\nКонец\n'
    )
    expect(isBlankText([{ page: 1, text: ' \n ' }])).toBe(true)
    const file = encodeTextFile('Привет\nмир')
    expect([...file.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(file.subarray(3))).toBe('Привет\r\nмир')
  })

  it('совпадает с эталоном: кириллица, порядок строк не по потоку, выбранные страницы', async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(
      readFileSync(
        resolve(import.meta.dirname, '../../src/renderer/public/fonts/PTSans-Regular.ttf')
      ),
      { subset: true }
    )
    const first = doc.addPage([400, 400])
    // В потоке строки идут не по порядку: 1, 3, 2; затем абзац ниже.
    first.drawText('Первая строка', { x: 40, y: 340, size: 14, font })
    first.drawText('Третья строка', { x: 40, y: 300, size: 14, font })
    first.drawText('Вторая строка', { x: 40, y: 320, size: 14, font })
    first.drawText('Новый абзац', { x: 40, y: 240, size: 14, font })
    const second = doc.addPage([400, 400])
    second.drawText('Вторая страница', { x: 40, y: 340, size: 14, font })
    const third = doc.addPage([400, 400])
    third.drawText('Third page', { x: 40, y: 340, size: 14, font })
    const bytes = await doc.save()

    expect(await extractText(bytes)).toEqual([
      'Первая строка\nВторая строка\nТретья строка\n\nНовый абзац',
      'Вторая страница',
      'Third page'
    ])
    expect(await extractText(bytes, [2, 0])).toEqual([
      'Third page',
      'Первая строка\nВторая строка\nТретья строка\n\nНовый абзац'
    ])
    await expect(extractText(bytes, [5])).rejects.toThrow(/Страницы 6 нет/)
  })
})

// --- Сжатие -------------------------------------------------------------------

describe('сжатие', () => {
  async function scanFixture(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([A4.width, A4.height])
    // «Скан» ~180 dpi без потерь: верх красный, низ синий, по всему полю шум.
    const scan = photo(1500, 2122, 7)
    const pixels = scan.getPixels()
    for (let i = 0; i < pixels.length; i += 3) {
      const top = i < pixels.length / 2
      pixels[i] = top ? 230 : 20
      pixels[i + 1] = (pixels[i + 1] ?? 0) % 40
      pixels[i + 2] = top ? 20 : 230
    }
    const image = await doc.embedPng(png(scan))
    scan.destroy()
    page.drawImage(image, { x: 0, y: 0, width: A4.width, height: A4.height })
    page.drawText('Scanned page caption', { x: 40, y: 40, size: 12, font })
    // Картинка с прозрачностью: маска SMask не пересжимается.
    const alpha = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 300, 300], true)
    alpha.clear(128)
    const logo = await doc.embedPng(png(alpha))
    alpha.destroy()
    page.drawImage(logo, { x: 400, y: 700, width: 100, height: 100 })
    return doc.save()
  }

  it('уменьшает файл со сканом и не трогает текст', async () => {
    const bytes = await scanFixture()
    const result = await compressPdf(bytes, 'medium')
    expect(result.before).toBe(bytes.length)
    expect(result.after).toBe(result.bytes.length)
    expect(result.after).toBeLessThan(bytes.length / 4)
    expect(result.images).toBe(2)
    expect(result.recompressed).toBeGreaterThanOrEqual(1)

    expect(await extractText(result.bytes)).toEqual(await extractText(bytes))
    const [top = NONE, bottom = NONE] = sample(result.bytes, 0, [
      [0.5, 0.2],
      [0.5, 0.7]
    ])
    expect(isReddish(top)).toBe(true)
    expect(isBluish(bottom)).toBe(true)

    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false })
    expect(reopened.getPageCount()).toBe(1)
    expect(reopened.getProducer()).toBe('PDFwright')

    const strong = await compressPdf(bytes, 'strong')
    const light = await compressPdf(bytes, 'light')
    expect(strong.after).toBeLessThan(result.after)
    expect(light.after).toBeGreaterThan(result.after)
  }, 60_000)

  it('не портит текстовый PDF и не увеличивает его', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.TimesRoman)
    for (let p = 0; p < 3; p += 1) {
      const page = doc.addPage([A4.width, A4.height])
      for (let line = 0; line < 30; line += 1) {
        page.drawText(
          `Page ${p + 1}, line ${line + 1}: the quick brown fox jumps over the lazy dog`,
          {
            x: 40,
            y: 800 - line * 24,
            size: 11,
            font
          }
        )
      }
    }
    const bytes = await doc.save()
    const result = await compressPdf(bytes, 'strong')
    expect(result.after).toBeLessThanOrEqual(bytes.length)
    expect(result.images).toBe(0)
    expect(await extractText(result.bytes)).toEqual(await extractText(bytes))
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3)
  })
})
