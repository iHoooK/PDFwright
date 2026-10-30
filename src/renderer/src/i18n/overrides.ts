/**
 * Замены строк словаря для Mac: те же ключи, только строки, которые на Mac
 * другие (⌘ вместо Ctrl, Finder вместо Проводника). Строки, функции и списки
 * заменяются целиком, вложенные разделы — по ключам.
 */
export type Overrides<T> = {
  readonly [K in keyof T]?: T[K] extends
    string | ((...args: never[]) => string) | readonly unknown[]
    ? T[K]
    : Overrides<T[K]>
}

/** Словарь с заменами; исходный словарь не меняется. */
export function applyOverrides<T extends object>(base: T, overrides: Overrides<T>): T {
  return merge(base as Record<string, unknown>, overrides) as T
}

function merge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const current = result[key]
    result[key] = isSection(current) && isSection(value) ? merge(current, value) : value
  }
  return result
}

function isSection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
