import { m } from '../messages'
import type { PDFDocument as MuDocument, PDFObject } from 'mupdf'
import { loadMupdf, type Mupdf } from './mupdf'
import { openPdf } from './open'

/**
 * Сжатие PDF на MuPDF: картинки документа пересжимаются в JPEG с уменьшением
 * до разрешения уровня, затем файл пересохраняется со сборкой мусора, сжатием
 * потоков и потоками объектов. Текст, шрифты и векторная графика не меняются;
 * картинка заменяется, только если новая заметно меньше старой. Если файл в
 * итоге не уменьшился, возвращаются исходные байты.
 */

export type CompressLevel = 'strong' | 'medium' | 'light'

export interface CompressPreset {
  /** Предельное разрешение картинки относительно самой большой страницы документа. */
  dpi: number
  /** Качество JPEG, 1–100. */
  quality: number
}

export const COMPRESS_PRESETS: Readonly<Record<CompressLevel, CompressPreset>> = {
  strong: { dpi: 100, quality: 50 },
  medium: { dpi: 150, quality: 65 },
  light: { dpi: 200, quality: 80 }
}

export interface CompressResult {
  /** Новые байты или исходные, если сжатие не уменьшило файл. */
  bytes: Uint8Array
  before: number
  after: number
  /** Сколько картинок в документе и сколько из них пересжато. */
  images: number
  recompressed: number
}

/** Картинка меньше этого (байт сжатого потока) не стоит пересжатия. */
const MIN_IMAGE_BYTES = 10_000
/** Замена, только если новый поток не больше 90 % старого. */
const GAIN = 0.9
const SKIP_FILTERS = new Set(['JBIG2Decode', 'CCITTFaxDecode'])

function filterNames(obj: PDFObject): string[] {
  const filter = obj.get('Filter')
  if (filter.isName()) return [filter.asName()]
  if (filter.isArray()) {
    const names: string[] = []
    filter.forEach((item) => {
      if (item.isName()) names.push(item.asName())
    })
    return names
  }
  return []
}

function isImage(ref: PDFObject): boolean {
  if (!ref.isStream()) return false
  const subtype = ref.get('Subtype')
  return subtype.isName() && subtype.asName() === 'Image'
}

/** Номера объектов-масок (SMask, Mask): их не пересжимаем, чтобы не испортить прозрачность. */
function maskNumbers(refs: readonly PDFObject[]): Set<number> {
  const masks = new Set<number>()
  for (const ref of refs) {
    for (const key of ['SMask', 'Mask']) {
      const mask = ref.get(key)
      if (mask.isIndirect()) masks.add(mask.asIndirect())
    }
  }
  return masks
}

function canRecompress(ref: PDFObject): boolean {
  const imageMask = ref.get('ImageMask')
  if (imageMask.isBoolean() && imageMask.asBoolean()) return false
  // Маска цветовым ключом привязана к исходным значениям цветов.
  if (ref.get('Mask').isArray()) return false
  const bpc = ref.get('BitsPerComponent')
  if (bpc.isNumber() && bpc.asNumber() === 1) return false
  const filters = filterNames(ref)
  if (filters.some((name) => SKIP_FILTERS.has(name))) return false
  const alphaInData = ref.get('SMaskInData')
  if (filters.includes('JPXDecode') && alphaInData.isNumber() && alphaInData.asNumber() !== 0) {
    return false
  }
  return true
}

/** Наибольшая сторона страниц документа, пт. */
function largestPageSide(doc: MuDocument): number {
  let side = 0
  const total = doc.countPages()
  for (let i = 0; i < total; i += 1) {
    const page = doc.loadPage(i)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      side = Math.max(side, x1 - x0, y1 - y0)
    } finally {
      page.destroy()
    }
  }
  return side > 0 ? side : 842
}

/** Перекодирует картинку в JPEG; возвращает true, если она заменена. */
function recompressImage(
  mupdf: Mupdf,
  doc: MuDocument,
  ref: PDFObject,
  maxPixels: number,
  quality: number
): boolean {
  const raw = ref.readRawStream()
  const rawLength = raw.length
  raw.destroy()
  if (rawLength < MIN_IMAGE_BYTES) return false
  const image = doc.loadImage(ref)
  try {
    const width = image.getWidth()
    const height = image.getHeight()
    const scale = Math.min(1, maxPixels / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))
    const gray = image.getColorSpace()?.isGray() ?? image.getNumberOfComponents() === 1
    const colorspace = gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB
    const pixmap = new mupdf.Pixmap(colorspace, [0, 0, targetWidth, targetHeight], false)
    try {
      pixmap.clear(255)
      const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
      try {
        // Единичный квадрат картинки MuPDF — верх слева, как у растра.
        device.fillImage(image, [targetWidth, 0, 0, targetHeight, 0, 0], 1)
        device.close()
      } finally {
        device.destroy()
      }
      const jpeg = pixmap.asJPEG(quality)
      if (jpeg.length > rawLength * GAIN) return false
      ref.writeRawStream(jpeg)
    } finally {
      pixmap.destroy()
    }
    ref.put('Filter', doc.newName('DCTDecode'))
    ref.delete('DecodeParms')
    ref.delete('Decode')
    ref.put('Width', targetWidth)
    ref.put('Height', targetHeight)
    ref.put('BitsPerComponent', 8)
    ref.put('ColorSpace', doc.newName(gray ? 'DeviceGray' : 'DeviceRGB'))
    return true
  } finally {
    image.destroy()
  }
}

function pdfDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

export async function compressPdf(
  bytes: Uint8Array,
  level: CompressLevel
): Promise<CompressResult> {
  const preset = COMPRESS_PRESETS[level]
  const mupdf = await loadMupdf()
  const doc = openPdf(
    mupdf,
    bytes,
    m({
      ru: 'Документ защищён паролем: откройте его в PDFwright паролем и сожмите открытый документ.',
      en: 'The document is password-protected: open it in PDFwright with the password and compress the open document.'
    })
  )
  try {
    const maxPixels = Math.ceil((largestPageSide(doc) / 72) * preset.dpi)
    const refs: PDFObject[] = []
    const total = doc.countObjects()
    for (let num = 1; num < total; num += 1) {
      const ref = doc.newIndirect(num)
      if (isImage(ref)) refs.push(ref)
    }
    const masks = maskNumbers(refs)
    let images = 0
    let recompressed = 0
    for (const ref of refs) {
      if (masks.has(ref.asIndirect())) continue
      images += 1
      if (canRecompress(ref) && recompressImage(mupdf, doc, ref, maxPixels, preset.quality)) {
        recompressed += 1
      }
    }
    doc.setMetaData('info:Producer', 'PDFwright')
    doc.setMetaData('info:ModDate', pdfDate(new Date()))
    const buffer = doc.saveToBuffer('garbage=deduplicate,compress,objstms')
    let saved: Uint8Array
    try {
      saved = buffer.asUint8Array().slice()
    } finally {
      buffer.destroy()
    }
    const smaller = saved.length < bytes.length
    return {
      bytes: smaller ? saved : bytes,
      before: bytes.length,
      after: smaller ? saved.length : bytes.length,
      images,
      recompressed
    }
  } finally {
    doc.destroy()
  }
}
