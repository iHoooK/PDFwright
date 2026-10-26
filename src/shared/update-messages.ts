import { m } from './messages'
/**
 * Переводит ошибки electron-updater и сети в понятные пользователю фразы.
 * Текст исходной ошибки не показывается целиком: в нём бывают адреса и пути.
 */
/** Код ошибки main: установку обновления запрещают несохранённые документы в каком-то окне. */
export const UPDATE_DIRTY_ERROR = 'PDFWRIGHT_UPDATE_DIRTY'

export function describeUpdateError(raw: unknown): string {
  const message = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw)
  if (message.includes(UPDATE_DIRTY_ERROR)) {
    return m({
      ru: 'Сначала сохраните или закройте документы с несохранёнными изменениями во всех окнах.',
      en: 'First save or close documents with unsaved changes in all windows.'
    })
  }
  const lower = message.toLowerCase()
  if (
    lower.includes('cancellationerror') ||
    lower.includes('cancelled') ||
    lower.includes('canceled')
  ) {
    return m({ ru: 'Скачивание отменено.', en: 'Download canceled.' })
  }
  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('net::err') ||
    lower.includes('getaddrinfo') ||
    lower.includes('network')
  ) {
    return m({
      ru: 'Не удалось связаться с GitHub. Проверьте интернет и попробуйте снова.',
      en: 'Could not reach GitHub. Check your internet connection and try again.'
    })
  }
  if (
    lower.includes('404') ||
    lower.includes('no published versions') ||
    lower.includes('cannot find latest')
  ) {
    return m({
      ru: 'Опубликованный релиз не найден. Возможно, первая версия ещё не выпущена.',
      en: 'No published release was found. The first version may not be released yet.'
    })
  }
  if (lower.includes('403') || lower.includes('429') || lower.includes('rate limit')) {
    return m({
      ru: 'GitHub временно ограничил запросы. Попробуйте проверить обновления позже.',
      en: 'GitHub is temporarily limiting requests. Try checking for updates later.'
    })
  }
  if (lower.includes('sha512') || lower.includes('checksum') || lower.includes('mismatch')) {
    return m({
      ru: 'Проверка контрольной суммы установщика не пройдена. Файл удалён, установка отменена.',
      en: 'The installer checksum did not match. The file was deleted and the installation was canceled.'
    })
  }
  if (
    lower.includes('not packed') ||
    lower.includes('dev-app-update') ||
    lower.includes('только в собранной')
  ) {
    return m({
      ru: 'Проверка обновлений работает только в установленной или portable-версии.',
      en: 'Update checks only work in the installed or portable version.'
    })
  }
  const short = raw instanceof Error ? raw.message : String(raw)
  return m({
    ru: `Обновление не выполнено: ${short.length > 160 ? `${short.slice(0, 160)}…` : short}`,
    en: `Update failed: ${short.length > 160 ? `${short.slice(0, 160)}…` : short}`
  })
}

export function formatBytes(size: number): string {
  if (size < 1024 * 1024)
    return m({
      ru: `${Math.max(1, Math.round(size / 1024))} КБ`,
      en: `${Math.max(1, Math.round(size / 1024))} KB`
    })
  return m({
    ru: `${(size / 1024 / 1024).toFixed(1)} МБ`,
    en: `${(size / 1024 / 1024).toFixed(1)} MB`
  })
}
