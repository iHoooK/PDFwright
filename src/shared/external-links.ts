/**
 * Внешние ссылки, которые приложение разрешает открывать в системном браузере.
 * Любой другой адрес из renderer отклоняется в main — это защита от открытия
 * произвольных URL, если в интерфейс когда-нибудь попадёт недоверенный контент
 * (например, ссылка из PDF-документа).
 */

export const PROJECT_REPOSITORY = 'iHoooK/PDFwright'
export const RELEASES_PAGE = `https://github.com/${PROJECT_REPOSITORY}/releases`

export const DEVELOPER_LINKS = [
  { id: 'site', label: 'Сайт Promptix', url: 'https://promptix.ru/' },
  { id: 'youtube', label: 'YouTube · Promptix', url: 'https://www.youtube.com/@promptix' },
  { id: 'telegram', label: 'Telegram · Promptix', url: 'https://t.me/promptix_ru' },
  { id: 'telegram-artel', label: 'Telegram · Кодовая Артель', url: 'https://t.me/codeartel' },
  {
    id: 'donationalerts',
    label: 'DonationAlerts',
    url: 'https://www.donationalerts.com/r/promptix'
  },
  { id: 'boosty', label: 'Boosty', url: 'https://boosty.to/promptix' }
] as const

const ALLOWED_HOSTS = new Set([
  'promptix.ru',
  'www.promptix.ru',
  'www.youtube.com',
  'youtube.com',
  't.me',
  'www.donationalerts.com',
  'donationalerts.com',
  'boosty.to',
  'github.com',
  'www.github.com'
])

/** true только для https-адресов на известных хостах без логина и нестандартного порта. */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    ALLOWED_HOSTS.has(url.hostname)
  )
}
