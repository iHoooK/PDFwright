import { m } from '../messages'
import { expandRange, parsePageRanges } from '../pdf-ops/ranges'

/**
 * Расчёты «PDF в изображения» без рендера: размер картинки по DPI, список
 * страниц и имена файлов. Сам рендер делает pdf.js в renderer.
 */

export type PageImageFormat = 'png' | 'jpeg'

export const DPI_PRESETS = [72, 150, 300] as const
export const MIN_DPI = 36
export const MAX_DPI = 1200
/** Предел площади одной картинки: больше Chromium не рисует надёжно (и это ~400 МБ памяти). */
export const MAX_IMAGE_PIXELS = 100_000_000

/** Размер картинки страницы в пикселях: пункты PDF × dpi / 72. */
export function pageImageSize(
  widthPt: number,
  heightPt: number,
  dpi: number
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round((widthPt * dpi) / 72)),
    height: Math.max(1, Math.round((heightPt * dpi) / 72))
  }
}

export function isValidDpi(dpi: number): boolean {
  return Number.isFinite(dpi) && dpi >= MIN_DPI && dpi <= MAX_DPI
}

/**
 * Номера страниц для выгрузки: все, если spec пустой, иначе по диапазонам
 * (`1-3, 5, 7-`) в указанном порядке без повторов. Ошибки — PageRangeError.
 */
export function pagesFromSpec(spec: string | null, total: number): number[] {
  if (spec === null) return Array.from({ length: total }, (_, i) => i + 1)
  const seen = new Set<number>()
  const pages: number[] = []
  for (const range of parsePageRanges(spec, total)) {
    for (const page of expandRange(range)) {
      if (seen.has(page)) continue
      seen.add(page)
      pages.push(page)
    }
  }
  return pages
}

/** Имя файла страницы: `Отчёт_стр07.png`; номер дополняется нулями до ширины total. */
export function pageImageName(
  base: string,
  page: number,
  total: number,
  format: PageImageFormat
): string {
  const number = String(page).padStart(String(total).length, '0')
  return m({
    ru: `${base}_стр${number}.${format === 'png' ? 'png' : 'jpg'}`,
    en: `${base}_p${number}.${format === 'png' ? 'png' : 'jpg'}`
  })
}
