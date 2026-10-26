import { m } from '../messages'
/**
 * Разбор заголовков PNG и JPEG без декодирования пикселей: тип, размер,
 * плотность (dpi) и ориентация EXIF. Плюс запись плотности в готовые файлы,
 * чтобы картинки из «PDF в изображения» открывались в редакторах в нужном
 * масштабе. Чистые функции над байтами, работают в Node и в renderer.
 */

export type ImageKind = 'png' | 'jpeg'

/** Ориентация EXIF 1–8: 1 — как хранится, 6 — повернуть на 90° по часовой и т. д. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface ImageInfo {
  kind: ImageKind
  /** Размер растра, как он хранится в файле (без учёта ориентации). */
  width: number
  height: number
  /** Плотность из JFIF или pHYs, точек на дюйм; null — не указана. */
  dpi: number | null
  orientation: ExifOrientation
}

export class ImageFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageFormatError'
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function sniffImageKind(bytes: Uint8Array): ImageKind | 'webp' | null {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  return null
}

export function readImageInfo(bytes: Uint8Array): ImageInfo {
  const kind = sniffImageKind(bytes)
  if (kind === 'png') return readPngInfo(bytes)
  if (kind === 'jpeg') return readJpegInfo(bytes)
  throw new ImageFormatError(
    m({ ru: 'Поддерживаются картинки PNG и JPEG.', en: 'Only PNG and JPEG images are supported.' })
  )
}

/** Размер картинки на экране: при ориентациях 5–8 ширина и высота меняются местами. */
export function orientedSize(info: ImageInfo): { width: number; height: number } {
  return info.orientation >= 5
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height }
}

// ---------------------------------------------------------------------------
// PNG

function readPngInfo(bytes: Uint8Array): ImageInfo {
  const view = viewOf(bytes)
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') {
    throw new ImageFormatError(
      m({
        ru: 'Файл PNG повреждён: нет заголовка IHDR.',
        en: 'The PNG file is damaged: the IHDR header is missing.'
      })
    )
  }
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  let dpi: number | null = null
  for (const chunk of pngChunks(bytes)) {
    if (chunk.type === 'pHYs' && chunk.length >= 9) {
      const ppu = view.getUint32(chunk.data)
      // Единица 1 — метр; без единицы pHYs задаёт только пропорцию пикселя.
      if (bytes[chunk.data + 8] === 1 && ppu > 0) dpi = Math.round(ppu * 0.0254)
    }
    if (chunk.type === 'IDAT') break
  }
  if (width === 0 || height === 0)
    throw new ImageFormatError(m({ ru: 'Картинка PNG пустая.', en: 'The PNG image is empty.' }))
  return { kind: 'png', width, height, dpi, orientation: 1 }
}

interface PngChunk {
  type: string
  /** Смещение начала чанка (поля длины). */
  offset: number
  /** Смещение данных чанка. */
  data: number
  length: number
}

function* pngChunks(bytes: Uint8Array): Generator<PngChunk> {
  const view = viewOf(bytes)
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = ascii(bytes, offset + 4, 4)
    yield { type, offset, data: offset + 8, length }
    offset += 12 + length
  }
}

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

/** Записывает плотность в PNG: чанк pHYs заменяется или вставляется сразу после IHDR. */
export function withPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const chunks = [...pngChunks(bytes)]
  const ihdr = chunks[0]
  if (ihdr?.type !== 'IHDR')
    throw new ImageFormatError(
      m({
        ru: 'Файл PNG повреждён: нет заголовка IHDR.',
        en: 'The PNG file is damaged: the IHDR header is missing.'
      })
    )
  const ppm = Math.round(dpi / 0.0254)
  const body = new Uint8Array(4 + 9)
  body.set([0x70, 0x48, 0x59, 0x73]) // pHYs
  const view = viewOf(body)
  view.setUint32(4, ppm)
  view.setUint32(8, ppm)
  body[12] = 1
  const chunk = new Uint8Array(12 + 9)
  const chunkView = viewOf(chunk)
  chunkView.setUint32(0, 9)
  chunk.set(body, 4)
  chunkView.setUint32(17, crc32(body))
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  for (const c of chunks) {
    if (c.type === 'pHYs') continue
    parts.push(bytes.subarray(c.offset, c.data + c.length + 4))
    if (c.type === 'IHDR') parts.push(chunk)
  }
  return concat(parts)
}

