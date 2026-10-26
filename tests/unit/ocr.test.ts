import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { concatTransformationMatrix, degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { createWorker, OEM } from 'tesseract.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addOcrTextLayer,
  ocrWordsFromBlocks,
  type OcrPageText,
  type OcrWord
} from '@shared/pdf-ops/ocr-layer'

const ROOT = resolve(import.meta.dirname, '../..')
/** Разрешение картинки «скана» в тестах. */
const DPI = 200

let font: Uint8Array
let langDir: string

beforeAll(async () => {
  font = new Uint8Array(
    await readFile(resolve(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  )
  // Языковые данные из тех же пакетов, что копируются в программу; tesseract
  // берёт все языки из одной папки.
  langDir = await mkdtemp(join(tmpdir(), 'pdfwright-ocr-'))
  for (const lang of ['rus', 'eng']) {
    await copyFile(
      resolve(
        ROOT,
        `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`
      ),
      join(langDir, `${lang}.traineddata.gz`)
    )
  }
})

afterAll(async () => {
  await rm(langDir, { recursive: true, force: true })
})

/** PDF с настоящим текстом: из него рисуется картинка «скана». */
async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const sans = await doc.embedFont(font)
  const page = doc.addPage([420, 200])
  page.drawText('Привет, мир сканов', { x: 30, y: 130, size: 26, font: sans })
  page.drawText('PDFwright recognizes text', { x: 30, y: 70, size: 26, font: sans })
  return doc.save()
}

function renderPng(bytes: Uint8Array, dpi: number): { png: Uint8Array; pixels: Uint8ClampedArray } {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const page = doc.loadPage(0)
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(dpi / 72, dpi / 72),
      mupdf.ColorSpace.DeviceRGB,
      false
    )
    const result = { png: pixmap.asPNG(), pixels: pixmap.getPixels().slice() }
    pixmap.destroy()
    page.destroy()
    return result
  } finally {
    doc.destroy()
  }
}

/** «Скан»: страница из одной картинки, текста в документе нет. */
async function scanPdf(png: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([width, height])
  const image = await doc.embedPng(png)
  page.drawImage(image, { x: 0, y: 0, width, height })
  return doc.save()
}

async function recognize(png: Uint8Array, langs: string): Promise<OcrWord[]> {
  const worker = await createWorker(langs, OEM.LSTM_ONLY, {
    langPath: langDir,
    gzip: true,
    cacheMethod: 'none'
  })
  try {
    const result = await worker.recognize(Buffer.from(png), {}, { blocks: true })
    return ocrWordsFromBlocks(result.data.blocks)
  } finally {
    await worker.terminate()
  }
}

function withPage<T>(bytes: Uint8Array, fn: (page: mupdf.PDFPage) => T): T {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const page = doc.loadPage(0)
    try {
      return fn(page)
    } finally {
      page.destroy()
    }
  } finally {
    doc.destroy()
  }
}

/** Рамка первого найденного вхождения в координатах страницы MuPDF (пункты, сверху вниз). */
function searchBox(bytes: Uint8Array, needle: string): [number, number, number, number] | null {
  return withPage(bytes, (page) => {
    const quad = page.search(needle, '')[0]?.[0]
    if (!quad) return null
    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  })
}

function pageText(bytes: Uint8Array): string {
  return withPage(bytes, (page) => page.toStructuredText('').asText())
}

describe('распознавание tesseract.js (17.1)', () => {
  it('находит русские и английские слова на картинке с известным текстом', async () => {
    const { png } = renderPng(await textPdf(), DPI)
    const words = await recognize(png, 'rus+eng')
    const texts = words.map((w) => w.text)
    expect(texts).toContain('Привет,')
    expect(texts).toContain('сканов')
    expect(texts).toContain('PDFwright')
    expect(texts).toContain('recognizes')
    // Рамки — в пикселях картинки и в порядке чтения: русская строка выше английской.
    const privet = words.find((w) => w.text === 'Привет,')
    const pdfwright = words.find((w) => w.text === 'PDFwright')
    expect(privet && pdfwright && privet.y1 < pdfwright.y0).toBe(true)
    expect(privet && privet.x0 > 30 * (DPI / 72) * 0.8 && privet.x0 < 30 * (DPI / 72) * 1.2).toBe(
      true
    )
  }, 60_000)

  it('ocrWordsFromBlocks пропускает пустые слова и рамки без площади', () => {
    const bbox = { x0: 1, y0: 1, x1: 10, y1: 10 }
    const words = ocrWordsFromBlocks([
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  { text: ' слово ', bbox },
                  { text: '  ', bbox },
                  { text: 'x', bbox: { x0: 5, y0: 5, x1: 5, y1: 9 } }
                ]
              }
            ]
          }
        ]
      }
    ])
    expect(words).toEqual([{ text: 'слово', ...bbox }])
    expect(ocrWordsFromBlocks(null)).toEqual([])
  })
})

