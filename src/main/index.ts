import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { isAllowedExternalUrl } from '@shared/external-links'
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from '@shared/settings-schema'
import { registerIpcHandlers } from './ipc'
import { SettingsStore } from './services/settings-store'

const APP_USER_MODEL_ID = 'ru.promptix.pdfwright'

// Один экземпляр: второй запуск передаёт аргументы первому и завершается.
// Передача пути к файлу появится в фазе 2 вместе с просмотрщиком.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_USER_MODEL_ID)

  const settings = SettingsStore.forUserData(app.getPath('userData'))
  await settings.load()

  await app.whenReady()

  applyContentSecurityPolicy()
  registerIpcHandlers(settings)

  const window = createMainWindow(settings)

  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(settings)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

function createMainWindow(settings: SettingsStore): BrowserWindow {
  const saved = settings.get().window

  const window = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1f',
    title: 'PDFwright',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  if (saved.maximized) window.maximize()
  window.once('ready-to-show', () => {
    window.show()
  })

  // Предупреждения и ошибки renderer дублируются в stderr main-процесса:
  // так их видно в логах CI и при запуске из консоли без DevTools.
  window.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.error(`[renderer:${details.level}] ${details.message}`)
    } else if (!app.isPackaged) {
      console.log(`[renderer:${details.level}] ${details.message}`)
    }
  })

  // Любая навигация и новые окна запрещены; разрешённые внешние ссылки
  // открываются в системном браузере.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  // Размер окна запоминаем при закрытии, чтобы не писать файл на каждый пиксель.
  window.on('close', () => {
    const [width, height] = window.getSize()
    void settings.update({
      window: {
        width: width ?? saved.width,
        height: height ?? saved.height,
        maximized: window.isMaximized()
      }
    })
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * Content Security Policy задаётся заголовком, а не meta-тегом: в dev-режиме
 * Vite и React Fast Refresh внедряют inline-скрипты, поэтому там политика
 * мягче; в собранном приложении — только собственные ресурсы.
 */
function applyContentSecurityPolicy(): void {
  const dev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
  const policy = dev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' ws: http://localhost:*",
        "worker-src 'self' blob:"
      ]
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ]

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy.join('; ')]
      }
    })
  })
}
