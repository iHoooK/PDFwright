import type { FormValue, FormValues } from '@shared/pdf-ops/forms'

/** Чистые помощники слоя форм: сравнение значений и разметка полей ввода. */

export const sameValue = (a: FormValue, b: FormValue): boolean =>
  typeof a === 'string' || typeof b === 'string'
    ? a === b
    : a.length === b.length && a.every((v, i) => v === b[i])

/** Типы input, у которых есть курсор и выделение (setSelectionRange). */
const SELECTABLE_INPUTS = new Set(['text', 'search', 'url', 'tel', 'password'])

/** Можно ли поставить курсор в элемент: у флажков и переключателей выделения нет. */
export function supportsSelection(tag: string, type: string): boolean {
  if (tag.toUpperCase() === 'TEXTAREA') return true
  return tag.toUpperCase() === 'INPUT' && SELECTABLE_INPUTS.has(type.toLowerCase())
}

/** Значения без поля name: поле вернулось к значению из файла. */
export function withoutField(values: FormValues, name: string): FormValues {
  if (!(name in values)) return values
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== name))
}

/**
 * Новые несохранённые значения после правки поля; value null — поле снова как
 * в файле. Те же значения возвращаются тем же объектом (правки нет).
 */
export function withFieldValue(
  values: FormValues,
  name: string,
  value: FormValue | null
): FormValues {
  if (value === null) return withoutField(values, name)
  const current = values[name]
  if (current !== undefined && sameValue(current, value)) return values
  return { ...values, [name]: value }
}
