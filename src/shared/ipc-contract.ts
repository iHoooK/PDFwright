import type { AppSettings, SettingsPatch } from './settings-schema'

/**
 * Единственный источник правды о каналах IPC между main и renderer.
 * Renderer видит только типизированный API `window.pdfwright`, который
 * preload строит из этих каналов; прямого доступа к ipcRenderer у него нет.
 */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appTakeStartup: 'app:take-startup',
  appSetDirty: 'app:set-dirty',
  appApplyLanguage: 'app:apply-language',
  windowSetTabs: 'window:set-tabs',
  windowOpenFile: 'window:open-file',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  shellOpenExternal: 'shell:open-external',
  shellShowItem: 'shell:show-item',
  dialogOpenPdf: 'dialog:open-pdf',
  dialogOpenPdfs: 'dialog:open-pdfs',
  dialogSavePdf: 'dialog:save-pdf',
  dialogChooseFolder: 'dialog:choose-folder',
  dialogOpenImages: 'dialog:open-images',
  dialogSaveText: 'dialog:save-text',
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileWriteMany: 'file:write-many',
  filePrint: 'file:print',
  recentList: 'recent:list',
  recentRemove: 'recent:remove',
  recentAdd: 'recent:add',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateCancel: 'update:cancel',
  updateInstall: 'update:install',
  updatePending: 'update:pending'
} as const

/** Канал main → renderer: команды меню приложения и системных ускорителей. */
export const APP_COMMAND_CHANNEL = 'app:command'
/** Канал main → renderer: открыть файл (второй экземпляр, ассоциация .pdf). */
export const APP_OPEN_FILE_CHANNEL = 'app:open-file'
/** Канал main → renderer: прогресс скачивания обновления. */
export const UPDATE_PROGRESS_CHANNEL = 'update:progress'
/** Канал main → renderer: автоматическая проверка нашла новую версию. */
export const UPDATE_AVAILABLE_CHANNEL = 'update:available'

/**
 * Сообщение ошибки чтения пропавшего файла. Electron передаёт в renderer только
 * текст ошибки (с префиксом «Error invoking remote method…»), поэтому renderer
 * узнаёт её по этому маркеру и показывает понятное «Файл не найден».
 */
export const FILE_MISSING_ERROR = 'PDFWRIGHT_FILE_MISSING'

export function isFileMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(FILE_MISSING_ERROR)
}

