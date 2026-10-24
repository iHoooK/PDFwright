import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_COMMAND_CHANNEL,
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
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: unknown): void => {
      if (isAppCommand(command)) listener(command)
    }
    ipcRenderer.on(APP_COMMAND_CHANNEL, handler)
    return () => {
      ipcRenderer.off(APP_COMMAND_CHANNEL, handler)
    }
  }
}

contextBridge.exposeInMainWorld('pdfwright', api)
