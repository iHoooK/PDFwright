import {
  diffLines,
  diffRasters,
  hasTextChanges,
  linesFromPieces,
  presenceStatus,
  type LineChange,
  type PageStatus,
  type Raster
} from '@shared/compare'
import { renderPageToCanvas, viewportFor, type PdfDocument } from '@renderer/pdf-engine/engine'

/** Масштаб растров для сравнения: 1.5 пикселя на пункт (108 dpi) для обеих версий. */
export const COMPARE_SCALE = 1.5

/** Рамка отличия в пунктах страницы от её левого верхнего угла. */
export interface PointRect {
  x: number
  y: number
  width: number
  height: number
}

/** Маска отличий страницы в пикселях растра сравнения. */
export interface DiffMask {
  width: number
  height: number
  mask: Uint8Array
}

export interface PageResult {
  status: Exclude<PageStatus, 'pending'>
  regions: PointRect[]
  text: LineChange[]
  /** Страницу не удалось отрисовать или прочитать. */
  failed?: boolean
}

/** Холсты для растров, чтобы не создавать их на каждой странице. */
export interface Canvases {
  a: HTMLCanvasElement
  b: HTMLCanvasElement
}

export function createCanvases(): Canvases {
  return { a: document.createElement('canvas'), b: document.createElement('canvas') }
}

export function releaseCanvases(canvases: Canvases): void {
  for (const canvas of [canvases.a, canvases.b]) {
    canvas.width = 0
    canvas.height = 0
  }
}

async function renderRaster(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement
): Promise<Raster> {
  const page = await doc.getPage(pageNumber)
  const viewport = viewportFor(page, COMPARE_SCALE, 0)
  await renderPageToCanvas(page, canvas, viewport, 1).done
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D недоступен')
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

async function pageLines(doc: PdfDocument, pageNumber: number): Promise<string[]> {
  if (pageNumber > doc.numPages) return []
  const content = await doc.getTextContent(pageNumber)
  return linesFromPieces(
    content.items.map((item) =>
      'str' in item
        ? { str: item.str, hasEOL: item.hasEOL, y: Number(item.transform[5]) }
        : { str: '' }
    )
  )
}

/**
 * Сравнивает страницу pageNumber двух версий: растры в одном масштабе и текст.
 * Страница, которая есть только в одной версии, помечается добавленной или удалённой.
 */
export async function comparePage(
  a: PdfDocument,
  b: PdfDocument,
  pageNumber: number,
  canvases: Canvases
): Promise<{ result: PageResult; mask: DiffMask | null }> {
  const text = diffLines(await pageLines(a, pageNumber), await pageLines(b, pageNumber))
  const presence = presenceStatus(pageNumber, a.numPages, b.numPages)
  if (presence) return { result: { status: presence, regions: [], text }, mask: null }

  const diff = diffRasters(
    await renderRaster(a, pageNumber, canvases.a),
    await renderRaster(b, pageNumber, canvases.b)
  )
  const regions = diff.regions.map((r) => ({
    x: r.x / COMPARE_SCALE,
    y: r.y / COMPARE_SCALE,
    width: r.width / COMPARE_SCALE,
    height: r.height / COMPARE_SCALE
  }))
  const changed = regions.length > 0 || hasTextChanges(text)
  return {
    result: { status: changed ? 'changed' : 'same', regions, text },
    mask: regions.length > 0 ? { width: diff.width, height: diff.height, mask: diff.mask } : null
  }
}
