import { memo, useEffect, useRef, type ReactNode } from 'react'
import type { FormValues } from '@shared/pdf-ops/forms'
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
import { cx } from '@renderer/components/cx'
import { FormLayerController, type FormLayerCallbacks } from '@renderer/features/forms/form-layer'
import s from './pdf-page.module.css'
import { t } from '@renderer/i18n'

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
  /** Поля формы на странице: несохранённые значения вкладки и обработчики правок. */
  forms?: PageForms
  onRendered?: (pageNumber: number) => void
}

export interface PageForms extends FormLayerCallbacks {
  values: FormValues
  /** Поля принимают ввод (инструмент «Выделение»); иначе только видны. */
  enabled: boolean
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
  forms,
  onRendered
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<TextLayer | null>(null)
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights
  const formRef = useRef<HTMLDivElement | null>(null)
  const formLayerRef = useRef<FormLayerController | null>(null)
  const formsRef = useRef(forms)
  formsRef.current = forms
  const withForms = forms !== undefined

  const scale = (zoom / 100) * CSS_UNITS
  const size = doc.sizeOf(pageNumber)
  const sideways = rotation === 90 || rotation === 270
  const cssWidth = (sideways ? size.height : size.width) * scale
  const cssHeight = (sideways ? size.width : size.height) * scale

  useEffect(() => {
    const canvas = canvasRef.current
    const textContainer = textRef.current
    const formContainer = formRef.current
    if (!canvas || !textContainer) return
    if (!visible) {
      canvas.width = 0
      canvas.height = 0
      textContainer.replaceChildren()
      textLayerRef.current = null
      return
    }
    const run = createCancelToken()
    const refs: {
      cancelRender: (() => void) | null
      textLayer: TextLayer | null
      formLayer: FormLayerController | null
    } = {
      cancelRender: null,
      textLayer: null,
      formLayer: null
    }
    // Поля форм показывает отдельный слой; холст рисует только их вид флажков.
    const formCanvases = withForms ? new Map<string, HTMLCanvasElement>() : undefined
    void (async () => {
      const page = await doc.getPage(pageNumber)
      if (run.isCancelled()) return
      const viewport = viewportFor(page, scale, rotation)
      const handle = renderPageToCanvas(
        page,
        canvas,
        viewport,
        window.devicePixelRatio || 1,
        formCanvases
      )
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
      const current = formsRef.current
      if (formContainer && formCanvases && current) {
        formContainer.style.setProperty('--scale-factor', String(viewport.scale))
        formContainer.style.setProperty('--total-scale-factor', String(viewport.scale))
        const formLayer = new FormLayerController({
          doc,
          page,
          viewport,
          div: formContainer,
          canvases: formCanvases,
          // Обработчики берутся из последних props: слой живёт дольше одного рендера.
          onChange: (name, value, coalesce) => {
            formsRef.current?.onChange(name, value, coalesce)
          },
          onUndo: () => {
            formsRef.current?.onUndo()
          },
          onRedo: () => {
            formsRef.current?.onRedo()
          }
        })
        refs.formLayer = formLayer
        formLayerRef.current = formLayer
        await formLayer.init(current.values)
        if (run.isCancelled()) return
        formLayer.sync(formsRef.current?.values ?? current.values)
      }
      onRendered?.(pageNumber)
    })().catch((error: unknown) => {
      if (!run.isCancelled()) console.error(`[viewer] страница ${pageNumber} не отрисована:`, error)
    })
    return () => {
      run.cancel()
      refs.cancelRender?.()
      refs.textLayer?.cancel()
      refs.formLayer?.destroy()
      if (formLayerRef.current === refs.formLayer) formLayerRef.current = null
    }
  }, [doc, pageNumber, scale, rotation, visible, withForms, onRendered])

  // Значения полей поменялись не из слоя (отмена, повтор, сброс) — слой обновляется сам.
  const formValues = forms?.values
  useEffect(() => {
    if (formValues && visible) formLayerRef.current?.sync(formValues)
  }, [formValues, visible])

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
      aria-label={t.a11y.page(pageNumber)}
    >
      <canvas ref={canvasRef} className={s.canvas} />
      <div ref={textRef} className="textLayer" />
      {forms && (
        <div
          ref={formRef}
          className={cx('annotationLayer', s.forms, !forms.enabled && 'disabled')}
          data-forms-layer=""
        />
      )}
      {overlay}
    </div>
  )
})
