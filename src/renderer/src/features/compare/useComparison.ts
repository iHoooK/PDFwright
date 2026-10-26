import { useCallback, useEffect, useRef, useState } from 'react'
import { pageRows } from '@shared/compare'
import { createCancelToken, type PdfDocument } from '@renderer/pdf-engine/engine'
import {
  comparePage,
  createCanvases,
  releaseCanvases,
  type DiffMask,
  type PageResult
} from './compare-page'

/** Сколько масок отличий держать в памяти для режима «Наложение». */
const MASK_CACHE = 16

export interface Comparison {
  results: ReadonlyMap<number, PageResult>
  masks: ReadonlyMap<number, DiffMask>
  total: number
  /** Страницы рядом с экраном сравниваются раньше остальных. */
  prioritize: (pages: readonly number[]) => void
  /** Пересчитать маску страницы, если её уже вытеснили из памяти. */
  requestMask: (page: number) => void
}

interface Queue {
  priority: number[]
  masks: number[]
  wake: (() => void) | null
}

function wakeUp(queue: Queue): void {
  const wake = queue.wake
  queue.wake = null
  wake?.()
}

/**
 * Сравнивает страницы двух версий в фоне по одной: сначала видимые, потом
 * остальные по порядку. Результаты приходят постранично, поэтому большой
 * документ не рендерится целиком сразу, а прогресс виден по results.size.
 */
export function useComparison(a: PdfDocument, b: PdfDocument): Comparison {
  const total = pageRows(a.numPages, b.numPages)
  const [results, setResults] = useState<ReadonlyMap<number, PageResult>>(() => new Map())
  const [masks, setMasks] = useState<ReadonlyMap<number, DiffMask>>(() => new Map())
  const queueRef = useRef<Queue>({ priority: [], masks: [], wake: null })

  useEffect(() => {
    const queue: Queue = { priority: [], masks: [], wake: null }
    queueRef.current = queue
    const run = createCancelToken()
    const canvases = createCanvases()
    const done = new Set<number>()
    let cursor = 1
    const next = (): { page: number; maskOnly: boolean } | null => {
      const maskPage = queue.masks.shift()
      if (maskPage !== undefined) return { page: maskPage, maskOnly: true }
      for (let page = queue.priority.shift(); page !== undefined; page = queue.priority.shift()) {
        if (!done.has(page) && page >= 1 && page <= total) return { page, maskOnly: false }
      }
      while (cursor <= total && done.has(cursor)) cursor += 1
      return cursor <= total ? { page: cursor, maskOnly: false } : null
    }
    const keepMask = (page: number, mask: DiffMask): void => {
      setMasks((prev) => {
        const map = new Map(prev)
        map.delete(page)
        map.set(page, mask)
        for (const oldest of map.keys()) {
          if (map.size <= MASK_CACHE) break
          map.delete(oldest)
        }
        return map
      })
    }

    void (async () => {
      while (!run.isCancelled()) {
        const job = next()
        if (!job) {
          await new Promise<void>((resolve) => {
            queue.wake = resolve
          })
          continue
        }
        let outcome: Awaited<ReturnType<typeof comparePage>>
        try {
          outcome = await comparePage(a, b, job.page, canvases)
        } catch (error) {
          if (run.isCancelled()) return
          console.error(`[compare] страница ${job.page} не сравнена:`, error)
          outcome = {
            result: { status: 'changed', regions: [], text: [], failed: true },
            mask: null
          }
        }
        if (run.isCancelled()) return
        done.add(job.page)
        const { result, mask } = outcome
        if (!job.maskOnly) setResults((prev) => new Map(prev).set(job.page, result))
        if (mask) keepMask(job.page, mask)
        // Отдаём кадр интерфейсу между страницами.
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    })()

    return () => {
      run.cancel()
      wakeUp(queue)
      releaseCanvases(canvases)
    }
  }, [a, b, total])

  const prioritize = useCallback((pages: readonly number[]) => {
    const queue = queueRef.current
    queue.priority = [...pages]
    wakeUp(queue)
  }, [])

  const requestMask = useCallback((page: number) => {
    const queue = queueRef.current
    if (!queue.masks.includes(page)) queue.masks.push(page)
    wakeUp(queue)
  }, [])

  return { results, masks, total, prioritize, requestMask }
}
