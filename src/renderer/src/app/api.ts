import type {
  AppInfo,
  FileReadResult,
  OpenedPdfFile,
  PdfwrightApi,
  RecentFile
} from '@shared/ipc-contract'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings,
  type AppSettings
} from '@shared/settings-schema'

/**
 * Доступ к API preload. В обычном браузере (dev-сервер Vite без Electron)
 * в режиме разработки подставляется заглушка: настройки в localStorage,
 * выбор файла через <input type="file">, чтение через File.arrayBuffer().
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
  const files = new Map<string, File>()
  let recent: RecentFile[] = []
  const pathFor = (file: File): string => `C:\\Браузер\\${file.name}`

  const pickFile = (): Promise<OpenedPdfFile | null> =>
    new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/pdf,.pdf'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const path = pathFor(file)
        files.set(path, file)
        resolve({ path, name: file.name })
      }
      input.oncancel = () => {
        resolve(null)
      }
      input.click()
    })

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
    openPdfDialog: pickFile,
    readFile: async (path): Promise<FileReadResult> => {
      let file = files.get(path)
      if (!file) {
        // В браузере путь из «недавних» нельзя прочитать заново — просим выбрать файл.
        const picked = await pickFile()
        file = picked ? files.get(picked.path) : undefined
        if (!file) throw new Error('Файл не выбран')
      }
      recent = [
        { path, name: file.name, lastOpenedMs: Date.now() },
        ...recent.filter((r) => r.path !== path)
      ]
      return { bytes: await file.arrayBuffer(), size: file.size, modifiedMs: file.lastModified }
    },
    printFile: () => {
      window.print()
      return Promise.resolve()
    },
    getRecentFiles: () => Promise.resolve(recent),
    removeRecentFile: (path) => {
      recent = recent.filter((r) => r.path !== path)
      return Promise.resolve(recent)
    },
    takePendingOpenFile: () => Promise.resolve(null),
    getPathForFile: (file) => {
      const path = pathFor(file)
      files.set(path, file)
      return path
    },
    onCommand: () => () => undefined,
    onOpenFile: () => () => undefined
  }
}
