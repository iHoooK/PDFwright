import type { PdfSpacePoint, PdfSpaceRect } from './types'

/**
 * Объект страницы под точкой (пространство PDF, допуск в пунктах). Из всех
 * рамок под точкой берётся самая маленькая: строка поверх картинки
 * выбирается раньше картинки.
 */
export function pickPageObject<T extends { readonly rect: PdfSpaceRect }>(
  objects: readonly T[],
  point: PdfSpacePoint,
  tolerance: number
): T | null {
  let best: T | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const object of objects) {
    const r = object.rect
    const inside =
      point.x >= r.x - tolerance &&
      point.x <= r.x + r.width + tolerance &&
      point.y >= r.y - tolerance &&
      point.y <= r.y + r.height + tolerance
    const area = r.width * r.height
    if (inside && area < bestArea) {
      best = object
      bestArea = area
    }
  }
  return best
}
