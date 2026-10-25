import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newMarkupId, type MarkupObject } from '@shared/markup/model'
import { CSS_UNITS, type PdfDocument } from '@renderer/pdf-engine/engine'
import type { PageHighlight } from '@renderer/pdf-engine/highlight'
import { useStore, type DocTab, type StyledTool, type Tool } from '@renderer/app/store'
import { cx } from '@renderer/components/cx'
import { loadMarkupFont } from '@renderer/features/markup/font'
import { MarkupLayer } from '@renderer/features/markup/MarkupLayer'
import { selectedMarkupId } from '@renderer/features/markup/selection'
import { ContentLayer } from '@renderer/features/content/ContentLayer'
import { selectionToPageRects } from '@renderer/features/markup/text-selection'
import { PdfPageView } from './PdfPageView'
import s from './viewer.module.css'

const NO_MARKUP: readonly MarkupObject[] = []

/** Стиль какого инструмента применяется к новым объектам. */
function styledTool(tool: Tool): StyledTool {
  return tool === 'marker' || tool === 'pen' || tool === 'shapes' || tool === 'text' ? tool : 'pen'
}

const PAD = 24
const GAP = 20

/**
 * Область документа: раскладка страниц, видимость (рендерим только страницы
 * около экрана), определение текущей страницы по прокрутке, масштаб
 * «по ширине / целиком» и переход к странице по запросу из панелей.
 */
