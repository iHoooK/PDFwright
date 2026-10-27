import type { FormValues } from '@shared/pdf-ops/forms'
import { sameValue } from '@renderer/features/forms/form-values'

/**
 * Состояние вкладки, записанное в файл: байты, несохранённая разметка, значения
 * полей и защита. «Изменён» — текущий снимок не совпадает с ним: после отмены
 * всех правок или повторного переключения флажка документ снова не изменён.
 */
export interface SavedState<P> {
  bytes: Uint8Array
  markup: readonly unknown[]
  forms: FormValues
  protection: P | null
}

export interface TabState<P> {
  bytes: Uint8Array | null
  markup: readonly unknown[]
  forms: FormValues
  protection?: P | null | undefined
}

export function sameForms(a: FormValues, b: FormValues): boolean {
  if (a === b) return true
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const left = a[key]
    const right = b[key]
    return left !== undefined && right !== undefined && sameValue(left, right)
  })
}

/** Записана ли эта защита в файл: последнее сохранение было с ней же. */
export function protectionWritten<P>(
  protection: P | null | undefined,
  saved: SavedState<P> | undefined
): boolean {
  // Без сохранения saved?.protection — undefined, а не null: не совпадёт.
  return saved?.protection === (protection ?? null)
}

/** Совпадает ли состояние вкладки с записанным в файл (байты и разметка — по ссылке). */
export function matchesSaved<P>(tab: TabState<P>, saved: SavedState<P> | undefined): boolean {
  if (saved === undefined) return false
  if (tab.bytes !== saved.bytes) return false
  const sameMarkup =
    tab.markup === saved.markup || (tab.markup.length === 0 && saved.markup.length === 0)
  return (
    sameMarkup && sameForms(tab.forms, saved.forms) && (tab.protection ?? null) === saved.protection
  )
}
