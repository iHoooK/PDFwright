import type { PdfwrightApi } from '@shared/ipc-contract'

/**
 * Система, на которой работает окно. Preload отдаёт process.platform синхронно,
 * поэтому система известна уже при загрузке модулей — до словаря и первого
 * рендера. В браузере (dev-сервер без Electron) и в unit-тестах — Windows.
 * Всё, что отличается на Mac, проверяет `isMac`; в Windows эти ветки не работают.
 */
export const platform: string =
  (globalThis as { pdfwright?: Partial<PdfwrightApi> }).pdfwright?.platform ?? 'win32'

export const isMac = platform === 'darwin'

interface Modifiers {
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * Клавиша сочетаний: Ctrl, а на Mac ещё и ⌘ — для щелчков и клавиш, где
 * программа до сих пор смотрела только на Ctrl.
 */
export function shortcutKey(event: Modifiers, mac = isMac): boolean {
  return event.ctrlKey || (mac && event.metaKey)
}

/** «Готово» в многострочном поле: Ctrl+Enter, на Mac ещё и ⌘↩. */
export function isDoneKey(event: Modifiers & { key: string }, mac = isMac): boolean {
  return event.key === 'Enter' && shortcutKey(event, mac)
}

/**
 * Удаление выбранных страниц в режиме «Страницы»: Delete, а на Mac ещё и
 * Backspace — клавиша, подписанная на клавиатуре Mac как delete.
 */
export function isPageDeleteKey(key: string, mac = isMac): boolean {
  return key === 'Delete' || (mac && key === 'Backspace')
}

/** Подпись для текущей системы: первая — для Windows, вторая — для Mac. */
export function forPlatform<T>(windows: T, mac: T, onMac = isMac): T {
  return onMac ? mac : windows
}

/** Процессор Mac для «О программе»: arm64 — Apple Silicon, x64 — Intel. */
export function macChip(arch: string): string {
  return arch === 'arm64' ? 'Apple Silicon' : 'Intel'
}
