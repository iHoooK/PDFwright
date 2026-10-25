import { memo, useEffect, useRef, type ReactNode } from 'react'
import {
  createCancelToken,
  CSS_UNITS,
  renderPageToCanvas,
  TextLayer,
  viewportFor,
  type PdfDocument,
  type Rotation
} from '@renderer/pdf-engine/engine'
import { applyHighlights, type PageHighlight } from '@renderer/pdf-engine/highlight'
import s from './pdf-page.module.css'

interface Props {
  doc: PdfDocument
  pageNumber: number
  /** Масштаб в процентах интерфейса (100 = 96 dpi). */
  zoom: number
  rotation: Rotation
  /** Страница рядом с видимой областью: рисуем; иначе держим пустой холст нужного размера. */
  visible: boolean
  highlights: readonly PageHighlight[]
  /** Слой разметки поверх текстового слоя (только у страниц рядом с экраном). */
  overlay?: ReactNode
  onRendered?: (pageNumber: number) => void
}

/**
 * Одна страница документа: canvas с растром и текстовый слой pdf.js поверх.
 * Размер задаётся сразу из известных размеров страницы, чтобы прокрутка
 * не прыгала, пока рендер ещё не закончился.
 */
export const PdfPageView = memo(function PdfPageView({
  doc,
  pageNumber,
  zoom,
  rotation,
  visible,
  highlights,
  overlay,
  onRendered
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<TextLayer | null>(null)
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights

  const scale = (zoom / 100) * CSS_UNITS
  const size = doc.sizeOf(pageNumber)
  const sideways = rotation === 90 || rotation === 270
  const cssWidth = (sideways ? size.height : size.width) * scale
  const cssHeight = (sideways ? size.width : size.height) * scale

  useEffect(() => {
    const canvas = canvasRef.current
    const textContainer = textRef.current
    if (!canvas || !textContainer) return
    if (!visible) {
      canvas.width = 0
      canvas.height = 0
      textContainer.replaceChildren()
      textLayerRef.current = null
      return
    }
    const run = createCancelToken()
    const refs: { cancelRender: (() => void) | null; textLayer: TextLayer | null } = {
      cancelRender: null,
      textLayer: null
    }
    void (async () => {
      const page = await doc.getPage(pageNumber)
      if (run.isCancelled()) return
      const viewport = viewportFor(page, scale, rotation)
      const handle = renderPageToCanvas(page, canvas, viewport, window.devicePixelRatio || 1)
      refs.cancelRender = handle.cancel
      const textContent = await doc.getTextContent(pageNumber)
      if (run.isCancelled()) return
      textContainer.replaceChildren()
      textContainer.style.setProperty('--total-scale-factor', String(viewport.scale))
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textContainer,
        viewport
      })
      refs.textLayer = textLayer
      textLayerRef.current = textLayer
      await Promise.all([handle.done, textLayer.render()])
      if (run.isCancelled()) return
      applyHighlights(textLayer.textDivs, textLayer.textContentItemsStr, highlightsRef.current)
      onRendered?.(pageNumber)
    })().catch((error: unknown) => {
      if (!run.isCancelled()) console.error(`[viewer] страница ${pageNumber} не отрисована:`, error)
    })
    return () => {
      run.cancel()
      refs.cancelRender?.()
      refs.textLayer?.cancel()
    }
  }, [doc, pageNumber, scale, rotation, visible, onRendered])

  // Подсветка меняется чаще, чем рендер: обновляем только span'ы текстового слоя.
  useEffect(() => {
    const layer = textLayerRef.current
    if (layer && visible) applyHighlights(layer.textDivs, layer.textContentItemsStr, highlights)
  }, [highlights, visible])

  return (
    <div
      className={s.page}
      style={{ width: cssWidth, height: cssHeight }}
      data-page={pageNumber}
      aria-label={`Страница ${pageNumber}`}
    >
      <canvas ref={canvasRef} className={s.canvas} />
      <div ref={textRef} className="textLayer" />
      {overlay}
    </div>
  )
})