export function DocumentView({ tab, doc }: { tab: DocTab; doc: PdfDocument }): React.JSX.Element {
  const { state, actions } = useStore()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(() => new Set([1, 2]))
  const scrollMode = state.settings.viewer.scrollMode
  const { rotation, zoom } = state

  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setContainerSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    setContainerSize({ width: element.clientWidth, height: element.clientHeight })
    return () => {
      observer.disconnect()
    }
  }, [])

  // Масштаб «по ширине» и «целиком» считаем от размера контейнера и первой страницы.
  const sideways = rotation === 90 || rotation === 270
  const first = doc.sizeOf(state.page)
  const pageW = sideways ? first.height : first.width
  const pageH = sideways ? first.width : first.height
  const columns = scrollMode === 'spread' ? 2 : 1
  const resolvedZoom = useMemo(() => {
    if (zoom.mode === 'custom' || containerSize.width === 0) return zoom.percent
    const availableW = (containerSize.width - PAD * 2 - GAP * (columns - 1)) / columns
    const availableH = containerSize.height - PAD * 2
    const byWidth = (availableW / (pageW * CSS_UNITS)) * 100
    const byHeight = (availableH / (pageH * CSS_UNITS)) * 100
    const percent = zoom.mode === 'fit-width' ? byWidth : Math.min(byWidth, byHeight)
    return Math.max(10, Math.min(800, Math.floor(percent)))
  }, [zoom, containerSize, pageW, pageH, columns])

  useEffect(() => {
    if (resolvedZoom !== state.resolvedZoom) actions.setResolvedZoom(resolvedZoom)
  }, [resolvedZoom, state.resolvedZoom, actions])

  // Какие страницы рисовать: пересечение с областью прокрутки плюс запас в один экран.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const n = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(n)
            else next.delete(n)
          }
          return next
        })
      },
      { root: scroller, rootMargin: '100% 0px' }
    )
    scroller.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      observer.observe(el)
    })
    return () => {
      observer.disconnect()
    }
  }, [doc, scrollMode, tab.pages, tab.sizesVersion, state.page])

  // Текущая страница — та, что пересекает горизонтальную ось центра экрана.
  const suppressScrollUntil = useRef(0)
  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || performance.now() < suppressScrollUntil.current) return
    const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 2
    let bestPage = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (const el of scroller.querySelectorAll<HTMLElement>('[data-page]')) {
      const rect = el.getBoundingClientRect()
      const distance =
        rect.top <= middle && rect.bottom >= middle
          ? 0
          : Math.min(Math.abs(rect.top - middle), Math.abs(rect.bottom - middle))
      if (distance < bestDistance) {
        bestDistance = distance
        bestPage = Number(el.dataset.page)
      }
    }
    if (bestPage > 0 && bestPage !== state.page) actions.pageFromScroll(bestPage)
  }, [actions, state.page])

  // Переход к странице по запросу (миниатюра, закладка, поиск, PageDown).
  useEffect(() => {
    const request = state.scrollRequest
    const scroller = scrollerRef.current
    if (!request || !scroller) return
    const target = scroller.querySelector<HTMLElement>(`[data-page="${request.page}"]`)
    if (!target) return
    suppressScrollUntil.current = performance.now() + 200
    scroller.scrollTo({ top: target.offsetTop - PAD, behavior: 'auto' })
  }, [state.scrollRequest, resolvedZoom, scrollMode])

  // Ctrl+колесо — масштаб.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      actions.zoomBy(event.deltaY < 0 ? 1 : -1)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [actions])

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, PageHighlight[]>()
    state.search.matches.forEach((m, index) => {
      const list = map.get(m.page) ?? []
      list.push({ pieces: m.match.pieces, active: index === state.search.active })
      map.set(m.page, list)
    })
    return map
  }, [state.search.matches, state.search.active])
  const none: PageHighlight[] = useMemo(() => [], [])

  const pageNumbers =
    scrollMode === 'single' ? [state.page] : Array.from({ length: tab.pages }, (_, i) => i + 1)

  // Шрифт текстовых блоков грузится заранее, чтобы размеры блоков сразу были точными.
  useEffect(() => {
    loadMarkupFont().catch((error: unknown) => {
      console.error('[markup] шрифт не загружен:', error)
    })
  }, [])

  const markupByPage = useMemo(() => {
    const map = new Map<number, MarkupObject[]>()
    for (const o of tab.markup) {
      const list = map.get(o.page) ?? []
      list.push(o)
      map.set(o.page, list)
    }
    return map
  }, [tab.markup])
  const selectedId = selectedMarkupId(state.selection)
  const selectedContent = state.selection?.source === 'content' ? state.selection : null
  const selectedPage = tab.markup.find((o) => o.id === selectedId)?.page ?? null
  const scale = (resolvedZoom / 100) * CSS_UNITS
  const tool = state.tool
  const style = state.toolStyles[styledTool(tool)]

  // «Маркер»: отпускание кнопки после выделения текста превращает выделение в пометку.
  const onPointerUp = useCallback(() => {
    if (state.tool !== 'marker') return
    const scroller = scrollerRef.current
    if (!scroller) return
    const rectsByPage = selectionToPageRects(scroller, doc, scale, rotation)
    if (rectsByPage.size === 0) return
    const marker = state.toolStyles.marker
    for (const [page, rects] of rectsByPage) {
      actions.addMarkup(
        {
          id: newMarkupId(),
          page,
          kind: state.markKind,
          color: marker.color,
          opacity: marker.opacity,
          rects
        },
        false
      )
    }
    window.getSelection()?.removeAllRanges()
  }, [actions, doc, rotation, scale, state.markKind, state.tool, state.toolStyles.marker])

  return (
    <div
      ref={scrollerRef}
      className={cx(
        s.canvas,
        scrollMode === 'spread' && s.spread,
        state.tool === 'hand' && s.handCursor
      )}
      onScroll={onScroll}
      onPointerUp={onPointerUp}
      aria-label="Документ"
      data-tool={tool}
    >
      {pageNumbers.map((n) => (
        <PdfPageView
          key={n}
          doc={doc}
          pageNumber={n}
          zoom={resolvedZoom}
          rotation={rotation}
          visible={visiblePages.has(n) || scrollMode === 'single'}
          highlights={highlightsByPage.get(n) ?? none}
          overlay={
            visiblePages.has(n) || scrollMode === 'single' ? (
              <>
                <MarkupLayer
                  geometry={doc.geometryOf(n)}
                  pageNumber={n}
                  scale={scale}
                  rotation={rotation}
                  objects={markupByPage.get(n) ?? NO_MARKUP}
                  selectedId={selectedPage === n ? selectedId : null}
                  tool={tool}
                  style={style}
                  shapeKind={state.shapeKind}
                  actions={actions}
                />
                {tool === 'edit' && tab.bytes && (
                  <ContentLayer
                    geometry={doc.geometryOf(n)}
                    pageNumber={n}
                    scale={scale}
                    rotation={rotation}
                    bytes={tab.bytes}
                    mode={state.contentMode}
                    selected={selectedContent?.page === n ? selectedContent : null}
                    actions={actions}
                  />
                )}
              </>
            ) : undefined
          }
        />
      ))}
    </div>
  )
}
