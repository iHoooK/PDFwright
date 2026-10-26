import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import {
  IpcChannels,
  type LanguageApplyResult,
  type AppInfo,
  type IpcHandlers,
  type StartupFiles,
  type WindowTabs
} from '@shared/ipc-contract'
import { isAllowedExternalUrl } from '@shared/external-links'
import { isPortableBuild } from '../services/app-paths'
import { toBuffer, writeAtomicBytes } from '../services/fs-utils'
import { printPdfFile } from '../services/print-service'
import { mainStrings, type MainStrings } from '../strings'
import { interfaceLanguage } from '../language'
import type { RecentFilesStore } from '../services/recent-files'
import type { SettingsStore } from '../services/settings-store'
import type { UpdateService } from '../services/update-service'

/** Окна программы глазами IPC: каждый вызов относится к окну отправителя. */
export interface WindowsBridge {
  /** Файлы, с которыми открыто окно; renderer забирает их один раз. */
  takeStartup: (sender: WebContents) => StartupFiles
  /** Renderer сообщает число документов с несохранёнными изменениями. */
  setDirty: (sender: WebContents, count: number) => void
  setTabs: (sender: WebContents, tabs: WindowTabs) => void
  openInNewWindow: (sender: WebContents, path: string) => void
  setUpdateOwner: (sender: WebContents) => void
  runUpdateInstall: (install: () => void) => void
  applyLanguage: () => LanguageApplyResult
}

export interface IpcDependencies {
  settings: SettingsStore
  recent: RecentFilesStore
  windows: WindowsBridge
  updates: UpdateService
  /** Язык в настройках изменился: main ставит меню и язык сообщений заново. */
  onLanguageChange: () => void
}

function pdfFilters(text: MainStrings): Electron.FileFilter[] {
  return [
    { name: text.dialogs.pdfFiles, extensions: ['pdf'] },
    { name: text.dialogs.allFiles, extensions: ['*'] }
  ]
}

function imageFilters(text: MainStrings): Electron.FileFilter[] {
  return [
    { name: text.dialogs.images, extensions: ['png', 'jpg', 'jpeg', 'webp'] },
    { name: text.dialogs.allFiles, extensions: ['*'] }
  ]
}

/** Предел размера одной картинки для «Изображения в PDF». */
const IMAGE_MAX_BYTES = 200 * 1024 * 1024

/**
 * Регистрирует все обработчики IPC. Каждый обработчик проверяет входные
 * данные сам: renderer — отдельный процесс, и его аргументам нельзя
 * доверять только потому, что типы в preload совпадают.
 */
