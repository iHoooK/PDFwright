import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type PdfwrightApi } from '@shared/ipc-contract'

/**
 * Узкий мост между renderer и main. Renderer получает только функции ниже;
 * сам ipcRenderer, require и Node API ему недоступны (sandbox + contextIsolation).
 */
const api: PdfwrightApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.shellOpenExternal, url),
  openPdfDialog: () => ipcRenderer.invoke(IpcChannels.dialogOpenPdf)
}

contextBridge.exposeInMainWorld('pdfwright', api)
