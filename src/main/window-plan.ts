import type { SessionWindow } from '@shared/settings-schema'

/**
 * Чистые решения для нескольких окон: куда открыть файл, где поставить окно,
 * что восстановить из прошлого сеанса. Без Electron — покрыто unit-тестами.
 */

export interface WindowCandidate {
  id: number
  /** Порядковый номер последней активации: больше — активнее. */
  lastActive: number
  /** Пути документов, открытых во вкладках окна. */
  tabs: readonly string[]
}

/** Пути Windows не различают регистр и вид косой черты. */
export function samePath(a: string, b: string): boolean {
  const norm = (path: string): string => path.replace(/\//g, '\\').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Окно для файла из Проводника или второго экземпляра: окно, где файл уже
 * открыт (там просто активируется вкладка), иначе последнее активное.
 */
export function pickWindowForFile(
  windows: readonly WindowCandidate[],
  path: string
): number | null {
  const latest = (list: readonly WindowCandidate[]): WindowCandidate | undefined =>
    list.reduce<WindowCandidate | undefined>(
      (best, w) => (best === undefined || w.lastActive > best.lastActive ? w : best),
      undefined
    )
  const holder = latest(windows.filter((w) => w.tabs.some((tab) => samePath(tab, path))))
  return (holder ?? latest(windows))?.id ?? null
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowFrame {
  x: number | null
  y: number | null
  width: number
  height: number
}

/** Сколько заголовка окна должно остаться на экране, чтобы окно можно было перетащить. */
const GRIP_WIDTH = 120
const GRIP_HEIGHT = 32

/**
 * Рамка окна с учётом экранов: окно не больше рабочей области, а положение
 * сохраняется, только если заголовок окна виден на одном из экранов (монитор
 * могли отключить). Иначе положение не задаётся и окно ставит система.
 */
export function fitFrameToScreens(
  frame: WindowFrame,
  workAreas: readonly Rect[]
): { x?: number; y?: number; width: number; height: number } {
  const largest = workAreas.reduce<Rect | null>(
    (best, area) =>
      best === null || area.width * area.height > best.width * best.height ? area : best,
    null
  )
  const width = largest ? Math.min(frame.width, largest.width) : frame.width
  const height = largest ? Math.min(frame.height, largest.height) : frame.height
  const { x, y } = frame
  if (x === null || y === null) return { width, height }
  const gripVisible = workAreas.some((area) => {
    const overlap = Math.min(x + width, area.x + area.width) - Math.max(x, area.x)
    return overlap >= GRIP_WIDTH && y >= area.y && y + GRIP_HEIGHT <= area.y + area.height
  })
  return gripVisible ? { x, y, width, height } : { width, height }
}

/** Рамка нового окна: со сдвигом от текущего, чтобы окна не легли одно на другое. */
export function cascadeFrame(from: Rect, step = 28): WindowFrame {
  return { x: from.x + step, y: from.y + step, width: from.width, height: from.height }
}

export interface RestoreWindow {
  frame: WindowFrame
  maximized: boolean
  files: string[]
  active: string | null
}

export interface RestorePlan {
  windows: RestoreWindow[]
  /** Файлы прошлого сеанса, которых больше нет на диске. */
  missing: string[]
}

/**
 * План восстановления сеанса: отсутствующие файлы пропускаются, окна без
 * единого файла не создаются. Если активный файл пропал, активной становится
 * следующая вкладка, а у последней — предыдущая.
 */
export function planSessionRestore(
  windows: readonly SessionWindow[],
  exists: (path: string) => boolean
): RestorePlan {
  const plan: RestorePlan = { windows: [], missing: [] }
  for (const window of windows) {
    const files = window.tabs.filter((tab) => {
      if (exists(tab)) return true
      plan.missing.push(tab)
      return false
    })
    if (files.length === 0) continue
    const after = window.tabs.slice(window.active).find((tab) => files.includes(tab))
    plan.windows.push({
      frame: { x: window.x, y: window.y, width: window.width, height: window.height },
      maximized: window.maximized,
      files,
      active: after ?? files[files.length - 1] ?? null
    })
  }
  return plan
}
