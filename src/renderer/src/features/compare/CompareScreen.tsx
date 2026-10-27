import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isDifference, nextDifference } from '@shared/compare'
import { IconBack, IconChevronRight, IconPages, IconView } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import { Command } from '@renderer/components/controls'
import { CSS_UNITS, type PdfDocument } from '@renderer/pdf-engine/engine'
import { useStore, type CompareSession, type DocTab } from '@renderer/app/store'
import { ComparePageView } from './ComparePageView'
import { TextDiffPanel } from './TextDiffPanel'
import { useComparison } from './useComparison'
import s from './compare.module.css'

type Mode = 'columns' | 'overlay'

const PAD = 20
const GAP = 16

/** Экран сравнения активного документа со второй версией из сессии сравнения. */
export function CompareScreen(): React.JSX.Element | null {
  const { state } = useStore()
  const session = state.compare
  const tab = session ? state.docs.find((d) => d.id === session.baseId) : undefined
  if (!session || !tab?.doc) return null
  return <CompareView key={session.id} session={session} tab={tab} base={tab.doc} />
}

function CompareView({
  session,
  tab,
  base
}: {
  session: CompareSession
  tab: DocTab
  base: PdfDocument
}): React.JSX.Element {
  const { actions } = useStore()
  const other = session.doc
  const comparison = useComparison(base, other)
  const { results, masks, total, prioritize, requestMask } = comparison
  const [mode, setMode] = useState<Mode>('columns')
  const [selected, setSelected] = useState(1)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set([1, 2]))
  const [, setSizesVersion] = useState(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const suppressScrollUntil = useRef(0)

  // Размеры страниц второй версии читаются по мере загрузки, раскладка обновляется.
  useEffect(() => {
    void other.loadSizes(() => {
      setSizesVersion((v) => v + 1)
    })
  }, [other])

  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth)
    })
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => {
      observer.disconnect()
    }
  }, [])

  // Один масштаб для обеих версий: по ширине колонки и более широкой первой странице.
  const columns = mode === 'columns' ? 2 : 1
  const pageWidth = Math.max(base.sizeOf(1).width, other.sizeOf(1).width)
  const zoom =
    width === 0
      ? 50
      : Math.max(
          10,
          Math.min(
            mode === 'overlay' ? 150 : 200,
            Math.floor(
              ((width - PAD * 2 - GAP * (columns - 1)) / columns / (pageWidth * CSS_UNITS)) * 100
            )
          )
        )

  // Какие строки рисовать: пересечение с областью прокрутки плюс запас в экран.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const n = Number((entry.target as HTMLElement).dataset.compareRow)
            if (entry.isIntersecting) next.add(n)
            else next.delete(n)
          }
          return next
        })
      },
      { root: scroller, rootMargin: '100% 0px' }
    )
    scroller.querySelectorAll<HTMLElement>('[data-compare-row]').forEach((el) => {
      observer.observe(el)
    })
    return () => {
      observer.disconnect()
    }
  }, [mode, total, zoom])

  // Видимые страницы сравниваются первыми.
  useEffect(() => {
    prioritize([...visible].filter((page) => !results.has(page)).sort((p, q) => p - q))
  }, [visible, results, prioritize])

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || performance.now() < suppressScrollUntil.current) return
    const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 2
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (const el of scroller.querySelectorAll<HTMLElement>('[data-compare-row]')) {
      const rect = el.getBoundingClientRect()
      const distance =
        rect.top <= middle && rect.bottom >= middle
          ? 0
          : Math.min(Math.abs(rect.top - middle), Math.abs(rect.bottom - middle))
      if (distance < bestDistance) {
        bestDistance = distance
        best = Number(el.dataset.compareRow)
      }
    }
    if (best > 0) setSelected(best)
  }, [])

  const scrollToRow = useCallback((page: number) => {
    const scroller = scrollerRef.current
    const row = scroller?.querySelector<HTMLElement>(`[data-compare-row="${page}"]`)
    if (!scroller || !row) return
    suppressScrollUntil.current = performance.now() + 250
    scroller.scrollTo({ top: row.offsetTop - PAD, behavior: 'auto' })
  }, [])

  // Пока к отличиям не переходили, «Следующее отличие» начинает с открытой страницы.
  const visited = useRef(false)
  const goTo = useCallback(
    (page: number) => {
      visited.current = true
      setSelected(page)
      scrollToRow(page)
    },
    [scrollToRow]
  )

  // Строка состояния окна показывает страницу сравнения, а не ту, что была в документе.
  useEffect(() => {
    if (selected <= base.numPages) actions.pageFromScroll(selected)
  }, [selected, base, actions])

  // После смены режима выбранная страница остаётся на экране.
  const selectedRef = useRef(selected)
  useLayoutEffect(() => {
    selectedRef.current = selected
  })
  useLayoutEffect(() => {
    if (selectedRef.current > 1) scrollToRow(selectedRef.current)
  }, [mode, scrollToRow])

  const differing = useMemo(
    () =>
      [...results]
        .filter(([, result]) => isDifference(result.status))
        .map(([page]) => page)
        .sort((p, q) => p - q),
    [results]
  )
  const finished = results.size >= total

  const onNext = (): void => {
    const first = !visited.current
    const page = nextDifference(differing, selected, first)
    if (page === null) {
      actions.toast(finished ? t.compare.same : t.compare.noneYet)
    } else if (first && page === selected) {
      goTo(page)
    } else if (page <= selected && !finished) {
      actions.toast(t.compare.stillRunning)
    } else if (page === selected) {
      actions.toast(t.compare.noMore)
    } else {
      goTo(page)
    }
  }

  // Esc — выход из сравнения к документу.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) actions.closeCompare()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [actions])

  const pages = Array.from({ length: total }, (_, i) => i + 1)
  const columnWidth = (width - PAD * 2 - GAP) / 2

  return (
    <div className={s.compare} data-compare-mode={mode}>
      <div className={s.cmdbar} role="toolbar" aria-label={t.compare.title}>
        <Command
          icon={<IconBack />}
          label={t.compare.back}
          hotkey="Esc"
          onClick={actions.closeCompare}
        />
        <span className={s.sep} />
        <Command
          icon={<IconPages />}
          label={t.compare.columns}
          pressed={mode === 'columns'}
          onClick={() => {
            setMode('columns')
          }}
        />
        <Command
          icon={<IconView />}
          label={t.compare.overlay}
          pressed={mode === 'overlay'}
          onClick={() => {
            setMode('overlay')
          }}
        />
        <span className={s.sep} />
        <Command icon={<IconChevronRight />} label={t.compare.next} onClick={onNext} />
        <span className={s.spacer} />
        <p className={s.files}>
          <span title={tab.path}>
            <b>{t.compare.base}:</b> {tab.name}
          </span>
          <span title={session.path}>
            <b>{t.compare.other}:</b> {session.name}
          </span>
        </p>
      </div>

      <aside className={s.list} aria-label={t.compare.pagesList}>
        <div className={s.progress} role="status" data-compare-done={finished}>
          <span>
            {finished
              ? differing.length === 0
                ? t.compare.same
                : t.compare.found(differing.length)
              : t.compare.progress(results.size, total)}
          </span>
          {!finished && (
            <span className={s.bar}>
              <span style={{ width: `${(results.size / Math.max(1, total)) * 100}%` }} />
            </span>
          )}
        </div>
        <h3>{t.compare.pagesList}</h3>
        {differing.length === 0 ? (
          <p className={s.muted}>{finished ? t.compare.same : t.compare.noneYet}</p>
        ) : (
          <div className={s.items}>
            {differing.map((page) => {
              const result = results.get(page)
              const status = result?.status
              return (
                <button
                  key={page}
                  type="button"
                  className={s.item}
                  data-diff-page={page}
                  aria-current={page === selected}
                  onClick={() => {
                    goTo(page)
                  }}
                >
                  <b>{t.compare.page(page)}</b>
                  <span className={cx(s.badge, status && s[status])}>
                    {result?.failed
                      ? t.compare.failed
                      : status === 'added' || status === 'removed' || status === 'changed'
                        ? t.compare.status[status]
                        : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <p className={s.legend}>{t.compare.legend}</p>
      </aside>

      <div
        ref={scrollerRef}
        className={s.scroller}
        aria-label={t.compare.pagesLabel}
        onScroll={onScroll}
      >
        {mode === 'columns' && width > 0 && (
          <div className={s.heads} style={{ gap: GAP }}>
            <span style={{ width: columnWidth }} title={tab.path}>
              {t.compare.base}: {tab.name}
            </span>
            <span style={{ width: columnWidth }} title={session.path}>
              {t.compare.other}: {session.name}
            </span>
          </div>
        )}
        {pages.map((page) => {
          const result = results.get(page)
          const near = visible.has(page)
          const status = result?.status ?? 'pending'
          return (
            <section
              key={page}
              className={s.row}
              data-compare-row={page}
              data-status={status}
              aria-current={page === selected}
              aria-label={t.compare.page(page)}
              onClick={() => {
                setSelected(page)
              }}
            >
              <span className={s.rowLabel}>
                {t.compare.page(page)}
                {(status === 'added' || status === 'removed' || status === 'changed') && (
                  <span className={cx(s.badge, s[status])}>{t.compare.status[status]}</span>
                )}
              </span>
              <div className={s.rowPages} style={{ gap: GAP }}>
                {mode === 'columns' ? (
                  <>
                    <ComparePageView
                      doc={base}
                      counterpart={other}
                      page={page}
                      zoom={zoom}
                      visible={near}
                      side="a"
                      result={result}
                      mask={null}
                    />
                    <ComparePageView
                      doc={other}
                      counterpart={base}
                      page={page}
                      zoom={zoom}
                      visible={near}
                      side="b"
                      result={result}
                      mask={null}
                    />
                  </>
                ) : (
                  <ComparePageView
                    doc={page > other.numPages ? base : other}
                    counterpart={base}
                    page={page}
                    zoom={zoom}
                    visible={near}
                    side="overlay"
                    result={result}
                    mask={masks.get(page) ?? null}
                    onNeedMask={requestMask}
                  />
                )}
              </div>
            </section>
          )
        })}
      </div>

      <TextDiffPanel page={selected} result={results.get(selected)} />
    </div>
  )
}
