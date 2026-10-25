import type {
  AppInfo,
  FileReadResult,
  OpenedPdfFile,
  PdfwrightApi,
  RecentFile,
  UpdateProgress
} from '@shared/ipc-contract'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings,
  type AppSettings
} from '@shared/settings-schema'
import { basenameOf } from '@shared/paths'

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
  const progressListeners = new Set<(p: UpdateProgress) => void>()
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
    openPdfsDialog: () =>
      new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/pdf,.pdf'
        input.multiple = true
        input.onchange = () => {
          const list = Array.from(input.files ?? []).map((file) => {
            const path = pathFor(file)
            files.set(path, file)
            return { path, name: file.name }
          })
          resolve(list)
        }
        input.oncancel = () => {
          resolve([])
        }
        input.click()
      }),
    savePdfDialog: (options) => {
      const name = options.defaultPath ? basenameOf(options.defaultPath) : 'document.pdf'
      return Promise.resolve(`C:\\Браузер\\${name}`)
    },
    chooseFolderDialog: () => Promise.resolve('C:\\Браузер'),
    writeFile: (request) => {
      // В браузере «сохранение» — скачивание файла.
      const blob = new Blob([request.bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = basenameOf(request.path)
      a.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 1000)
      files.set(request.path, new File([blob], a.download, { type: 'application/pdf' }))
      return Promise.resolve()
    },
    writeFiles: (items) => {
      for (const item of items) {
        const blob = new Blob([item.bytes], { type: 'application/pdf' })
        files.set(item.path, new File([blob], basenameOf(item.path), { type: 'application/pdf' }))
      }
      return Promise.resolve()
    },
    showItemInFolder: () => Promise.resolve(),
    setDirtyCount: () => Promise.resolve(),
    takePendingOpenFile: () => Promise.resolve(null),
    // Заглушка обновлений: имитирует найденную версию и скачивание с прогрессом.
    checkForUpdates: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            status: 'available',
            canInstall: true,
            info: {
              version: '0.1.1',
              releaseDate: new Date().toISOString(),
              releaseNotes: null,
              size: 123_236_147,
              page: 'https://github.com/iHoooK/PDFwright/releases/tag/v0.1.1'
            }
          })
        }, 600)
      }),
    downloadUpdate: () =>
      new Promise((resolve) => {
        let percent = 0
        const timer = setInterval(() => {
          percent += 20
          for (const listener of progressListeners) {
            listener({ percent, transferred: percent, total: 100, bytesPerSecond: 1 })
          }
          if (percent >= 100) {
            clearInterval(timer)
            resolve()
          }
        }, 300)
      }),
    cancelUpdateDownload: () => Promise.resolve(),
    installUpdate: () => Promise.resolve(),
    onUpdateProgress: (listener) => {
      progressListeners.add(listener)
      return () => {
        progressListeners.delete(listener)
      }
    },
    getPathForFile: (file) => {
      const path = pathFor(file)
      files.set(path, file)
      return path
    },
    onCommand: () => () => undefined,
    onOpenFile: () => () => undefined
  }
}
