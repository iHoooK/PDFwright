import { t } from '@renderer/i18n'
import { orientedSize, readImageInfo, sniffImageKind } from '@shared/convert/image-info'

/**
 * Картинка для «Изображения в PDF»: PNG и JPEG идут как есть, WebP
 * перекодируется через canvas (pdf-lib его не встраивает) — в JPEG, а если
 * есть прозрачность, то в PNG.
 */

export interface PreparedImage {
  name: string
  bytes: Uint8Array
  /** Размер на странице после поворота по EXIF, пиксели. */
  width: number
  height: number
}

async function webpToEmbeddable(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas недоступен')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
    let transparent = false
    for (let i = 3; i < pixels.length; i += 4) {
      if ((pixels[i] ?? 255) < 255) {
        transparent = true
        break
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, transparent ? 'image/png' : 'image/jpeg', 0.92)
    })
    if (!blob) throw new Error('Не удалось перекодировать WebP')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
    canvas.width = 0
    canvas.height = 0
  }
}

export async function prepareImage(name: string, source: Uint8Array): Promise<PreparedImage> {
  const kind = sniffImageKind(source)
  if (kind === null) throw new Error(t.convert.imageUnsupported(name))
  const bytes = kind === 'webp' ? await webpToEmbeddable(source) : source
  const { width, height } = orientedSize(readImageInfo(bytes))
  return { name, bytes, width, height }
}
