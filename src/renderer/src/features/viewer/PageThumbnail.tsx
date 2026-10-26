import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { MarkupObject } from '@shared/markup/model'
import { IconCheck } from '@renderer/icons'
import {
  createCancelToken,
  renderPageToCanvas,
  viewportFor,
  type PdfDocument,
  type Rotation
} from '@renderer/pdf-engine/engine'
import { MarkupPreview } from '@renderer/features/markup/MarkupShapes'
import s from './pdf-page.module.css'

interface Props {
  doc: PdfDocument
  pageNumber: number
  rotation: Rotation
  current?: boolean
  selected?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onDoubleClick?: () => void
  /** Несохранённая разметка страницы: рисуется поверх растра, пока документ не сохранён. */
  markup?: readonly MarkupObject[] | undefined
}

const THUMB_WIDTH = 160

/**
 * Миниатюра страницы для боковой панели и режима «Страницы». Рисуется только
 * когда попадает в область прокрутки, после этого растр сохраняется.
 */
export const PageThumbnail = memo(function PageThumbnail({
  doc,
  pageNumber,
  rotation,
  current,
  selected,
  onClick,
  onDoubleClick,
  markup
}: Props): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!near || !canvas) return
    const run = createCancelToken()
    const refs: { cancel: (() => void) | null } = { cancel: null }
    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (run.isCancelled()) return
        const base = viewportFor(page, 1, rotation)
        const viewport = viewportFor(page, THUMB_WIDTH / base.width, rotation)
        const handle = renderPageToCanvas(
          page,
          canvas,
          viewport,
          Math.min(2, window.devicePixelRatio || 1)
        )
        refs.cancel = handle.cancel
        return handle.done
      })
      .catch((error: unknown) => {
        if (!run.isCancelled()) console.error(`[thumb] страница ${pageNumber}:`, error)
      })
    return () => {
      run.cancel()
      refs.cancel?.()
    }
  }, [doc, pageNumber, rotation, near])

  const size = doc.sizeOf(pageNumber)
  const sideways = rotation === 90 || rotation === 270
  const ratio = sideways ? size.width / size.height : size.height / size.width
  const selectable = selected !== undefined

  return (
    <button
      ref={ref}
      type="button"
      className={s.thumb}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...(current === undefined ? {} : { 'aria-current': current })}
      {...(selectable ? { 'aria-selected': selected } : {})}
    >
      <span className={s.thumbFrame} style={{ aspectRatio: `1 / ${ratio}` }}>
        <canvas ref={canvasRef} className={s.thumbCanvas} />
        {near && markup && markup.length > 0 && (
          <MarkupPreview
            geometry={doc.geometryOf(pageNumber)}
            rotation={rotation}
            objects={markup}
          />
        )}
        {selectable && (
          <span className={s.check} aria-hidden="true">
            {selected && <IconCheck />}
          </span>
        )}
      </span>
      <small>{pageNumber}</small>
    </button>
  )
})
