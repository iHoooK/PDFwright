import { useMemo } from 'react'
import type { MarkupObject } from '@shared/markup/model'

/** Несохранённая разметка по номерам страниц (для слоёв страниц и миниатюр). */
export function useMarkupByPage(
  markup: readonly MarkupObject[]
): ReadonlyMap<number, readonly MarkupObject[]> {
  return useMemo(() => {
    const map = new Map<number, MarkupObject[]>()
    for (const o of markup) {
      const list = map.get(o.page) ?? []
      list.push(o)
      map.set(o.page, list)
    }
    return map
  }, [markup])
}
