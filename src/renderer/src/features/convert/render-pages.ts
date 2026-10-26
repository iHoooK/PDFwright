import * as pdfjs from 'pdfjs-dist'
import type { CancelToken, PdfDocument } from '@renderer/pdf-engine/engine'
import { MAX_IMAGE_PIXELS, pageImageSize, type PageImageFormat } from '@shared/convert/page-images'
import { withJpegDpi, withPngDpi } from '@shared/convert/image-info'

/**
 * Рендер страницы в картинку для «PDF в изображения»: pdf.js рисует страницу
 * в отдельный canvas размером ровно «пункты × dpi / 72» (с учётом /Rotate),
 * поверх белого фона; в файл записывается плотность, чтобы картинка
 * открывалась в редакторах в натуральную величину.
 */

export class PageTooLargeError extends Error {
  constructor(readonly page: number) {
    super(`page ${page} too large`)
    this.name = 'PageTooLargeError'
  }
}

export interface RenderImageOptions {
  dpi: number
  format: PageImageFormat
  /** Качество JPEG 1–100. */
  quality: number
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Не удалось закодировать картинку'))
      },
      type,
      quality
    )
  })
}

/** Рисует страницу pageNumber (с 1) и кодирует её в PNG или JPEG; null — отменено. */
export async function renderPageImage(
  doc: PdfDocument,
  pageNumber: number,
  options: RenderImageOptions,
  token: CancelToken
): Promise<Uint8Array | null> {
  const page = await doc.getPage(pageNumber)
  const scale = options.dpi / 72
  const viewport = page.getViewport({ scale, rotation: page.rotate })
  const { width, height } = pageImageSize(
    viewport.width / scale,
    viewport.height / scale,
    options.dpi
  )
  if (width * height > MAX_IMAGE_PIXELS || Math.max(width, height) > 32_767) {
    throw new PageTooLargeError(pageNumber)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas недоступен')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    const task = page.render({
      canvas,
      viewport,
      // Округление до целых пикселей: растягиваем рисунок на весь canvas.
      transform: [width / viewport.width, 0, 0, height / viewport.height, 0, 0],
      background: '#ffffff',
      annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE
    })
    const stop = window.setInterval(() => {
      if (token.isCancelled()) task.cancel()
    }, 50)
    try {
      await task.promise
    } catch (error) {
      if (error instanceof pdfjs.RenderingCancelledException) return null
      throw error
    } finally {
      window.clearInterval(stop)
    }
    if (token.isCancelled()) return null
    const type = options.format === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await toBlob(canvas, type, options.quality / 100)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return options.format === 'png'
      ? withPngDpi(bytes, options.dpi)
      : withJpegDpi(bytes, options.dpi)
  } finally {
    // Освобождаем память canvas сразу, не дожидаясь сборщика мусора.
    canvas.width = 0
    canvas.height = 0
  }
}
