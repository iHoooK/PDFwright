import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { IpcChannels, type AppInfo, type IpcHandlers } from '@shared/ipc-contract'
import { isAllowedExternalUrl } from '@shared/external-links'
import { isPortableBuild } from '../services/app-paths'
import { toBuffer, writeAtomicBytes } from '../services/fs-utils'
import { printPdfFile } from '../services/print-service'
import type { RecentFilesStore } from '../services/recent-files'
import type { SettingsStore } from '../services/settings-store'
import type { UpdateService } from '../services/update-service'

export interface IpcDependencies {
  settings: SettingsStore
  recent: RecentFilesStore
  /** Файл из аргументов запуска; renderer забирает его один раз. */
  takePendingFile: () => string | null
  /** Renderer сообщает число документов с несохранёнными изменениями. */
  setDirtyCount: (count: number) => void
  updates: UpdateService
}

const PDF_FILTERS: Electron.FileFilter[] = [
  { name: 'Документы PDF', extensions: ['pdf'] },
  { name: 'Все файлы', extensions: ['*'] }
]

/**
 * Регистрирует все обработчики IPC. Каждый обработчик проверяет входные
 * данные сам: renderer — отдельный процесс, и его аргументам нельзя
 * доверять только потому, что типы в preload совпадают.
 */
export function registerIpcHandlers({
  settings,
  recent,
  takePendingFile,
  setDirtyCount,
  updates
}: IpcDependencies): void {
  handle(IpcChannels.appGetInfo, () => getAppInfo())
  handle(IpcChannels.appTakePendingFile, () => takePendingFile())
  handle(IpcChannels.appSetDirty, (count) => {
    setDirtyCount(typeof count === 'number' && count > 0 ? Math.floor(count) : 0)
  })
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

  handle(IpcChannels.shellShowItem, (path) => {
    shell.showItemInFolder(requireAbsolutePath(path))
  })

  handle(IpcChannels.dialogOpenPdf, async () => {
    const result = await showOpen({
      title: 'Открыть PDF',
      properties: ['openFile'],
      filters: PDF_FILTERS
    })
    const path = result.filePaths[0]
    if (result.canceled || path === undefined) return null
    return { path, name: basename(path) }
  })

  handle(IpcChannels.dialogOpenPdfs, async () => {
    const result = await showOpen({
      title: 'Выберите PDF-файлы',
      properties: ['openFile', 'multiSelections'],
      filters: PDF_FILTERS
    })
    return result.canceled ? [] : result.filePaths.map((path) => ({ path, name: basename(path) }))
  })

  handle(IpcChannels.dialogSavePdf, async (options) => {
    const value: unknown = options
    const opts =
      typeof value === 'object' && value !== null
        ? (value as { title?: unknown; defaultPath?: unknown })
        : {}
    const owner = BrowserWindow.getFocusedWindow()
    const dialogOptions: Electron.SaveDialogOptions = {
      title: typeof opts.title === 'string' ? opts.title : 'Сохранить PDF',
      filters: [PDF_FILTERS[0] ?? { name: 'PDF', extensions: ['pdf'] }],
      ...(typeof opts.defaultPath === 'string' ? { defaultPath: opts.defaultPath } : {})
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return null
    return /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`
  })

  handle(IpcChannels.dialogChooseFolder, async (defaultPath) => {
    const result = await showOpen({
      title: 'Папка для сохранения',
      properties: ['openDirectory', 'createDirectory'],
      ...(typeof defaultPath === 'string' && defaultPath.length > 0 ? { defaultPath } : {})
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IpcChannels.fileRead, async (path) => {
    const safePath = requireAbsolutePath(path)
    const [buffer, info] = await Promise.all([readFile(safePath), stat(safePath)])
    await recent.touch(safePath)
    // Отдаём ровно байты файла: Buffer может ссылаться на общий пул большего размера.
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return { bytes, size: info.size, modifiedMs: info.mtimeMs }
  })

  handle(IpcChannels.fileWrite, async (request) => {
    const value: unknown = request
    if (typeof value !== 'object' || value === null)
      throw new TypeError('file:write ожидает объект')
    const { path, bytes, backup } = value as { path?: unknown; bytes?: unknown; backup?: unknown }
    const safePath = requireAbsolutePath(path)
    await writeAtomicBytes(safePath, toBuffer(bytes), backup === true)
    await recent.touch(safePath)
  })

  handle(IpcChannels.fileWriteMany, async (files) => {
    const value: unknown = files
    if (!Array.isArray(value)) throw new TypeError('file:write-many ожидает массив')
    const items = value.map((item: unknown) => {
      const { path, bytes } = (typeof item === 'object' && item !== null ? item : {}) as {
        path?: unknown
        bytes?: unknown
      }
      return { path: requireAbsolutePath(path), data: toBuffer(bytes) }
    })
    for (const item of items) await writeAtomicBytes(item.path, item.data, false)
  })

  handle(IpcChannels.filePrint, (path) => printPdfFile(requireAbsolutePath(path)))
  handle(IpcChannels.recentList, () => recent.list())
  handle(IpcChannels.recentRemove, (path) => recent.remove(requireAbsolutePath(path)))

  handle(IpcChannels.updateCheck, () => updates.check())
  handle(IpcChannels.updateDownload, () => updates.download())
  handle(IpcChannels.updateCancel, () => {
    updates.cancel()
  })
  handle(IpcChannels.updateInstall, () => {
    updates.install()
  })
}

async function showOpen(
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const owner = BrowserWindow.getFocusedWindow()
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
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
