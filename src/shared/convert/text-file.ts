import { m } from '../messages'
/**
 * Текст из PDF для буфера обмена и файла .txt: склейка страниц и кодирование
 * в UTF-8 с BOM и переводами строк Windows, чтобы кириллицу верно читали и
 * старый Блокнот, и Excel.
 */

export interface PageText {
  /** Номер страницы с 1. */
  page: number
  text: string
}

/** Склеивает тексты страниц; markPages добавляет строку «— Страница N —» перед каждой. */
export function joinPagesText(pages: readonly PageText[], markPages: boolean): string {
  const parts = pages.map(({ page, text }) => {
    const body = text.replace(/\s+$/, '')
    if (!markPages) return body
    const mark = m({ ru: `— Страница ${page} —`, en: `— Page ${page} —` })
    return body.length > 0 ? `${mark}\n\n${body}` : mark
  })
  return parts.filter((part) => part.length > 0).join('\n\n') + (parts.length > 0 ? '\n' : '')
}

/** true, если в тексте нет ничего, кроме пробелов и разметки страниц. */
export function isBlankText(pages: readonly PageText[]): boolean {
  return pages.every(({ text }) => text.trim().length === 0)
}

/** UTF-8 с BOM и CRLF. */
export function encodeTextFile(text: string): Uint8Array {
  const body = new TextEncoder().encode(text.replace(/\r?\n/g, '\r\n'))
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(body, 3)
  return out
}
