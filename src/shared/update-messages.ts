/**
 * Переводит ошибки electron-updater и сети в понятные пользователю фразы.
 * Текст исходной ошибки не показывается целиком: в нём бывают адреса и пути.
 */
/** Код ошибки main: установку обновления запрещают несохранённые документы в каком-то окне. */
export const UPDATE_DIRTY_ERROR = 'PDFWRIGHT_UPDATE_DIRTY'

export function describeUpdateError(raw: unknown): string {
  const message = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw)
  if (message.includes(UPDATE_DIRTY_ERROR)) {
    return 'Сначала сохраните или закройте документы с несохранёнными изменениями во всех окнах.'
  }
  const lower = message.toLowerCase()
  if (
    lower.includes('cancellationerror') ||
    lower.includes('cancelled') ||
    lower.includes('canceled')
  ) {
    return 'Скачивание отменено.'
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
    return 'Не удалось связаться с GitHub. Проверьте интернет и попробуйте снова.'
  }
  if (
    lower.includes('404') ||
    lower.includes('no published versions') ||
    lower.includes('cannot find latest')
  ) {
    return 'Опубликованный релиз не найден. Возможно, первая версия ещё не выпущена.'
  }
  if (lower.includes('403') || lower.includes('429') || lower.includes('rate limit')) {
    return 'GitHub временно ограничил запросы. Попробуйте проверить обновления позже.'
  }
  if (lower.includes('sha512') || lower.includes('checksum') || lower.includes('mismatch')) {
    return 'Проверка контрольной суммы установщика не пройдена. Файл удалён, установка отменена.'
  }
  if (
    lower.includes('not packed') ||
    lower.includes('dev-app-update') ||
    lower.includes('только в собранной')
  ) {
    return 'Проверка обновлений работает только в установленной или portable-версии.'
  }
  const short = raw instanceof Error ? raw.message : String(raw)
  return `Обновление не выполнено: ${short.length > 160 ? `${short.slice(0, 160)}…` : short}`
}

export function formatBytes(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`
  return `${(size / 1024 / 1024).toFixed(1)} МБ`
}
