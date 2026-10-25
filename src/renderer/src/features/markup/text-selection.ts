import {
  invert,
  mergeLineRects,
  transformRect,
  viewMatrix,
  type Rect
} from '@shared/markup/geometry'
import type { PdfDocument, Rotation } from '@renderer/pdf-engine/engine'

/**
 * Выделение в текстовом слое pdf.js → прямоугольники строк в координатах
 * страниц. Прямоугольники берутся по текстовым узлам, а не по всему Range:
 * иначе при выделении через границу страниц в список попадает рамка целой
 * страницы. Возвращает карту «номер страницы → строки».
 */
export function selectionToPageRects(
  scroller: HTMLElement,
  doc: PdfDocument,
  scale: number,
  rotation: Rotation
): Map<number, Rect[]> {
  const selection = window.getSelection()
  const result = new Map<number, Rect[]>()
  if (!selection || selection.isCollapsed) return result
  for (let r = 0; r < selection.rangeCount; r += 1) {
    const range = selection.getRangeAt(r)
    const common = range.commonAncestorContainer
    const root = common.nodeType === Node.TEXT_NODE ? common.parentNode : common
    if (!root || !scroller.contains(root)) continue
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue
      const element = node.parentElement
      if (!element?.closest('.textLayer')) continue
      const pageElement = element.closest<HTMLElement>('[data-page]')
      const pageNumber = Number(pageElement?.dataset.page)
      if (!pageElement || !Number.isInteger(pageNumber) || pageNumber < 1) continue
      const length = node.textContent?.length ?? 0
      const start = node === range.startContainer ? range.startOffset : 0
      const end = node === range.endContainer ? range.endOffset : length
      if (end <= start) continue
      const piece = document.createRange()
      piece.setStart(node, start)
      piece.setEnd(node, end)
      const origin = pageElement.getBoundingClientRect()
      const geometry = doc.geometryOf(pageNumber)
      const toPage = invert(viewMatrix(geometry.box, geometry.rotate + rotation, scale))
      const rects = result.get(pageNumber) ?? []
      for (const client of piece.getClientRects()) {
        rects.push(
          transformRect(toPage, {
            x: client.left - origin.left,
            y: client.top - origin.top,
            width: client.width,
            height: client.height
          })
        )
      }
      result.set(pageNumber, rects)
    }
  }
  for (const [page, rects] of result) {
    const lines = mergeLineRects(rects)
    if (lines.length > 0) result.set(page, lines)
    else result.delete(page)
  }
  return result
}
