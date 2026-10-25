import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { join } from 'node:path'
import { APP_OPEN_FILE_CHANNEL, UPDATE_PROGRESS_CHANNEL } from '@shared/ipc-contract'
import { isAllowedExternalUrl } from '@shared/external-links'
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from '@shared/settings-schema'
import { registerIpcHandlers } from './ipc'
import { installApplicationMenu } from './menu'
import { extractPdfPath } from './open-args'
import {
  installAppProtocol,
  registerAppScheme,
  rendererDirFromMain,
  rendererIndexUrl
} from './protocol'
import { isPortableBuild } from './services/app-paths'
import { RecentFilesStore } from './services/recent-files'
import { UpdateService } from './services/update-service'
import { SettingsStore } from './services/settings-store'

const APP_USER_MODEL_ID = 'ru.promptix.pdfwright'

let mainWindow: BrowserWindow | null = null
let pendingFile: string | null = null
let dirtyCount = 0
let installingUpdate = false

// E2E-тесты запускают несобранное приложение со своей папкой данных, чтобы не
// трогать настройки и недавние файлы пользователя. В установленной программе
// переменная игнорируется. Должно идти до блокировки единственного экземпляра:
// блокировка хранится в папке данных.
const testUserData = process.env.PDFWRIGHT_USER_DATA
if (!app.isPackaged && testUserData) app.setPath('userData', testUserData)

// Один экземпляр: второй запуск передаёт аргументы первому и завершается.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerAppScheme()
  pendingFile = extractPdfPath(process.argv, process.cwd())
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_USER_MODEL_ID)

  const settings = SettingsStore.forUserData(app.getPath('userData'))
  await settings.load()
  const recent = RecentFilesStore.forUserData(
    app.getPath('userData'),
    () => settings.get().files.recentLimit
  )

  await app.whenReady()

  const csp = buildContentSecurityPolicy()
  applyContentSecurityPolicy(csp)
  installAppProtocol(rendererDirFromMain(import.meta.dirname), csp)
  registerIpcHandlers({
    settings,
    recent,
    takePendingFile: () => {
      const file = pendingFile
      pendingFile = null
      return file
    },
    setDirtyCount: (count) => {
      dirtyCount = count
    },
    updates: new UpdateService(isPortableBuild(), (progress) => {
      installingUpdate = progress.percent >= 100
      mainWindow?.webContents.send(UPDATE_PROGRESS_CHANNEL, progress)
    })
  })
  installApplicationMenu()

  mainWindow = createMainWindow(settings)

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const window = mainWindow
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
    const file = extractPdfPath(argv, workingDirectory)
    if (file !== null) window.webContents.send(APP_OPEN_FILE_CHANNEL, file)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(settings)
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
    backgroundColor: '#f3f3f3',
    title: 'PDFwright',
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'resources', 'icon-256.png') }),
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

  // Несохранённые изменения: спрашиваем подтверждение до закрытия окна.
  window.on('close', (event) => {
    if (dirtyCount === 0 || installingUpdate) return
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'PDFwright',
      message:
        dirtyCount === 1
          ? 'В документе есть несохранённые изменения.'
          : `Несохранённые изменения в документах: ${dirtyCount}.`,
      detail: 'Закрыть программу без сохранения? Изменения будут потеряны.',
      buttons: ['Закрыть без сохранения', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (choice !== 0) event.preventDefault()
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
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadURL(rendererIndexUrl())
  }

  return window
}

/**
 * Content Security Policy задаётся заголовком, а не meta-тегом: в dev-режиме
 * Vite и React Fast Refresh внедряют inline-скрипты, поэтому там политика
 * мягче; в собранном приложении — только собственные ресурсы по схеме app://.
 * pdf.js подключает шрифты как data:, worker и blob: нужны его потокам.
 */
function buildContentSecurityPolicy(): string {
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
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ]
  return policy.join('; ')
}

function applyContentSecurityPolicy(csp: string): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
}
