import { useEffect, useRef, type ReactNode } from 'react'
import { IconClose } from '@renderer/icons'
import { IconButton } from './controls'
import s from './dialog.module.css'
import { t } from '@renderer/i18n'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

/** Модальное окно на нативном <dialog>: фокус и Esc обрабатывает браузер. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = 440
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      style={{ width }}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      aria-label={title}
    >
      <div className={s.head}>
        <h2 className={s.title}>{title}</h2>
        <IconButton label={t.a11y.close} small onClick={onClose}>
          <IconClose />
        </IconButton>
      </div>
      <div className={s.body}>{children}</div>
      {footer !== undefined && <div className={s.footer}>{footer}</div>}
    </dialog>
  )
}
