import { useEffect, useState } from 'react'
import { parseHexColor, type Rect } from '@shared/markup/geometry'
import type { MarkupObject } from '@shared/markup/model'
import type { PageAnnotation } from '@shared/pdf-content/annotations'
import type { RgbColor } from '@shared/pdf-content/types'
import type { PdfDocument } from '@renderer/pdf-engine/engine'
import { pdfContent } from '@renderer/pdf-content/client'
import { t } from '@renderer/i18n'

/**
 * Аннотации документа из MuPDF для инструмента «Выделение». Кэш привязан к
 * байтам документа: любая правка даёт новые байты, и старые списки уходят
 * вместе с ними (WeakMap). Страницы без пометок (по pdf.js) MuPDF не читает.
 */

const NONE: readonly PageAnnotation[] = []
const cache = new WeakMap<Uint8Array, Map<number, Promise<readonly PageAnnotation[]>>>()

/** Аннотации страницы (номер с 0) для этих байтов. */
export function loadAnnotations(
  bytes: Uint8Array,
  pageIndex: number
): Promise<readonly PageAnnotation[]> {
  let pages = cache.get(bytes)
  if (!pages) {
    pages = new Map()
    cache.set(bytes, pages)
  }
  let request = pages.get(pageIndex)
  if (!request) {
    request = pdfContent.listAnnotations(bytes, pageIndex)
    pages.set(pageIndex, request)
    const owner = pages
    request.catch(() => {
      owner.delete(pageIndex)
    })
  }
  return request
}

/** Аннотация по месту в списке страницы (номер с 1) или null. */
export async function findAnnotation(
  bytes: Uint8Array,
  page: number,
  index: number
): Promise<PageAnnotation | null> {
  const list = await loadAnnotations(bytes, page - 1)
  return list.find((a) => a.index === index) ?? null
}

/** Аннотации страницы (номер с 1); null, пока не прочитаны или если выключено. */
export function usePageAnnotations(
  doc: PdfDocument | null,
  bytes: Uint8Array | null,
  page: number,
  enabled: boolean
): readonly PageAnnotation[] | null {
  const [result, setResult] = useState<{
    bytes: Uint8Array
    page: number
    list: readonly PageAnnotation[]
  } | null>(null)
  useEffect(() => {
    if (!enabled || !bytes || !doc) return
    let cancelled = false
    doc
      .hasMarkupAnnotations(page)
      .then((has) => (has ? loadAnnotations(bytes, page - 1) : NONE))
      .then(
        (list) => {
          if (!cancelled) setResult({ bytes, page, list })
        },
        (error: unknown) => {
          if (!cancelled) console.error(`[annotations] страница ${page} не прочитана:`, error)
        }
      )
    return () => {
      cancelled = true
    }
  }, [doc, bytes, page, enabled])
  return enabled && result?.bytes === bytes && result.page === page ? result.list : null
}

export function annotationId(page: number, index: number): string {
  return `annot:${page}:${index}`
}

export function rgbToHex(color: RgbColor | null): string {
  if (!color) return '#000000'
  const hex = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`
}

export function hexToRgb(color: string): RgbColor {
  return parseHexColor(color)
}

export function annotationName(subtype: string): string {
  const kinds = t.annotations.kinds as Readonly<Record<string, string | undefined>>
  return kinds[subtype] ?? t.annotations.kinds.other
}

function inset(r: Rect, by: number): Rect {
  const dx = Math.min(by, r.width / 2)
  const dy = Math.min(by, r.height / 2)
  return { x: r.x + dx, y: r.y + dy, width: r.width - dx * 2, height: r.height - dy * 2 }
}

/**
 * Форма аннотации как объект разметки — для попадания указателем тем же
 * hitObject: у фигур ловится контур, у пометок текста — строки, у штампов,
 * заметок и текстовых полей — вся рамка.
 */
export function annotationShape(a: PageAnnotation, page: number): MarkupObject {
  const base = { id: annotationId(page, a.index), page, color: '#000000', opacity: 1 }
  const width = Math.max(1, a.borderWidth)
  switch (a.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly':
      return { ...base, kind: 'highlight', rects: a.quads.length > 0 ? [...a.quads] : [a.rect] }
    case 'Ink':
      if (a.ink.length > 0) return { ...base, kind: 'ink', width, paths: a.ink.map((p) => [...p]) }
      break
    case 'Polygon':
    case 'PolyLine': {
      const [first] = a.vertices
      if (!first) break
      const path = a.subtype === 'Polygon' ? [...a.vertices, first] : [...a.vertices]
      return { ...base, kind: 'ink', width, paths: [path] }
    }
    case 'Square':
    case 'Circle':
      return {
        ...base,
        kind: a.subtype === 'Square' ? 'rect' : 'ellipse',
        width,
        rect: inset(a.rect, width / 2)
      }
    case 'Line':
      if (a.line) return { ...base, kind: 'line', width, from: a.line[0], to: a.line[1] }
      break
  }
  return { ...base, kind: 'image', rect: a.rect, rotate: 0, src: '', signature: false }
}
