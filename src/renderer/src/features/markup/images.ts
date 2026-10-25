import { t } from '@renderer/i18n'

/** Наибольший размер вставляемой картинки: больше — признак ошибки, а не фотографии. */
const IMAGE_MAX_BYTES = 40 * 1024 * 1024

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Читает PNG или JPEG в data URL. Формат определяется по сигнатуре файла, а
 * не по расширению: pdf-lib умеет встраивать только эти два формата.
 */
export async function readImageFile(file: File, only: 'png' | 'any' = 'any'): Promise<string> {
  if (file.size > IMAGE_MAX_BYTES) throw new Error(t.markup.imageTooBig)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isPng(bytes)) return `data:image/png;base64,${toBase64(bytes)}`
  if (only === 'any' && isJpeg(bytes)) return `data:image/jpeg;base64,${toBase64(bytes)}`
  throw new Error(only === 'png' ? t.markup.pngOnly : t.markup.imageFormat)
}

export function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 })
    }
    image.onerror = () => {
      reject(new Error(t.markup.imageFormat))
    }
    image.src = src
  })
}

/** Байты PNG или JPEG для замены картинки документа (MuPDF принимает оба формата). */
export async function readImageBytes(file: File): Promise<Uint8Array> {
  if (file.size > IMAGE_MAX_BYTES) throw new Error(t.markup.imageTooBig)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isPng(bytes) || isJpeg(bytes)) return bytes
  throw new Error(t.markup.imageFormat)
}
