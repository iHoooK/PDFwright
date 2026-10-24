import type { Theme } from '@shared/settings-schema'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let current: Theme = 'system'

function resolve(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
}

function render(): void {
  document.documentElement.dataset.theme = resolve(current)
}

media.addEventListener('change', () => {
  if (current === 'system') render()
})

/** Применяет тему к документу; `system` следит за системной настройкой. */
export function applyTheme(theme: Theme): void {
  current = theme
  render()
}

export function resolvedTheme(): 'light' | 'dark' {
  return resolve(current)
}
