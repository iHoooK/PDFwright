import { IconCheck } from '@renderer/icons'
import s from './page-placeholder.module.css'

interface PageProps {
  number: number
  total: number
  markColor?: string
}

/** Условная страница A4 (612×792 pt) с «текстом» из полос. Исчезнет в фазе 2. */
export function PagePlaceholder({ number, total, markColor }: PageProps): React.JSX.Element {
  const first = number === 1
  return (
    <article className={s.page} aria-label={`Страница ${number}`}>
      {first && <div className={s.h} />}
      <div className={`${s.l ?? ''} ${s.m ?? ''}`} />
      <div className={s.l} />
      <div className={`${s.l ?? ''} ${s.s ?? ''} ${s.gap ?? ''}`} />
      <div className={s.l} />
      <div className={`${s.l ?? ''} ${s.m ?? ''}`} />
      <div className={s.l} />
      <div className={`${s.l ?? ''} ${s.s ?? ''} ${s.gap ?? ''}`} />
      {first ? <div className={s.img} /> : <div className={`${s.l ?? ''} ${s.m ?? ''}`} />}
      <div className={s.l} />
      <div className={`${s.l ?? ''} ${s.m ?? ''}`} />
      <div className={`${s.l ?? ''} ${s.s ?? ''}`} />
      {first && markColor !== undefined && (
        <span className={s.mark} style={{ background: markColor }} />
      )}
      <span className={s.num}>
        {number} / {total}
      </span>
    </article>
  )
}

interface ThumbProps {
  number: number
  current?: boolean
  selected?: boolean
  onClick: () => void
}

/** Миниатюра страницы для боковой панели и режима «Страницы». */
export function PageThumb({ number, current, selected, onClick }: ThumbProps): React.JSX.Element {
  const selectable = selected !== undefined
  return (
    <button
      type="button"
      className={s.thumb}
      onClick={onClick}
      {...(current === undefined ? {} : { 'aria-current': current })}
      {...(selectable ? { 'aria-selected': selected } : {})}
    >
      <span className={s.thumbPage}>
        {selectable && (
          <span className={s.check} aria-hidden="true">
            {selected && <IconCheck />}
          </span>
        )}
      </span>
      <small>{number}</small>
    </button>
  )
}
