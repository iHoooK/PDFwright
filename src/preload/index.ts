import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  APP_COMMAND_CHANNEL,
  APP_OPEN_FILE_CHANNEL,
  IpcChannels,
  isAppCommand,
  type PdfwrightApi
} from '@shared/ipc-contract'

/**
 * Узкий мост между renderer и main. Renderer получает только функции ниже;
 * сам ipcRenderer, require и Node API ему недоступны (sandbox + contextIsolation).
 */
const api: PdfwrightApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.shellOpenExternal, url),
  openPdfDialog: () => ipcRenderer.invoke(IpcChannels.dialogOpenPdf),
  readFile: (path) => ipcRenderer.invoke(IpcChannels.fileRead, path),
  printFile: (path) => ipcRenderer.invoke(IpcChannels.filePrint, path),
  getRecentFiles: () => ipcRenderer.invoke(IpcChannels.recentList),
  removeRecentFile: (path) => ipcRenderer.invoke(IpcChannels.recentRemove, path),
  takePendingOpenFile: () => ipcRenderer.invoke(IpcChannels.appTakePendingFile),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: unknown): void => {
      if (isAppCommand(command)) listener(command)
    }
    ipcRenderer.on(APP_COMMAND_CHANNEL, handler)
    return () => {
      ipcRenderer.off(APP_COMMAND_CHANNEL, handler)
    }
  },
  onOpenFile: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, path: unknown): void => {
      if (typeof path === 'string' && path.length > 0) listener(path)
    }
    ipcRenderer.on(APP_OPEN_FILE_CHANNEL, handler)
    return () => {
      ipcRenderer.off(APP_OPEN_FILE_CHANNEL, handler)
    }
  }
}

contextBridge.exposeInMainWorld('pdfwright', api)