describe('невидимый текстовый слой (17.2)', () => {
  it('после распознавания скана MuPDF находит слова, а растр страницы не меняется', async () => {
    const source = renderPng(await textPdf(), DPI)
    const scan = await scanPdf(source.png, 420, 200)
    expect(pageText(scan).trim()).toBe('')
    const words = await recognize(source.png, 'rus+eng')
    const width = Math.round((420 * DPI) / 72)
    const height = Math.round((200 * DPI) / 72)
    const result = await addOcrTextLayer(scan, [{ page: 1, width, height, words }], { font })

    expect(searchBox(result, 'сканов')).not.toBeNull()
    expect(searchBox(result, 'recognizes')).not.toBeNull()
    // Между словами одной строки при извлечении — пробелы, строки — отдельно.
    const text = pageText(result)
    expect(text).toContain('PDFwright recognizes text')
    expect(text).toContain('мир сканов')
    // Слово найдено там, где оно на картинке: рамка поиска ≈ рамка OCR.
    const ocr = words.find((w) => w.text === 'recognizes')
    const box = searchBox(result, 'recognizes')
    expect(ocr && box).toBeTruthy()
    if (ocr && box) {
      const k = 72 / DPI
      expect(Math.abs(box[0] - ocr.x0 * k)).toBeLessThan(1.5)
      expect(Math.abs(box[2] - ocr.x1 * k)).toBeLessThan(1.5)
      expect(Math.abs(box[1] - ocr.y0 * k)).toBeLessThan(3)
      expect(Math.abs(box[3] - ocr.y1 * k)).toBeLessThan(3)
    }
    // Невидимый текст не рисуется: пиксели до и после совпадают.
    const before = renderPng(scan, 72).pixels
    const after = renderPng(result, 72).pixels
    expect(after.length).toBe(before.length)
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true)
  }, 60_000)

  it.each([0, 90, 180, 270])('слово встаёт на место на странице с /Rotate %i', async (angle) => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 500])
    page.setRotation(degrees(angle))
    const helvetica = await doc.embedFont(StandardFonts.Helvetica)
    // Чужое содержимое со сдвинутой матрицей без восстановления не должно сдвинуть слой.
    page.drawText(' ', { x: 10, y: 10, size: 4, font: helvetica })
    page.pushOperators(concatTransformationMatrix(2, 0, 0, 2, 40, 40))
    const bytes = await doc.save()
    const [viewW, viewH] = angle % 180 === 0 ? [300, 500] : [500, 300]
    // Картинка вида в 2 раза крупнее пунктов.
    const word = { text: 'Повёрнуто', x0: 100, y0: 60, x1: 300, y1: 100 }
    const pages: OcrPageText[] = [{ page: 1, width: viewW * 2, height: viewH * 2, words: [word] }]
    const result = await addOcrTextLayer(bytes, pages, { font })
    const box = searchBox(result, 'Повёрнуто')
    expect(box).not.toBeNull()
    if (box) {
      expect(box[0]).toBeCloseTo(50, 0)
      expect(box[2]).toBeCloseTo(150, 0)
      expect(Math.abs(box[1] - 30)).toBeLessThan(2)
      expect(Math.abs(box[3] - 50)).toBeLessThan(2)
    }
  })

  it('без слов возвращает исходные байты, чужую страницу отвергает', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    const bytes = await doc.save()
    expect(
      await addOcrTextLayer(bytes, [{ page: 1, width: 10, height: 10, words: [] }], { font })
    ).toBe(bytes)
    const word = { text: 'a', x0: 0, y0: 0, x1: 5, y1: 5 }
    await expect(
      addOcrTextLayer(bytes, [{ page: 2, width: 10, height: 10, words: [word] }], { font })
    ).rejects.toThrow(/2/)
  })
})
