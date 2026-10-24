/**
 * Чистые вычисления над номерами страниц (с 1), без pdf-lib:
 * разбор диапазонов для разделения, порядок после перетаскивания,
 * нарезка на пакеты. Покрыты unit-тестами.
 */

export class PageRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageRangeError'
  }
}

/**
 * Разбирает строку вида `1-3, 5, 7-` в список диапазонов `[from, to]`.
 * Открытый конец `7-` означает «до последней страницы». Бросает PageRangeError
 * с понятным сообщением для пустого ввода, нечисловых значений и выхода за пределы.
 */
export function parsePageRanges(spec: string, total: number): [number, number][] {
  const parts = spec
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0)
    throw new PageRangeError('Укажите хотя бы один диапазон, например 1-3, 5, 7-.')
  const ranges: [number, number][] = []
  for (const part of parts) {
    const match = /^(\d+)?\s*(-\s*(\d+)?)?$/.exec(part)
    if (!match || (match[1] === undefined && match[3] === undefined)) {
      throw new PageRangeError(
        `Не удалось разобрать «${part}». Используйте числа и дефис: 1-3, 5, 7-.`
      )
    }
    const from = match[1] === undefined ? 1 : Number(match[1])
    const to = match[2] === undefined ? from : match[3] === undefined ? total : Number(match[3])
    if (from < 1 || to > total) {
      throw new PageRangeError(
        `Диапазон «${part}» выходит за пределы документа (страниц: ${total}).`
      )
    }
    if (from > to) throw new PageRangeError(`В диапазоне «${part}» начало больше конца.`)
    ranges.push([from, to])
  }
  return ranges
}

/** Разворачивает диапазон в список номеров страниц. */
export function expandRange([from, to]: [number, number]): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** Режет 1..total на пакеты по n страниц: [[1,n],[n+1,2n],…]. */
export function chunkEveryN(total: number, n: number): [number, number][] {
  if (!Number.isInteger(n) || n < 1)
    throw new PageRangeError('Число страниц в части должно быть целым и больше нуля.')
  const chunks: [number, number][] = []
  for (let from = 1; from <= total; from += n) chunks.push([from, Math.min(total, from + n - 1)])
  return chunks
}

/**
 * Новый порядок страниц после перетаскивания выбранных `moving` на позицию
 * `target` (индекс вставки в исходной нумерации, 1..total+1: «перед страницей target»).
 * Возвращает перестановку исходных номеров.
 */
export function computeMoveOrder(
  total: number,
  moving: readonly number[],
  target: number
): number[] {
  const movingSet = new Set(moving.filter((p) => p >= 1 && p <= total))
  if (movingSet.size === 0) return Array.from({ length: total }, (_, i) => i + 1)
  const movingOrdered = Array.from({ length: total }, (_, i) => i + 1).filter((p) =>
    movingSet.has(p)
  )
  const rest: number[] = []
  let insertAt = 0
  for (let p = 1; p <= total; p += 1) {
    if (p === target) insertAt = rest.length
    if (!movingSet.has(p)) rest.push(p)
  }
  if (target > total) insertAt = rest.length
  return [...rest.slice(0, insertAt), ...movingOrdered, ...rest.slice(insertAt)]
}

/** true, если порядок — тождественная перестановка. */
export function isIdentityOrder(order: readonly number[]): boolean {
  return order.every((p, i) => p === i + 1)
}

/** Форматирует список страниц в компактный вид: 1-3, 5, 8-9. */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    const start = sorted[i] ?? 0
    let end = start
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1
      end = sorted[i] ?? end
    }
    parts.push(start === end ? String(start) : `${start}-${end}`)
    i += 1
  }
  return parts.join(', ')
}
