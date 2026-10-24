import type { AppSettings, SettingsPatch } from './settings-schema'

/**
 * Единственный источник правды о каналах IPC между main и renderer.
 * Renderer видит только типизированный API `window.pdfwright`, который
 * preload строит из этих каналов; прямого доступа к ipcRenderer у него нет.
 */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appTakePendingFile: 'app:take-pending-file',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  shellOpenExternal: 'shell:open-external',
  dialogOpenPdf: 'dialog:open-pdf',
  fileRead: 'file:read',
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
  'app.settings',
  'app.start',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoomReset',
  'view.fitWidth',
  'view.fitPage',
  'view.rotate',
  'view.sidebar',
  'view.props',
  'view.theme',
  'edit.find',
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
  openPdfDialog: () => Promise<OpenedPdfFile | null>
  readFile: (path: string) => Promise<FileReadResult>
  printFile: (path: string) => Promise<void>
  getRecentFiles: () => Promise<RecentFile[]>
  removeRecentFile: (path: string) => Promise<RecentFile[]>
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
  [IpcChannels.settingsGet]: () => AppSettings | Promise<AppSettings>
  [IpcChannels.settingsUpdate]: (patch: SettingsPatch) => AppSettings | Promise<AppSettings>
  [IpcChannels.shellOpenExternal]: (url: string) => void | Promise<void>
  [IpcChannels.dialogOpenPdf]: () => OpenedPdfFile | null | Promise<OpenedPdfFile | null>
  [IpcChannels.fileRead]: (path: string) => Promise<FileReadResult>
  [IpcChannels.filePrint]: (path: string) => Promise<void>
  [IpcChannels.recentList]: () => RecentFile[] | Promise<RecentFile[]>
  [IpcChannels.recentRemove]: (path: string) => RecentFile[] | Promise<RecentFile[]>
}
