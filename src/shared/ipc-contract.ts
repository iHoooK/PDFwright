import type { AppSettings, SettingsPatch } from './settings-schema'

/**
 * Единственный источник правды о каналах IPC между main и renderer.
 * Renderer видит только типизированный API `window.pdfwright`, который
 * preload строит из этих каналов; прямого доступа к ipcRenderer у него нет.
 */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  shellOpenExternal: 'shell:open-external',
  dialogOpenPdf: 'dialog:open-pdf'
} as const

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

/** Контракт, который preload публикует в renderer как `window.pdfwright`. */
export interface PdfwrightApi {
  getAppInfo: () => Promise<AppInfo>
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
  openExternal: (url: string) => Promise<void>
  openPdfDialog: () => Promise<OpenedPdfFile | null>
}

/** Сигнатуры обработчиков в main: ключ — канал, значение — (args) => result. */
export interface IpcHandlers {
  [IpcChannels.appGetInfo]: () => AppInfo | Promise<AppInfo>
  [IpcChannels.settingsGet]: () => AppSettings | Promise<AppSettings>
  [IpcChannels.settingsUpdate]: (patch: SettingsPatch) => AppSettings | Promise<AppSettings>
  [IpcChannels.shellOpenExternal]: (url: string) => void | Promise<void>
  [IpcChannels.dialogOpenPdf]: () => OpenedPdfFile | null | Promise<OpenedPdfFile | null>
}
