import type { AppInfo, OpenedPdfFile, PdfwrightApi } from '@shared/ipc-contract'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings,
  type AppSettings
} from '@shared/settings-schema'

/**
 * Доступ к API preload. В обычном браузере (dev-сервер Vite без Electron)
 * в режиме разработки подставляется заглушка на localStorage, чтобы интерфейс
 * можно было смотреть и проверять без запуска Electron.
 */
export function getApi(): PdfwrightApi {
  const exposed = (window as { pdfwright?: PdfwrightApi }).pdfwright
  if (exposed) return exposed
  if (import.meta.env.DEV) return createBrowserMock()
  throw new Error('API preload недоступен: страница открыта вне Electron')
}

const MOCK_KEY = 'pdfwright.mock.settings'

function createBrowserMock(): PdfwrightApi {
  let settings: AppSettings = createDefaultSettings()
  try {
    const raw = localStorage.getItem(MOCK_KEY)
    if (raw !== null) settings = normalizeSettings(JSON.parse(raw))
  } catch {
    settings = createDefaultSettings()
  }
  const persist = (): void => {
    try {
      localStorage.setItem(MOCK_KEY, JSON.stringify(settings))
    } catch {
      // localStorage может быть недоступен — заглушке это не мешает
    }
  }
  const info: AppInfo = {
    name: 'PDFwright',
    version: '0.1.0-browser',
    electron: '—',
    chrome: navigator.userAgent,
    node: '—',
    platform: 'browser',
    arch: '—',
    portable: false,
    userDataPath: '(браузер)',
    packaged: false
  }
  let counter = 0
  return {
    getAppInfo: () => Promise.resolve(info),
    getSettings: () => Promise.resolve(settings),
    updateSettings: (patch) => {
      settings = applySettingsPatch(settings, patch)
      persist()
      return Promise.resolve(settings)
    },
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener')
      return Promise.resolve()
    },
    openPdfDialog: () => {
      counter += 1
      const file: OpenedPdfFile = {
        name: `Документ_${counter}.pdf`,
        path: `C:\\Документы\\Документ_${counter}.pdf`
      }
      return Promise.resolve(file)
    },
    onCommand: () => () => undefined
  }
}
