/**
 * Выигрыш сжатия в целых процентах или null, если он меньше 1 %: такой
 * результат не предлагается (иначе «−0 %» с активной кнопкой «Применить»).
 */
export function compressionGain(result: { before: number; after: number }): number | null {
  if (result.before <= 0 || result.after >= result.before) return null
  const percent = Math.round((1 - result.after / result.before) * 100)
  return percent >= 1 ? percent : null
}
