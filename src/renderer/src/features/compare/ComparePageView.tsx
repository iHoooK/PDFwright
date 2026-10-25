import { memo, useEffect, useRef } from 'react'
import { MASK_ADDED, MASK_REMOVED } from '@shared/compare'
import { CSS_UNITS, type PdfDocument } from '@renderer/pdf-engine/engine'
import type { PageHighlight } from '@renderer/pdf-engine/highlight'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import { PdfPageView } from '@renderer/features/viewer/PdfPageView'
import { COMPARE_SCALE, type DiffMask, type PageResult } from './compare-page'
import s from './compare.module.css'

const NO_HIGHLIGHTS: readonly PageHighlight[] = []

/** Маска отличий поверх страницы: удалённое красным, добавленное зелёным. */
function MaskCanvas({ mask, scale }: { mask: DiffMask; scale: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    canvas.width = mask.width
    canvas.height = mask.height
    const image = context.createImageData(mask.width, mask.height)
    const { data } = image
    for (let i = 0; i < mask.mask.length; i += 1) {
      const value = mask.mask[i]
      if (value === MASK_REMOVED) data.set([214, 40, 28, 210], i * 4)
      else if (value === MASK_ADDED) data.set([16, 140, 16, 210], i * 4)
    }
    context.putImageData(image, 0, 0)
  }, [mask])
  const k = scale / COMPARE_SCALE
  return (
    <canvas
      ref={ref}
      className={s.mask}
      style={{ width: mask.width * k, height: mask.height * k }}
      data-diff-mask
    />
  )
}

interface Props {
  doc: PdfDocument
  /** Вторая версия: по ней задаётся размер заглушки, если страницы здесь нет. */
  counterpart: PdfDocument
  page: number
  zoom: number
  visible: boolean
  side: 'a' | 'b' | 'overlay'
  result: PageResult | undefined
  mask: DiffMask | null
  onNeedMask?: (page: number) => void
}

/**
 * Страница одной версии в сравнении: растр pdf.js и рамки отличий поверх.
 * В «Наложении» поверх страницы ещё и маска отличий по пикселям.
 */
export const ComparePageView = memo(function ComparePageView({
  doc,
  counterpart,
  page,
  zoom,
  visible,
  side,
  result,
  mask,
  onNeedMask
}: Props): React.JSX.Element {
  const scale = (zoom / 100) * CSS_UNITS
  const overlay = side === 'overlay'
  const needMask = overlay && visible && !mask && (result?.regions.length ?? 0) > 0

  useEffect(() => {
    if (needMask) onNeedMask?.(page)
  }, [needMask, onNeedMask, page])

  if (page > doc.numPages) {
    const size = counterpart.sizeOf(page)
    return (
      <div
        className={s.missing}
        style={{ width: size.width * scale, height: size.height * scale }}
        data-compare-side={side}
      >
        {t.compare.missing}
      </div>
    )
  }

  const whole = result?.status === 'added' || result?.status === 'removed' ? result.status : null
  return (
    <div className={s.side} data-compare-side={side}>
      <PdfPageView
        doc={doc}
        pageNumber={page}
        zoom={zoom}
        rotation={0}
        visible={visible}
        highlights={NO_HIGHLIGHTS}
        overlay={
          <div className={s.diffLayer}>
            {overlay && mask && <MaskCanvas mask={mask} scale={scale} />}
            {whole && <div className={cx(s.whole, s[whole])} />}
            {result?.regions.map((r, index) => (
              <div
                key={index}
                className={cx(s.region, s[`region-${side}`])}
                style={{
                  left: r.x * scale - 3,
                  top: r.y * scale - 3,
                  width: r.width * scale + 6,
                  height: r.height * scale + 6
                }}
                data-diff-region
              />
            ))}
          </div>
        }
      />
    </div>
  )
})