export const APP_COMMANDS = [
  'file.open',
  'file.save',
  'file.saveAs',
  'file.print',
  'file.close',
  'file.properties',
  'file.protect',
  'edit.undo',
  'edit.redo',
  'edit.find',
  'tools.toImages',
  'tools.fromImages',
  'tools.extractText',
  'tools.ocr',
  'tools.compress',
  'tools.merge',
  'tools.split',
  'tools.compare',
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

export interface WriteManyOptions {
  /** Не перезаписывать существующие файлы: занятое имя получает « (2)», « (3)»… */
  unique?: boolean
}

/** Итог смены языка: окна перезагружены или ждут сохранения документов. */
export interface LanguageApplyResult {
  applied: boolean
  /** Несохранённые документы во всех окнах (если не применено). */
  dirty: number
}

/** Что открыть в новом окне: файлы вкладок, активная вкладка, пропавшие файлы сеанса. */
export interface StartupFiles {
  files: string[]
  active: string | null
  /** Файлы прошлого сеанса, которых нет на диске: окно сообщает о них. */
  missing: string[]
}

/** Вкладки окна для сеанса и выбора окна под файл из Проводника. */
export interface WindowTabs {
  paths: string[]
  active: string | null
}

/** Картинка, выбранная в диалоге «Изображения в PDF»: main сразу читает её байты. */
export interface PickedImage {
  path: string
  name: string
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
  /** Число страниц при последнем открытии; нет — ещё не известно. */
  pages?: number
}

export interface UpdateInfoSummary {
  version: string
  releaseDate: string | null
  releaseNotes: string | null
  size: number | null
  /** Страница релиза на GitHub. */
  page: string
}

export type UpdateCheckResult =
  | { status: 'none'; current: string }
  | { status: 'available'; info: UpdateInfoSummary; canInstall: boolean }

/** Новая версия, найденная автоматической проверкой. */
export interface UpdateAvailable {
  info: UpdateInfoSummary
  canInstall: boolean
}

/** Проверка формы события UPDATE_AVAILABLE_CHANNEL в preload. */
export function isUpdateAvailable(value: unknown): value is UpdateAvailable {
  if (typeof value !== 'object' || value === null) return false
  const { info, canInstall } = value as Partial<UpdateAvailable>
  return (
    typeof canInstall === 'boolean' &&
    typeof info === 'object' &&
    typeof info.version === 'string' &&
    typeof info.page === 'string'
  )
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
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
  /** Выбор картинок PNG/JPEG/WebP; файлы не попадают в «Недавние». */
  openImagesDialog: () => Promise<PickedImage[]>
  /** Путь для сохранения текста; расширение .txt добавляется само. */
  saveTextDialog: (options: SaveDialogOptions) => Promise<string | null>
  /** Читает файл; в «Недавние» он не попадает (это делает addRecentFile после открытия). */
  readFile: (path: string) => Promise<FileReadResult>
  writeFile: (request: WriteFileRequest) => Promise<void>
  /** Пишет файлы и возвращает их пути (с unique — свободные имена рядом с занятыми). */
  writeFiles: (files: WriteManyItem[], options?: WriteManyOptions) => Promise<string[]>
  printFile: (path: string) => Promise<void>
  getRecentFiles: () => Promise<RecentFile[]>
  removeRecentFile: (path: string) => Promise<RecentFile[]>
  /** Документ открыт во вкладке: файл поднимается в начало «Недавних». */
  addRecentFile: (path: string, pages?: number) => Promise<RecentFile[]>
  /** Сколько документов с несохранёнными изменениями: main спрашивает подтверждение при закрытии окна. */
  setDirtyCount: (count: number) => Promise<void>
  /** Файлы, с которыми открыто окно (аргументы запуска, сеанс, «Открыть в новом окне»); отдаются один раз. */
  takeStartupFiles: () => Promise<StartupFiles>
  /** Перезагружает окна на языке из настроек; вкладки открываются снова. */
  applyLanguage: () => Promise<LanguageApplyResult>
  /** Вкладки окна: main запоминает их для сеанса и для выбора окна под файл. */
  setWindowTabs: (tabs: WindowTabs) => Promise<void>
  /** Открывает файл в новом окне программы. */
  openInNewWindow: (path: string) => Promise<void>
  /** Проверка обновлений по кнопке; сама программа проверяет их при запуске и раз в 12 часов. */
  checkForUpdates: () => Promise<UpdateCheckResult>
  downloadUpdate: () => Promise<void>
  cancelUpdateDownload: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateProgress: (listener: (progress: UpdateProgress) => void) => () => void
  /** Новая версия, найденная автоматической проверкой до открытия окна, или null. */
  pendingUpdate: () => Promise<UpdateAvailable | null>
  /** Подписка на новые версии, найденные автоматической проверкой. */
  onUpdateAvailable: (listener: (update: UpdateAvailable) => void) => () => void
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
  [IpcChannels.appTakeStartup]: () => StartupFiles
  [IpcChannels.appSetDirty]: (count: number) => void
  [IpcChannels.appApplyLanguage]: () => LanguageApplyResult
  [IpcChannels.windowSetTabs]: (tabs: WindowTabs) => void
  [IpcChannels.windowOpenFile]: (path: string) => void
  [IpcChannels.settingsGet]: () => AppSettings | Promise<AppSettings>
  [IpcChannels.settingsUpdate]: (patch: SettingsPatch) => AppSettings | Promise<AppSettings>
  [IpcChannels.shellOpenExternal]: (url: string) => void | Promise<void>
  [IpcChannels.shellShowItem]: (path: string) => void
  [IpcChannels.dialogOpenPdf]: () => OpenedPdfFile | null | Promise<OpenedPdfFile | null>
  [IpcChannels.dialogOpenPdfs]: () => Promise<OpenedPdfFile[]>
  [IpcChannels.dialogSavePdf]: (options: SaveDialogOptions) => Promise<string | null>
  [IpcChannels.dialogChooseFolder]: (defaultPath?: string) => Promise<string | null>
  [IpcChannels.dialogOpenImages]: () => Promise<PickedImage[]>
  [IpcChannels.dialogSaveText]: (options: SaveDialogOptions) => Promise<string | null>
  [IpcChannels.fileRead]: (path: string) => Promise<FileReadResult>
  [IpcChannels.fileWrite]: (request: WriteFileRequest) => Promise<void>
  [IpcChannels.fileWriteMany]: (
    files: WriteManyItem[],
    options?: WriteManyOptions
  ) => Promise<string[]>
  [IpcChannels.filePrint]: (path: string) => Promise<void>
  [IpcChannels.recentList]: () => RecentFile[] | Promise<RecentFile[]>
  [IpcChannels.recentRemove]: (path: string) => RecentFile[] | Promise<RecentFile[]>
  [IpcChannels.recentAdd]: (path: string, pages?: number) => Promise<RecentFile[]>
  [IpcChannels.updateCheck]: () => Promise<UpdateCheckResult>
  [IpcChannels.updateDownload]: () => Promise<void>
  [IpcChannels.updateCancel]: () => void
  [IpcChannels.updateInstall]: () => void
  [IpcChannels.updatePending]: () => UpdateAvailable | null
}
