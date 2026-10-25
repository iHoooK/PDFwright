import { useEffect, useState } from 'react'
import type { PageObjects } from '@shared/pdf-content/types'
import { pdfContent } from '@renderer/pdf-content/client'

/**
 * Строки и картинки страниц из MuPDF. Кэш привязан к байтам документа: любая
 * правка даёт новые байты, и старые записи уходят вместе с ними (WeakMap).
 */
const cache = new WeakMap<Uint8Array, Map<number, Promise<PageObjects>>>()

export function loadPageObjects(bytes: Uint8Array, pageIndex: number): Promise<PageObjects> {
  let pages = cache.get(bytes)
  if (!pages) {
    pages = new Map()
    cache.set(bytes, pages)
  }
  let request = pages.get(pageIndex)
  if (!request) {
    request = pdfContent.listPageObjects(bytes, pageIndex)
    pages.set(pageIndex, request)
    const owner = pages
    request.catch(() => {
      owner.delete(pageIndex)
    })
  }
  return request
}

/** Объекты страницы (номер с 1) или null, пока движок их читает или если выключено. */
export function usePageObjects(
  bytes: Uint8Array | null,
  page: number,
  enabled: boolean
): PageObjects | null {
  const [result, setResult] = useState<{ bytes: Uint8Array; objects: PageObjects } | null>(null)
  useEffect(() => {
    if (!enabled || !bytes) return
    let cancelled = false
    loadPageObjects(bytes, page - 1).then(
      (objects) => {
        if (!cancelled) setResult({ bytes, objects })
      },
      (error: unknown) => {
        if (!cancelled) console.error(`[content] объекты страницы ${page} не прочитаны:`, error)
      }
    )
    return () => {
      cancelled = true
    }
  }, [bytes, page, enabled])
  return enabled && result?.bytes === bytes && result.objects.pageIndex === page - 1
    ? result.objects
    : null
}
