import type { TextMarkKind } from './model'

/**
 * Цвет маркера при смене вида пометки. Выделение кладётся светлой заливкой
 * под текст, а подчёркивание и зачёркивание — тонкой линией: бледно-жёлтая
 * линия почти не видна, а тёмная заливка закрывает текст. Поэтому цвет,
 * который не подходит новому виду, заменяется его цветом по умолчанию;
 * подходящий (выбранный пользователем) остаётся.
 */
export const MARK_KIND_COLORS: Readonly<Record<TextMarkKind, string>> = {
  highlight: '#ffd86b',
  underline: '#0067c0',
  strikeout: '#c42b1c'
}

/** light — светлые цвета выделения (палитра маркера без тёмных). */
export function markColorFor(
  kind: TextMarkKind,
  current: string,
  light: readonly string[]
): string {
  const isLight = light.includes(current.toLowerCase())
  if (kind === 'highlight') return isLight ? current : MARK_KIND_COLORS.highlight
  if (isLight) return MARK_KIND_COLORS[kind]
  // Цвет по умолчанию другого вида линии сменяется своим: синее подчёркивание → красное зачёркивание.
  const other: TextMarkKind = kind === 'underline' ? 'strikeout' : 'underline'
  return current.toLowerCase() === MARK_KIND_COLORS[other] ? MARK_KIND_COLORS[kind] : current
}
