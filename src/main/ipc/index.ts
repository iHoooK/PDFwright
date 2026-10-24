import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { IpcChannels, type AppInfo, type IpcHandlers } from '@shared/ipc-contract'
import { isAllowedExternalUrl } from '@shared/external-links'
import { isPortableBuild } from '../services/app-paths'
import { printPdfFile } from '../services/print-service'
import type { RecentFilesStore } from '../services/recent-files'
import type { SettingsStore } from '../services/settings-store'

export interface IpcDependencies {
  settings: SettingsStore
  recent: RecentFilesStore
  /** Файл из аргументов запуска; renderer забирает его один раз. */
  takePendingFile: () => string | null
}

/**
 * Регистрирует все обработчики IPC. Каждый обработчик проверяет входные
 * данные сам: renderer — отдельный процесс, и его аргументам нельзя
 * доверять только потому, что типы в preload совпадают.
 */
export function registerIpcHandlers({ settings, recent, takePendingFile }: IpcDependencies): void {
  handle(IpcChannels.appGetInfo, () => getAppInfo())
  handle(IpcChannels.appTakePendingFile, () => takePendingFile())
  handle(IpcChannels.settingsGet, () => settings.get())

  handle(IpcChannels.settingsUpdate, (patch) => {
    // Типы preload не защищают от подделанного вызова: проверяем форму вручную.
    const value: unknown = patch
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('settings:update ожидает объект patch')
    }
    return settings.update(patch)
  })

  handle(IpcChannels.shellOpenExternal, async (url) => {
    const value: unknown = url
    if (typeof value !== 'string' || !isAllowedExternalUrl(value)) {
      throw new Error('Открытие этого адреса не разрешено')
    }
    await shell.openExternal(value)
  })

  handle(IpcChannels.dialogOpenPdf, async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Открыть PDF',
      properties: ['openFile'],
      filters: [
        { name: 'Документы PDF', extensions: ['pdf'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    }
    const owner = BrowserWindow.getFocusedWindow()
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || path === undefined) return null
    return { path, name: basename(path) }
  })

  handle(IpcChannels.fileRead, async (path) => {
    const safePath = requireAbsolutePath(path)
    const [buffer, info] = await Promise.all([readFile(safePath), stat(safePath)])
    await recent.touch(safePath)
    // Отдаём ровно байты файла: Buffer может ссылаться на общий пул большего размера.
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return { bytes, size: info.size, modifiedMs: info.mtimeMs }
  })

  handle(IpcChannels.filePrint, (path) => printPdfFile(requireAbsolutePath(path)))
  handle(IpcChannels.recentList, () => recent.list())
  handle(IpcChannels.recentRemove, (path) => recent.remove(requireAbsolutePath(path)))
}

function requireAbsolutePath(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
    throw new TypeError('Ожидается абсолютный путь к файлу')
  }
  return path
}

function handle<C extends keyof IpcHandlers>(channel: C, handler: IpcHandlers[C]): void {
  ipcMain.handle(channel, (_event, ...args: unknown[]) =>
    (handler as (...a: unknown[]) => unknown)(...args)
  )
}

export function getAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    portable: isPortableBuild(),
    userDataPath: app.getPath('userData'),
    packaged: app.isPackaged
  }
}
