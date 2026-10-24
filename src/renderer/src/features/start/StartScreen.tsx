import { IconChevronRight, IconImage, IconMerge, IconOpen, IconSplit } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import { useStore } from '@renderer/app/store'
import s from './start.module.css'

export function StartScreen(): React.JSX.Element {
  const { state, actions } = useStore()
  const soon = (): void => {
    actions.toast(t.start.soon)
  }

  return (
    <div className={s.wrap}>
      <div className={s.start}>
        <div>
          <h1 className={s.title}>{t.start.title}</h1>
          <p className={s.lead}>{t.start.lead}</p>
        </div>

        <div className={s.hero}>
          <button
            type="button"
            className={cx(s.tile, s.primary)}
            onClick={() => {
              void actions.openDialog()
            }}
          >
            <IconOpen />
            <b>{t.start.open}</b>
            <small>{t.start.openHint}</small>
          </button>
          <button type="button" className={s.tile} onClick={soon}>
            <IconMerge />
            <b>{t.start.merge}</b>
            <small>{t.start.mergeHint}</small>
          </button>
          <button type="button" className={s.tile} onClick={soon}>
            <IconSplit />
            <b>{t.start.split}</b>
            <small>{t.start.splitHint}</small>
          </button>
          <button type="button" className={s.tile} onClick={soon}>
            <IconImage />
            <b>{t.start.images}</b>
            <small>{t.start.imagesHint}</small>
          </button>
        </div>

        <section>
          <h2 className={s.sectionTitle}>{t.start.recent}</h2>
          <div className={s.list}>
            {state.recent.length === 0 ? (
              <p className={s.empty}>{t.start.recentEmpty}</p>
            ) : (
              state.recent.map((d) => (
                <button
                  key={d.path}
                  type="button"
                  className={s.item}
                  onClick={() => {
                    actions.openDoc(d)
                  }}
                >
                  <span className={s.thumb} aria-hidden="true" />
                  <span>
                    <span className={s.name}>{d.name}</span>
                    <span className={s.meta}>{d.path}</span>
                  </span>
                  <span className={s.meta}>
                    {d.pages} {t.start.pages}
                  </span>
                  <IconChevronRight />
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