// ---------------------------------------------------------------------------
// JPEG

interface JpegSegment {
  marker: number
  /** Смещение маркера (0xFF). */
  offset: number
  /** Смещение данных после поля длины. */
  data: number
  /** Длина данных без поля длины. */
  length: number
}

/** Сегменты заголовка JPEG до начала сжатых данных (SOS). */
function* jpegSegments(bytes: Uint8Array): Generator<JpegSegment> {
  const view = viewOf(bytes)
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return
    const marker = bytes[offset + 1] ?? 0
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    const size = view.getUint16(offset + 2)
    if (size < 2) return
    yield { marker, offset, data: offset + 4, length: size - 2 }
    if (marker === 0xda || marker === 0xd9) return
    offset += 2 + size
  }
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
])

function readJpegInfo(bytes: Uint8Array): ImageInfo {
  const view = viewOf(bytes)
  let width = 0
  let height = 0
  let dpi: number | null = null
  let orientation: ExifOrientation = 1
  for (const segment of jpegSegments(bytes)) {
    if (SOF_MARKERS.has(segment.marker) && segment.length >= 5) {
      height = view.getUint16(segment.data + 1)
      width = view.getUint16(segment.data + 3)
      break
    }
    if (segment.marker === 0xe0 && ascii(bytes, segment.data, 5) === 'JFIF\0') {
      dpi = jfifDpi(bytes, segment.data)
    }
    if (segment.marker === 0xe1 && ascii(bytes, segment.data, 6) === 'Exif\0\0') {
      orientation = exifOrientation(bytes, segment.data + 6, segment.length - 6)
    }
  }
  if (width === 0 || height === 0) {
    throw new ImageFormatError(
      m({
        ru: 'Файл JPEG повреждён: не найден размер картинки.',
        en: 'The JPEG file is damaged: the image size was not found.'
      })
    )
  }
  return { kind: 'jpeg', width, height, dpi, orientation }
}

function jfifDpi(bytes: Uint8Array, data: number): number | null {
  const view = viewOf(bytes)
  const units = bytes[data + 7]
  const x = view.getUint16(data + 8)
  if (x === 0) return null
  if (units === 1) return x
  if (units === 2) return Math.round(x * 2.54)
  return null
}

/** Читает тег Orientation (0x0112) из IFD0 блока TIFF внутри APP1 Exif. */
function exifOrientation(bytes: Uint8Array, tiff: number, length: number): ExifOrientation {
  if (length < 8 || tiff + length > bytes.length) return 1
  const view = new DataView(bytes.buffer, bytes.byteOffset + tiff, length)
  const order = ascii(bytes, tiff, 2)
  if (order !== 'II' && order !== 'MM') return 1
  const little = order === 'II'
  const ifd = view.getUint32(4, little)
  if (ifd + 2 > length) return 1
  const count = view.getUint16(ifd, little)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > length) return 1
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little)
      return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1
    }
  }
  return 1
}

/**
 * Записывает плотность в JPEG: правит сегмент JFIF или вставляет его сразу
 * после SOI, если его нет (Chromium пишет JFIF с плотностью 1:1 без единиц).
 */
export function withJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (sniffImageKind(bytes) !== 'jpeg')
    throw new ImageFormatError(m({ ru: 'Это не JPEG.', en: 'This is not a JPEG file.' }))
  const value = Math.max(1, Math.min(65535, Math.round(dpi)))
  for (const segment of jpegSegments(bytes)) {
    if (segment.marker === 0xe0 && ascii(bytes, segment.data, 5) === 'JFIF\0') {
      if (segment.length < 12) break
      const out = bytes.slice()
      const view = viewOf(out)
      out[segment.data + 7] = 1
      view.setUint16(segment.data + 8, value)
      view.setUint16(segment.data + 10, value)
      return out
    }
    if (segment.marker === 0xda) break
  }
  const app0 = new Uint8Array(18)
  app0.set([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01])
  const view = viewOf(app0)
  view.setUint16(12, value)
  view.setUint16(14, value)
  return concat([bytes.subarray(0, 2), app0, bytes.subarray(2)])
}

// ---------------------------------------------------------------------------

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0)
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
