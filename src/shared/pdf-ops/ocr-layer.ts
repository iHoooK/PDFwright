import { m } from '../messages'
import fontkit from '@pdf-lib/fontkit'
import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFOperator
} from 'pdf-lib'
import { load, PdfOpsError, save } from './document'

/**
 * Невидимый текстовый слой распознанного скана (фаза 17). Слова с рамками
 * от OCR дописываются на страницу текстом в режиме отрисовки 3 (`3 Tr`):
 * на экране и при печати страница не меняется, а поиск, выделение и
 * копирование находят слова там, где они видны на картинке.
 *
 * Рамки слов — в пикселях картинки страницы, какой её показывает просмотр:
 * с учётом /Rotate, начало координат в левом верхнем углу. Шрифт — PT Sans
 * (кириллица и латиница), встраивается подмножеством; размер шрифта
 * подбирается по высоте рамки, сжатие по ширине (Tz) — по её ширине, так
 * что рамка выделения совпадает со словом на картинке.
 */

export interface OcrWord {
  text: string
  /** Левый верхний угол рамки, пиксели картинки. */
  x0: number
  y0: number
  /** Правый нижний угол рамки. */
  x1: number
  y1: number
}

export interface OcrPageText {
  /** Номер страницы с 1. */
  page: number
  /** Размер распознанной картинки страницы в пикселях (с учётом поворота). */
  width: number
  height: number
  words: OcrWord[]
}

export interface OcrLayerOptions {
  /** Байты шрифта TrueType с кириллицей (PT Sans из public/fonts). */
  font: Uint8Array
}

/** То, что нужно от результата tesseract.js: блоки → абзацы → строки → слова. */
interface TesseractBlocks {
  paragraphs: {
    lines: { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[]
  }[]
}

/** Слова из результата tesseract.js (`recognize(..., { blocks: true })`) в порядке чтения. */
export function ocrWordsFromBlocks(blocks: readonly TesseractBlocks[] | null): OcrWord[] {
  const words: OcrWord[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim()
          const { x0, y0, x1, y1 } = word.bbox
          if (text.length > 0 && x1 > x0 && y1 > y0) words.push({ text, x0, y0, x1, y1 })
        }
      }
    }
  }
  return words
}

type Turn = 0 | 90 | 180 | 270

/**
 * Перевод точки вида (пункты от левого верхнего угла повёрнутой страницы)
 * в координаты PDF и направления «вправо» и «вверх» вида в PDF.
 */
function viewToPdf(
  box: { x: number; y: number; width: number; height: number },
  turn: Turn
): {
  point: (x: number, y: number) => [number, number]
  right: [number, number]
  up: [number, number]
} {
  const { x: cx, y: cy, width: cw, height: ch } = box
  switch (turn) {
    case 90:
      return { point: (x, y) => [cx + y, cy + x], right: [0, 1], up: [-1, 0] }
    case 180:
      return { point: (x, y) => [cx + cw - x, cy + y], right: [-1, 0], up: [0, -1] }
    case 270:
      return { point: (x, y) => [cx + cw - y, cy + ch - x], right: [0, -1], up: [1, 0] }
    default:
      return { point: (x, y) => [cx + x, cy + ch - y], right: [1, 0], up: [0, 1] }
  }
}

function normalizeTurn(angle: number): Turn {
  const turn = (((Math.round(angle / 90) * 90) % 360) + 360) % 360
  return turn as Turn
}

/** Дописывает распознанные слова невидимым текстом на указанные страницы. */
export async function addOcrTextLayer(
  bytes: Uint8Array,
  pages: readonly OcrPageText[],
  options: OcrLayerOptions
): Promise<Uint8Array> {
  const withWords = pages.filter((p) => p.words.length > 0)
  if (withWords.length === 0) return bytes
  const doc = await load(bytes)
  const total = doc.getPageCount()
  for (const p of withWords) {
    if (!Number.isInteger(p.page) || p.page < 1 || p.page > total) {
      throw new PdfOpsError(
        m({
          ru: `Страницы ${p.page} нет в документе (всего ${total}).`,
          en: `Page ${p.page} is not in the document (${total} in total).`
        })
      )
    }
    if (!(p.width > 0 && p.height > 0)) {
      throw new PdfOpsError(
        m({
          ru: `Нет размера картинки страницы ${p.page}.`,
          en: `The page ${p.page} image has no size.`
        })
      )
    }
  }
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(options.font, { subset: true })
  // Доли кегля над и под базовой линией: рамка слова = от верха букв до низа выносных.
  const fullHeight = font.heightAtSize(1, { descender: true })
  const descent = fullHeight - font.heightAtSize(1, { descender: false })

  for (const p of withWords) {
    const page = doc.getPage(p.page - 1)
    const box = page.getCropBox()
    const turn = normalizeTurn(page.getRotation().angle)
    const [viewWidth, viewHeight] =
      turn % 180 === 0 ? [box.width, box.height] : [box.height, box.width]
    const sx = viewWidth / p.width
    const sy = viewHeight / p.height
    const map = viewToPdf(box, turn)
    const fontName = page.node.newFontDictionary('PWOcr', font.ref)

    const ops: PDFOperator[] = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)]
    for (const word of p.words) {
      const width = (word.x1 - word.x0) * sx
      const height = (word.y1 - word.y0) * sy
      if (!(width > 0 && height > 0)) continue
      const size = height / fullHeight
      const natural = font.widthOfTextAtSize(word.text, size)
      if (!(natural > 0)) continue
      const [x, y] = map.point(word.x0 * sx, word.y1 * sy - descent * size)
      ops.push(
        setFontAndSize(fontName, round(size)),
        setCharacterSqueeze(round((100 * width) / natural)),
        setTextMatrix(map.right[0], map.right[1], map.up[0], map.up[1], round(x), round(y)),
        showText(font.encodeText(word.text))
      )
    }
    ops.push(endText())

    // Исходное содержимое оборачивается в q … Q, чтобы его матрица и
    // состояние текста не сдвинули слой.
    page.node.normalize()
    const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]))
    const end = doc.context.register(doc.context.contentStream([popGraphicsState()]))
    page.node.wrapContentStreams(start, end)
    page.pushOperators(pushGraphicsState(), ...ops, popGraphicsState())
  }
  return save(doc)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
