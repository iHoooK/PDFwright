/** Пределы масштаба, который вводят вручную или выбирают в меню, %. */
export const ZOOM_MIN = 25
export const ZOOM_MAX = 400

/** Готовые значения в меню масштаба, %. */
export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400] as const

/**
 * Масштаб из поля ввода: «150», «150%», «150 %», «87,5» (округляется). Вне
 * пределов — ближайший предел; не число — null (поле вернёт прежнее значение).
 */
export function parseZoomInput(text: string): number | null {
  const cleaned = text.replace(/\s+/g, '').replace(/%$/, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Math.round(Number(cleaned))
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}
