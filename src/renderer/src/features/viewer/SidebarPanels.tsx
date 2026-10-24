import { useEffect, useState } from 'react'
import { IconChevronDown, IconChevronRight, IconSearch } from '@renderer/icons'
import { IconButton } from '@renderer/components/controls'
import { cx } from '@renderer/components/cx'
import { useStore, type DocTab } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { createCancelToken, type OutlineEntry, type PdfDocument } from '@renderer/pdf-engine/engine'
import { PageThumbnail } from './PageThumbnail'
import s from './viewer.module.css'

export function ThumbsPanel({ tab, doc }: { tab: DocTab; doc: PdfDocument }): React.JSX.Element {
  const { state, actions } = useStore()
  return (
    <div className={cx(s.sidebarBody, s.thumbs)}>
      {Array.from({ length: tab.pages }, (_, i) => (
        <PageThumbnail
          key={i}
          doc={doc}
          pageNumber={i + 1}
          rotation={state.rotation}
          current={state.page === i + 1}
          onClick={() => {
            actions.setPage(i + 1)
          }}
        />
      ))}
    </div>
  )
}

export function OutlinePanel({ doc }: { doc: PdfDocument }): React.JSX.Element {
  const { actions } = useStore()
  const [loaded, setLoaded] = useState<{ doc: PdfDocument; entries: OutlineEntry[] } | null>(null)
  const entries = loaded?.doc === doc ? loaded.entries : null

  useEffect(() => {
    const run = createCancelToken()
    void doc.getOutline().then((list) => {
      if (!run.isCancelled()) setLoaded({ doc, entries: list })
    })
    return () => {
      run.cancel()
    }
  }, [doc])

  if (entries === null) return <p className={s.sideEmpty}>…</p>
  if (entries.length === 0) return <p className={s.sideEmpty}>{t.sidebar.outlineEmpty}</p>
  return (
    <div className={s.sidebarBody}>
      {entries.map((entry, index) => (
        <button
          key={`${index}-${entry.title}`}
          type="button"
          className={s.outlineItem}
          style={{ paddingLeft: 10 + entry.depth * 16 }}
          title={entry.title}
          onClick={() => {
            void doc.resolveDestination(entry.dest).then((page) => {
              if (page !== null) actions.setPage(page)
              else actions.toast(t.sidebar.outlineBroken)
            })
          }}
        >
          {entry.title}
        </button>
      ))}
    </div>
  )
}

export function SearchPanel(): React.JSX.Element {
  const { state, actions, searchRef } = useStore()
  const { search } = state
  const [draft, setDraft] = useState(search.query)

  const submit = (): void => {
    actions.search(draft)
  }
  const count = search.matches.length
  const status = search.running
    ? t.search.running
    : search.query.length === 0
      ? ''
      : count === 0
        ? t.search.none(search.query)
        : t.search.found(count, search.active + 1)

  return (
    <div className={s.sidebarBody}>
      <label className={s.searchField}>
        <IconSearch />
        <input
          ref={searchRef}
          type="search"
          value={draft}
          placeholder={t.cmd.search}
          aria-label={t.cmd.search}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (draft === search.query && count > 0) {
                if (event.shiftKey) actions.searchStep(-1)
                else actions.searchStep(1)
              } else submit()
            }
          }}
        />
      </label>
      <div className={s.searchBar}>
        <span className={s.searchStatus} aria-live="polite">
          {status}
        </span>
        <IconButton
          label={t.search.prev}
          small
          disabled={count === 0}
          onClick={() => {
            actions.searchStep(-1)
          }}
        >
          <IconChevronDown style={{ transform: 'rotate(180deg)' }} />
        </IconButton>
        <IconButton
          label={t.search.next}
          small
          disabled={count === 0}
          onClick={() => {
            actions.searchStep(1)
          }}
        >
          <IconChevronDown />
        </IconButton>
      </div>
      {search.query.length === 0 && <p className={s.sideEmpty}>{t.sidebar.searchEmpty}</p>}
      {search.matches.map((m, index) => (
        <button
          key={`${m.page}-${index}`}
          type="button"
          className={cx(s.result, index === search.active && s.resultActive)}
          onClick={() => {
            actions.searchGo(index)
          }}
        >
          <span className={s.resultPage}>
            <IconChevronRight />
            {t.search.page(m.page)}
          </span>
          <span className={s.resultText}>{m.match.snippet}</span>
        </button>
      ))}
    </div>
  )
}
