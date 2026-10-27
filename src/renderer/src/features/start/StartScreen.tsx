import { IconClose, IconDocument, IconImage, IconMerge, IconOpen, IconSplit } from '@renderer/icons'
import { locale, t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import { IconButton } from '@renderer/components/controls'
import { useStore } from '@renderer/app/store'
import { MergeDialog } from '@renderer/features/tools/MergeDialog'
import { SplitDialog } from '@renderer/features/tools/SplitDialog'
import { ConvertTiles } from '@renderer/features/convert/ConvertDialogs'
import s from './start.module.css'

function formatOpened(ms: number): string {
  if (ms <= 0) return ''
  const date = new Date(ms)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export function StartScreen(): React.JSX.Element {
  const { state, actions } = useStore()

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
          <button
            type="button"
            className={s.tile}
            onClick={() => {
              actions.openTool('merge')
            }}
          >
            <IconMerge />
            <b>{t.start.merge}</b>
            <small>{t.start.mergeHint}</small>
          </button>
          <button
            type="button"
            className={s.tile}
            onClick={() => {
              actions.openTool('split')
            }}
          >
            <IconSplit />
            <b>{t.start.split}</b>
            <small>{t.start.splitHint}</small>
          </button>
          <button
            type="button"
            className={s.tile}
            onClick={() => {
              actions.openTool('fromImages')
            }}
          >
            <IconImage />
            <b>{t.start.images}</b>
            <small>{t.start.imagesHint}</small>
          </button>
        </div>

        <ConvertTiles />

        <section>
          <h2 className={s.sectionTitle}>{t.start.recent}</h2>
          <div className={s.list}>
            {state.recent.length === 0 ? (
              <p className={s.empty}>{t.start.recentEmpty}</p>
            ) : (
              state.recent.map((file) => (
                <div key={file.path} className={s.item}>
                  <button
                    type="button"
                    className={s.itemMain}
                    title={file.path}
                    onClick={() => {
                      actions.openPath(file.path)
                    }}
                  >
                    <span className={s.thumb} aria-hidden="true">
                      <IconDocument />
                    </span>
                    <span className={s.itemText}>
                      <span className={s.name}>{file.name}</span>
                      <span className={s.meta}>
                        {file.pages === undefined
                          ? file.path
                          : `${t.start.pageCount(file.pages)} · ${file.path}`}
                      </span>
                    </span>
                    <span className={s.meta}>{formatOpened(file.lastOpenedMs)}</span>
                  </button>
                  <IconButton
                    label={`${t.start.removeRecent}: ${file.name}`}
                    small
                    onClick={() => {
                      actions.removeRecent(file.path)
                    }}
                  >
                    <IconClose />
                  </IconButton>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
      <MergeDialog />
      <SplitDialog />
    </div>
  )
}
