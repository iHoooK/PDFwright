import { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'

/**
 * Печать PDF через встроенный просмотрщик Chromium: файл открывается в
 * скрытом окне, затем вызывается системный диалог печати. Так страницы
 * печатаются в векторе, а не как снимки canvas из нашего просмотрщика.
 */
export async function printPdfFile(path: string, failed: string): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, plugins: true }
  })
  try {
    await window.loadURL(pathToFileURL(path).href)
    // Просмотрщик PDF — плагин во вложенном кадре; даём ему время отрисоваться.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await new Promise<void>((resolve, reject) => {
      window.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success || reason === 'cancelled' || reason === 'Print job canceled') resolve()
        else reject(new Error(reason || failed))
      })
    })
  } finally {
    window.destroy()
  }
}
