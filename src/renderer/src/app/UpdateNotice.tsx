import { Button } from '@renderer/components/controls'
import { t } from '@renderer/i18n'
import { IconUpdate } from '@renderer/icons'
import { formatBytes } from '@shared/update-messages'
import s from './app.module.css'
import { useStore } from './store'

/**
 * Предупреждение о новой версии, найденной автоматической проверкой.
 * «Обновить» открывает раздел «Обновления» и начинает скачивание (portable —
 * страницу релиза), «Позже» прячет предупреждение до следующего запуска.
 */
export function UpdateNotice(): React.JSX.Element | null {
  const { state, actions } = useStore()
  const { update } = state
  if (!update.notice || !update.info) return null
  const info = update.info
  return (
    <section className={s.updateNotice} role="alertdialog" aria-label={t.settings.noticeTitle}>
      <div className={s.updateIcon}>
        <IconUpdate />
      </div>
      <div className={s.updateBody}>
        <b>{t.settings.noticeTitle}</b>
        <p>
          {update.canInstall
            ? t.settings.noticeText(info.version, formatBytes(info.size ?? 0))
            : t.settings.noticeTextPortable(info.version)}
        </p>
        <div className={s.updateActions}>
          <Button
            variant="primary"
            onClick={() => {
              actions.dismissUpdateNotice()
              if (update.canInstall) {
                actions.openSettings('updates')
                actions.downloadUpdate()
              } else {
                actions.openExternal(info.page)
              }
            }}
          >
            {update.canInstall ? t.settings.noticeUpdate : t.settings.noticeDownload}
          </Button>
          <Button onClick={actions.dismissUpdateNotice}>{t.settings.noticeLater}</Button>
        </div>
      </div>
    </section>
  )
}
