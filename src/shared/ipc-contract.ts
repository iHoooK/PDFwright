import type { AppSettings, SettingsPatch } from './settings-schema'

/**
 * Единственный источник правды о каналах IPC между main и renderer.
 * Renderer видит только типизированный API `window.pdfwright`, который
 * preload строит из этих каналов; прямого доступа к ipcRenderer у него нет.
 */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appTakePendingFile: 'app:take-pending-file',
  appSetDirty: 'app:set-dirty',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  shellOpenExternal: 'shell:open-external',
  shellShowItem: 'shell:show-item',
  dialogOpenPdf: 'dialog:open-pdf',
  dialogOpenPdfs: 'dialog:open-pdfs',
  dialogSavePdf: 'dialog:save-pdf',
  dialogChooseFolder: 'dialog:choose-folder',
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileWriteMany: 'file:write-many',
  filePrint: 'file:print',
  recentList: 'recent:list',
  recentRemove: 'recent:remove'
} as const

/** Канал main → renderer: команды меню приложения и системных ускорителей. */
export const APP_COMMAND_CHANNEL = 'app:command'
/** Канал main → renderer: открыть файл (второй экземпляр, ассоциация .pdf). */
export const APP_OPEN_FILE_CHANNEL = 'app:open-file'

export const APP_COMMANDS = [
  'file.open',
  'file.save',
  'file.saveAs',
  'file.print',
  'file.close',
  'file.properties',
  'edit.undo',
  'edit.redo',
  'edit.find',
  'tools.merge',
  'tools.split',
  'app.settings',
  'app.start',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoomReset',
  'view.fitWidth',
  'view.fitPage',
  'view.rotate',
  'view.pages',
  'view.sidebar',
  'view.props',
  'view.theme',
  'help.releases',
  'help.about'
] as const

export type AppCommand = (typeof APP_COMMANDS)[number]

export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === 'string' && (APP_COMMANDS as readonly string[]).includes(value)
}

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  /** true для portable-сборки: обновления предлагаются только ссылкой. */
  portable: boolean
  userDataPath: string
  packaged: boolean
}

export interface OpenedPdfFile {
  path: string
  name: string
}

export interface FileReadResult {
  /** Содержимое файла; передаётся в renderer без копирования через structured clone. */
  bytes: ArrayBuffer
  size: number
  modifiedMs: number
}

export interface WriteFileRequest {
  path: string
  bytes: ArrayBuffer
  /** Сделать копию `*.bak` перед перезаписью существующего файла. */
  backup: boolean
}

export interface WriteManyItem {
  path: string
  bytes: ArrayBuffer
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
}

export interface RecentFile {
  path: string
  name: string
  lastOpenedMs: number
}

/** Контракт, который preload публикует в renderer как `window.pdfwright`. */
export interface PdfwrightApi {
  getAppInfo: () => Promise<AppInfo>
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
  openExternal: (url: string) => Promise<void>
  showItemInFolder: (path: string) => Promise<void>
  openPdfDialog: () => Promise<OpenedPdfFile | null>
  openPdfsDialog: () => Promise<OpenedPdfFile[]>
  savePdfDialog: (options: SaveDialogOptions) => Promise<string | null>
  chooseFolderDialog: (defaultPath?: string) => Promise<string | null>
  readFile: (path: string) => Promise<FileReadResult>
  writeFile: (request: WriteFileRequest) => Promise<void>
  writeFiles: (files: WriteManyItem[]) => Promise<void>
  printFile: (path: string) => Promise<void>
  getRecentFiles: () => Promise<RecentFile[]>
  removeRecentFile: (path: string) => Promise<RecentFile[]>
  /** Сколько документов с несохранёнными изменениями: main спрашивает подтверждение при закрытии окна. */
  setDirtyCount: (count: number) => Promise<void>
  /** Файл из аргументов запуска, если был; отдаётся один раз. */
  takePendingOpenFile: () => Promise<string | null>
  /** Путь к файлу, брошенному в окно (sandbox не даёт File.path). */
  getPathForFile: (file: File) => string
  /** Подписка на команды меню; возвращает функцию отписки. */
  onCommand: (listener: (command: AppCommand) => void) => () => void
  /** Подписка на запросы открыть файл; возвращает функцию отписки. */
  onOpenFile: (listener: (path: string) => void) => () => void
}

/** Сигнатуры обработчиков в main: ключ — канал, значение — (args) => result. */
export interface IpcHandlers {
  [IpcChannels.appGetInfo]: () => AppInfo | Promise<AppInfo>
  [IpcChannels.appTakePendingFile]: () => string | null
  [IpcChannels.appSetDirty]: (count: number) => void
  [IpcChannels.settingsGet]: () => AppSettings | Promise<AppSettings>
  [IpcChannels.settingsUpdate]: (patch: SettingsPatch) => AppSettings | Promise<AppSettings>
  [IpcChannels.shellOpenExternal]: (url: string) => void | Promise<void>
  [IpcChannels.shellShowItem]: (path: string) => void
  [IpcChannels.dialogOpenPdf]: () => OpenedPdfFile | null | Promise<OpenedPdfFile | null>
  [IpcChannels.dialogOpenPdfs]: () => Promise<OpenedPdfFile[]>
  [IpcChannels.dialogSavePdf]: (options: SaveDialogOptions) => Promise<string | null>
  [IpcChannels.dialogChooseFolder]: (defaultPath?: string) => Promise<string | null>
  [IpcChannels.fileRead]: (path: string) => Promise<FileReadResult>
  [IpcChannels.fileWrite]: (request: WriteFileRequest) => Promise<void>
  [IpcChannels.fileWriteMany]: (files: WriteManyItem[]) => Promise<void>
  [IpcChannels.filePrint]: (path: string) => Promise<void>
  [IpcChannels.recentList]: () => RecentFile[] | Promise<RecentFile[]>
  [IpcChannels.recentRemove]: (path: string) => RecentFile[] | Promise<RecentFile[]>
}
