/**
 * Сопоставление страниц двух версий по номеру и переход между отличиями.
 */

/** Состояние страницы в сравнении: pending — ещё не сравнена. */
export type PageStatus = 'pending' | 'same' | 'changed' | 'added' | 'removed'

/** Сколько строк в сравнении: по большей из версий. */
export function pageRows(countA: number, countB: number): number {
  return Math.max(countA, countB)
}

/** Страница есть только в одной версии: удалена (только в a) или добавлена (только в b). */
export function presenceStatus(
  page: number,
  countA: number,
  countB: number
): 'added' | 'removed' | null {
  if (page > countA && page <= countB) return 'added'
  if (page > countB && page <= countA) return 'removed'
  return null
}

export function isDifference(status: PageStatus): boolean {
  return status === 'changed' || status === 'added' || status === 'removed'
}

/** Следующая страница с отличием после current; после последней — снова первая. */
export function nextDifference(differing: readonly number[], current: number): number | null {
  const sorted = [...differing].sort((p, q) => p - q)
  return sorted.find((page) => page > current) ?? sorted[0] ?? null
}
