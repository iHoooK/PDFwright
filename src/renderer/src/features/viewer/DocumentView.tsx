import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newMarkupId, type MarkupObject } from '@shared/markup/model'
import { CSS_UNITS, type PdfDocument } from '@renderer/pdf-engine/engine'
import type { PageHighlight } from '@renderer/pdf-engine/highlight'
import { useStore, type DocTab, type StyledTool, type Tool } from '@renderer/app/store'
import { cx } from '@renderer/components/cx'
import { loadMarkupFont } from '@renderer/features/markup/font'
import { MarkupLayer } from '@renderer/features/markup/MarkupLayer'
import { useMarkupByPage } from '@renderer/features/markup/by-page'
import type { ContentTarget, SelectionTarget } from '@renderer/features/markup/selection'
import { ContentLayer } from '@renderer/features/content/ContentLayer'
import { selectionToPageRects } from '@renderer/features/markup/text-selection'
import { PdfPageView, type PageForms } from './PdfPageView'
import s from './viewer.module.css'
import { t } from '@renderer/i18n'

const NO_MARKUP: readonly MarkupObject[] = []
const NO_TARGETS: readonly SelectionTarget[] = []
const NO_GROUP: readonly ContentTarget[] = []

/** Стиль какого инструмента применяется к новым объектам. */
function styledTool(tool: Tool): StyledTool {
  return tool === 'marker' ||
    tool === 'pen' ||
    tool === 'shapes' ||
    tool === 'text' ||
    tool === 'note'
    ? tool
    : 'pen'
}

const PAD = 24
const GAP = 20

/**
 * Где прокрутка показывает страницу от верха (top) и до низа (bottom), px.
 * Считается по рамкам, а не offsetTop: offsetParent — не область прокрутки.
 */
function pageSpan(scroller: HTMLElement, page: HTMLElement): { top: number; bottom: number } {
  const offset =
    page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  return {
    top: Math.max(0, offset - PAD),
    bottom: offset + page.offsetHeight + PAD - scroller.clientHeight
  }
}
/** Допуск края прокрутки, px: при масштабе экрана Windows scrollTop дробный. */
const EDGE = 2

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
  /** Время последней прокрутки: «По одной» листает, только когда край уже достигнут. */
  const lastScrollAt = useRef(0)
  const onScroll = useCallback(() => {
    lastScrollAt.current = performance.now()
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
  /** «По одной», листание назад: предыдущая страница открывается с низа, как в других просмотрщиках. */
  const landAtBottom = useRef<number | null>(null)
  useEffect(() => {
    const request = state.scrollRequest
    const scroller = scrollerRef.current
    if (!request || !scroller) return
    const target = scroller.querySelector<HTMLElement>(`[data-page="${request.page}"]`)
    if (!target) return
    suppressScrollUntil.current = performance.now() + 200
    const { top, bottom } = pageSpan(scroller, target)
    const y = landAtBottom.current === request.page ? Math.max(top, bottom) : top
    scroller.scrollTo({ top: y, behavior: 'auto' })
  }, [state.scrollRequest, resolvedZoom, scrollMode])

  // «По одной»: у края страницы колесо, стрелки и пробел переходят на соседнюю.
  const page = state.page
  const lastPage = tab.pages
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || scrollMode !== 'single') return
    let flippedAt = 0
    const atTop = (): boolean => scroller.scrollTop <= EDGE
    const atBottom = (): boolean =>
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE
    // Край считается достигнутым, когда прокрутка у него уже остановилась: один
    // разгон колеса не пролистывает страницу сразу после того, как доехал до края.
    const resting = (): boolean => performance.now() - lastScrollAt.current > 150
    const flip = (delta: 1 | -1): boolean => {
      const next = page + delta
      if (next < 1 || next > lastPage) return false
      const now = performance.now()
      if (now - flippedAt < 400 || !resting()) return true
      flippedAt = now
      landAtBottom.current = delta < 0 ? next : null
      actions.setPage(next)
      return true
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.deltaY === 0) return
      landAtBottom.current = null
      const edge = event.deltaY > 0 ? atBottom() : atTop()
      if (edge && flip(event.deltaY > 0 ? 1 : -1)) event.preventDefault()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return
      const target = event.target
      const space = event.key === ' '
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return
        if (target.closest('input, textarea, select, dialog, [role="menu"]')) return
        // Пробел на кнопке нажимает её, а не листает документ.
        if (space && target.closest('button, a, [role="button"]')) return
      }
      const forward = event.key === 'ArrowDown' || (space && !event.shiftKey)
      const backward = event.key === 'ArrowUp' || (space && event.shiftKey)
      if (!forward && !backward) return
      event.preventDefault()
      landAtBottom.current = null
      if (forward ? atBottom() : atTop()) {
        lastScrollAt.current = 0
        flip(forward ? 1 : -1)
        return
      }
      const step = space ? scroller.clientHeight * 0.9 : 48
      scroller.scrollBy({ top: forward ? step : -step, behavior: 'auto' })
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [actions, scrollMode, page, lastPage])

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

  const markupByPage = useMarkupByPage(tab.markup)
  const selectedContent = state.selection?.source === 'content' ? state.selection : null
  // Выбранные объекты «Выделения» по страницам: разметка и аннотации документа.
  const selectedByPage = useMemo(() => {
    const map = new Map<number, SelectionTarget[]>()
    for (const target of state.selectionGroup) {
      const page =
        target.source === 'markup' ? tab.markup.find((o) => o.id === target.id)?.page : target.page
      if (page === undefined) continue
      const list = map.get(page) ?? []
      list.push(target)
      map.set(page, list)
    }
    return map
  }, [state.selectionGroup, tab.markup])
  // Группа объектов документа в «Правке» по страницам.
  const contentGroupByPage = useMemo(() => {
    const map = new Map<number, ContentTarget[]>()
    for (const target of state.contentGroup) {
      const list = map.get(target.page) ?? []
      list.push(target)
      map.set(target.page, list)
    }
    return map
  }, [state.contentGroup])
  const scale = (resolvedZoom / 100) * CSS_UNITS
  const tool = state.tool
  const style = state.toolStyles[styledTool(tool)]
  // Поля форм заполняются в «Выделении»; в других инструментах они только видны.
  const forms = useMemo<PageForms>(
    () => ({
      values: tab.forms,
      enabled: tool === 'select',
      onChange: actions.setFormValue,
      onUndo: actions.undo,
      onRedo: actions.redo
    }),
    [tab.forms, tool, actions]
  )

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
      aria-label={t.a11y.document}
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
          forms={forms}
          overlay={
            visiblePages.has(n) || scrollMode === 'single' ? (
              <>
                <MarkupLayer
                  doc={doc}
                  bytes={tab.bytes}
                  geometry={doc.geometryOf(n)}
                  pageNumber={n}
                  scale={scale}
                  rotation={rotation}
                  objects={markupByPage.get(n) ?? NO_MARKUP}
                  selected={selectedByPage.get(n) ?? NO_TARGETS}
                  groupSize={state.selectionGroup.length}
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
                    textStyle={state.contentTextStyle}
                    group={contentGroupByPage.get(n) ?? NO_GROUP}
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
