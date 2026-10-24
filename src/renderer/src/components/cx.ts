/** Склеивает имена классов, пропуская undefined и false. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ')
}