export function registerIpcHandlers({
  settings,
  recent,
  windows,
  updates,
  onLanguageChange
}: IpcDependencies): void {
  const text = (): MainStrings => mainStrings(interfaceLanguage(settings))
  handle(IpcChannels.appGetInfo, () => getAppInfo())
  handleFrom(IpcChannels.appTakeStartup, (sender) => windows.takeStartup(sender))
  handleFrom(IpcChannels.appSetDirty, (sender, count) => {
    windows.setDirty(sender, typeof count === 'number' && count > 0 ? Math.floor(count) : 0)
  })
  handleFrom(IpcChannels.windowSetTabs, (sender, tabs) => {
    windows.setTabs(sender, requireWindowTabs(tabs))
  })
  handleFrom(IpcChannels.windowOpenFile, (sender, path) => {
    windows.openInNewWindow(sender, requireAbsolutePath(path))
  })
  handle(IpcChannels.settingsGet, () => settings.get())

  handle(IpcChannels.settingsUpdate, async (patch) => {
    // Типы preload не защищают от подделанного вызова: проверяем форму вручную.
    const value: unknown = patch
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('settings:update ожидает объект patch')
    }
    const before = settings.get().general.language
    const next = await settings.update(patch)
    if (next.general.language !== before) onLanguageChange()
    return next
  })
  handle(IpcChannels.appApplyLanguage, () => windows.applyLanguage())

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
      title: text().dialogs.openPdf,
      properties: ['openFile'],
      filters: pdfFilters(text())
    })
    const path = result.filePaths[0]
    if (result.canceled || path === undefined) return null
    return { path, name: basename(path) }
  })

  handle(IpcChannels.dialogOpenPdfs, async () => {
    const result = await showOpen({
      title: text().dialogs.openPdfs,
      properties: ['openFile', 'multiSelections'],
      filters: pdfFilters(text())
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
      title: typeof opts.title === 'string' ? opts.title : text().dialogs.savePdf,
      filters: [{ name: text().dialogs.pdfFiles, extensions: ['pdf'] }],
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
      title: text().dialogs.chooseFolder,
      properties: ['openDirectory', 'createDirectory'],
      ...(typeof defaultPath === 'string' && defaultPath.length > 0 ? { defaultPath } : {})
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IpcChannels.dialogOpenImages, async () => {
    const result = await showOpen({
      title: text().dialogs.chooseImages,
      properties: ['openFile', 'multiSelections'],
      filters: imageFilters(text())
    })
    if (result.canceled) return []
    const picked = []
    for (const path of result.filePaths) {
      const info = await stat(path)
      if (info.size > IMAGE_MAX_BYTES) {
        throw new Error(`Файл «${basename(path)}» больше 200 МБ`)
      }
      const buffer = await readFile(path)
      const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      picked.push({ path, name: basename(path), bytes })
    }
    return picked
  })

  handle(IpcChannels.dialogSaveText, async (options) => {
    const value: unknown = options
    const opts =
      typeof value === 'object' && value !== null
        ? (value as { title?: unknown; defaultPath?: unknown })
        : {}
    const owner = BrowserWindow.getFocusedWindow()
    const dialogOptions: Electron.SaveDialogOptions = {
      title: typeof opts.title === 'string' ? opts.title : text().dialogs.saveText,
      filters: [{ name: text().dialogs.text, extensions: ['txt'] }],
      ...(typeof opts.defaultPath === 'string' ? { defaultPath: opts.defaultPath } : {})
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return null
    return /\.txt$/i.test(result.filePath) ? result.filePath : `${result.filePath}.txt`
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

  handle(IpcChannels.filePrint, (path) =>
    printPdfFile(requireAbsolutePath(path), text().printFailed)
  )
  handle(IpcChannels.recentList, () => recent.list())
  handle(IpcChannels.recentRemove, (path) => recent.remove(requireAbsolutePath(path)))

  handle(IpcChannels.updateCheck, () => updates.check())
  handleFrom(IpcChannels.updateDownload, (sender) => {
    windows.setUpdateOwner(sender)
    return updates.download()
  })
  handle(IpcChannels.updateCancel, () => {
    updates.cancel()
  })
  handle(IpcChannels.updateInstall, () => {
    windows.runUpdateInstall(() => {
      updates.install()
    })
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

/** Вкладки окна от renderer: только абсолютные пути, не больше разумного числа. */
function requireWindowTabs(tabs: unknown): WindowTabs {
  if (typeof tabs !== 'object' || tabs === null) throw new TypeError('Ожидаются вкладки окна')
  const { paths, active } = tabs as { paths?: unknown; active?: unknown }
  if (!Array.isArray(paths) || paths.length > 500) throw new TypeError('Ожидаются вкладки окна')
  const safe = paths.map(requireAbsolutePath)
  return {
    paths: safe,
    active: typeof active === 'string' && safe.includes(active) ? active : null
  }
}

function handle<C extends keyof IpcHandlers>(channel: C, handler: IpcHandlers[C]): void {
  ipcMain.handle(channel, (_event, ...args: unknown[]) =>
    (handler as (...a: unknown[]) => unknown)(...args)
  )
}

/** Обработчик, которому нужно окно отправителя. */
function handleFrom<C extends keyof IpcHandlers>(
  channel: C,
  handler: (sender: WebContents, ...args: Parameters<IpcHandlers[C]>) => ReturnType<IpcHandlers[C]>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) =>
    (handler as (sender: WebContents, ...a: unknown[]) => unknown)(event.sender, ...args)
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
