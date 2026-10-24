import { segmentItem, type MatchPiece } from '@shared/pdf-search'

export interface PageHighlight {
  pieces: MatchPiece[]
  active: boolean
}

/**
 * Подсвечивает совпадения поиска в текстовом слое pdf.js: каждому фрагменту
 * текста соответствует свой span (`textDivs[i]` ↔ `itemsStr[i]`), внутри
 * которого текст режется на обычные и выделенные сегменты.
 */
export function applyHighlights(
  textDivs: readonly HTMLElement[],
  itemsStr: readonly string[],
  highlights: readonly PageHighlight[]
): void {
  const perItem = new Map<number, { start: number; end: number; active: boolean }[]>()
  for (const highlight of highlights) {
    for (const piece of highlight.pieces) {
      const list = perItem.get(piece.item) ?? []
      list.push({ start: piece.start, end: piece.end, active: highlight.active })
      perItem.set(piece.item, list)
    }
  }
  textDivs.forEach((div, index) => {
    const text = itemsStr[index] ?? ''
    const ranges = perItem.get(index)
    if (!ranges) {
      if (div.childElementCount > 0) div.textContent = text
      return
    }
    div.textContent = ''
    for (const segment of segmentItem(text, ranges)) {
      if (segment.mark === 'none') {
        div.append(document.createTextNode(segment.text))
      } else {
        const mark = document.createElement('mark')
        mark.className = segment.mark === 'active' ? 'highlight selected' : 'highlight'
        mark.textContent = segment.text
        div.append(mark)
      }
    }
  })
}
