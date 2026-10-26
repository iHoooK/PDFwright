/**
 * Язык сообщений общего кода (ошибки движков, сообщения обновлений), которые
 * показываются пользователю. Сообщение пишется на месте сразу на обоих
 * языках: m({ ru: '…', en: '…' }).
 *
 * Язык определяется сам там, где код работает: в окне — по параметру
 * `?lang=` адреса страницы (его задаёт main), в Web Worker — по имени
 * worker'а `…:en`, в main — вызовом setMessageLanguage из настроек. По
 * умолчанию (тесты в Node) — русский.
 */

export type MessageLanguage = 'ru' | 'en'

function detect(): MessageLanguage {
  const scope = globalThis as { location?: { search?: unknown }; name?: unknown }
  const search = scope.location?.search
  if (typeof search === 'string' && search !== '') {
    const lang = new URLSearchParams(search).get('lang')
    if (lang === 'en' || lang === 'ru') return lang
  }
  if (typeof scope.name === 'string' && scope.name.endsWith(':en')) return 'en'
  return 'ru'
}

let current: MessageLanguage = detect()

export function messageLanguage(): MessageLanguage {
  return current
}

export function setMessageLanguage(language: MessageLanguage): void {
  current = language
}

/** Строка на текущем языке сообщений. */
export function m(text: { readonly ru: string; readonly en: string }): string {
  return text[current]
}
