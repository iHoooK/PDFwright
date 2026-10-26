import { m } from '../messages'
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  type PDFImage
} from 'pdf-lib'
import { save } from '../pdf-ops/document'
import {
  ImageFormatError,
  orientedSize,
  readImageInfo,
  type ExifOrientation,
  type ImageInfo
} from './image-info'

/**
 * «Изображения в PDF»: каждая картинка PNG или JPEG становится страницей.
 * JPEG встраивается как есть, без пересжатия; поворот по EXIF задаётся
 * матрицей рисования, поэтому пиксели не трогаются. Раскладка — чистые функции.
 */

export type ImagePageSize = 'image' | 'a4'

export interface ImagesToPdfOptions {
  /** «image» — страница по размеру картинки, «a4» — картинка вписана в A4. */
  pageSize: ImagePageSize
  /** Поля для A4, мм. */
  marginMm: number
}

export interface ImageRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PageLayout {
  /** Размер страницы, пт. */
  width: number
  height: number
  /** Где рисуется картинка (уже повёрнутая по EXIF), пт. */
  rect: ImageRect
}

/** A4 книжная, пт. */
export const A4: { width: number; height: number } = { width: 595.28, height: 841.89 }
/** Плотность картинки без dpi в файле: 96, как у экрана Windows. */
export const DEFAULT_IMAGE_DPI = 96
/** Наибольшая сторона страницы PDF (200 дюймов) и наименьшая (3 пт). */
const MAX_PAGE_SIDE = 14_400
const MIN_PAGE_SIDE = 3
const PT_PER_MM = 72 / 25.4

/** Размер картинки на странице в пунктах по её плотности (или 96 dpi). */
export function naturalSizePt(info: ImageInfo): { width: number; height: number } {
  const dpi = info.dpi !== null && info.dpi >= 30 && info.dpi <= 2400 ? info.dpi : DEFAULT_IMAGE_DPI
  const { width, height } = orientedSize(info)
  return { width: (width * 72) / dpi, height: (height * 72) / dpi }
}

/**
 * Раскладка страницы для картинки размера size (пт, после поворота по EXIF).
 * «По картинке» — страница равна картинке (в пределах допустимых размеров PDF),
 * «A4» — ориентация по картинке, картинка вписана в поля с сохранением пропорций.
 */
export function layoutImagePage(
  size: { width: number; height: number },
  options: ImagesToPdfOptions
): PageLayout {
  if (options.pageSize === 'image') {
    const big = Math.max(size.width, size.height)
    const shrink = big > MAX_PAGE_SIDE ? MAX_PAGE_SIDE / big : 1
    const width = Math.max(MIN_PAGE_SIDE, size.width * shrink)
    const height = Math.max(MIN_PAGE_SIDE, size.height * shrink)
    return { width, height, rect: { x: 0, y: 0, width, height } }
  }
  const landscape = size.width > size.height
  const width = landscape ? A4.height : A4.width
  const height = landscape ? A4.width : A4.height
  const margin = Math.max(0, Math.min(options.marginMm * PT_PER_MM, Math.min(width, height) / 4))
  const boxWidth = width - 2 * margin
  const boxHeight = height - 2 * margin
  const scale = Math.min(boxWidth / size.width, boxHeight / size.height)
  const w = size.width * scale
  const h = size.height * scale
  return {
    width,
    height,
    rect: { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
  }
}

export type Matrix = [number, number, number, number, number, number]

/**
 * Матрица рисования картинки в прямоугольник rect с поворотом по EXIF.
 * Единичный квадрат картинки (u вправо, v вверх) сначала переводится в
 * единичный квадрат показанной картинки, затем растягивается на rect.
 */
export function orientationMatrix(orientation: ExifOrientation, rect: ImageRect): Matrix {
  // (u, v) → (a·u + c·v + e, b·u + d·v + f) в единичном квадрате.
  const unit: Record<ExifOrientation, Matrix> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, 1, 0],
    3: [-1, 0, 0, -1, 1, 1],
    4: [1, 0, 0, -1, 0, 1],
    5: [0, -1, -1, 0, 1, 1],
    6: [0, -1, 1, 0, 0, 1],
    7: [0, 1, 1, 0, 0, 0],
    8: [0, 1, -1, 0, 1, 0]
  }
  const [a, b, c, d, e, f] = unit[orientation]
  const { x, y, width: w, height: h } = rect
  return [w * a, h * b, w * c, h * d, x + w * e, y + h * f]
}

export interface ImageInput {
  bytes: Uint8Array
  /** Имя файла для сообщений об ошибках. */
  name: string
}

/** Новый PDF из картинок в заданном порядке, по странице на картинку. */
export async function imagesToPdf(
  images: readonly ImageInput[],
  options: ImagesToPdfOptions
): Promise<Uint8Array> {
  if (images.length === 0)
    throw new ImageFormatError(
      m({ ru: 'Добавьте хотя бы одну картинку.', en: 'Add at least one image.' })
    )
  const doc = await PDFDocument.create()
  for (const input of images) {
    let info: ImageInfo
    let image: PDFImage
    try {
      info = readImageInfo(input.bytes)
      image =
        info.kind === 'jpeg' ? await doc.embedJpg(input.bytes) : await doc.embedPng(input.bytes)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new ImageFormatError(
        m({
          ru: `Не удалось прочитать «${input.name}»: ${reason}`,
          en: `Could not read "${input.name}": ${reason}`
        })
      )
    }
    const layout = layoutImagePage(naturalSizePt(info), options)
    const page = doc.addPage([layout.width, layout.height])
    const name = page.node.newXObject('Image', image.ref)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...orientationMatrix(info.orientation, layout.rect)),
      drawObject(name),
      popGraphicsState()
    )
  }
  return save(doc)
}
