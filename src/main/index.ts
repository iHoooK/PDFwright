import { app, BrowserWindow, session } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { installApplicationMenu } from './menu'
import { mainStrings } from './strings'
import { setMessageLanguage } from '@shared/messages'
import { extractPdfPath } from './open-args'
import { installAppProtocol, registerAppScheme, rendererDirFromMain } from './protocol'
import { isPortableBuild } from './services/app-paths'
import { RecentFilesStore } from './services/recent-files'
import { UpdateService } from './services/update-service'
import { SettingsStore } from './services/settings-store'
import { planSessionRestore } from './window-plan'
import { WindowManager } from './windows'

const APP_USER_MODEL_ID = 'ru.promptix.pdfwright'

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
  void bootstrap(extractPdfPath(process.argv, process.cwd()))
}

async function bootstrap(startupFile: string | null): Promise<void> {
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
  const windows = new WindowManager(settings)
  registerIpcHandlers({
    settings,
    recent,
    windows,
    updates: new UpdateService(isPortableBuild(), (progress) => {
      windows.sendUpdateProgress(progress)
    }),
    onLanguageChange: () => {
      applyLanguage()
    }
  })
  // Меню и сообщения общего кода — на языке из настроек; при смене языка ставятся заново.
  const applyLanguage = (): void => {
    const language = settings.get().general.language
    setMessageLanguage(language)
    installApplicationMenu({
      newWindow: () => {
        windows.newWindow()
      },
      strings: mainStrings(language)
    })
  }
  applyLanguage()

  await openStartupWindows(windows, settings, startupFile)

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const file = extractPdfPath(argv, workingDirectory)
    if (file === null) windows.revealLatest()
    else windows.openFile(file)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.create()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    windows.beginQuit()
  })

  // Сеанс пишется при закрытии окон; выход ждёт, пока запись дойдёт до диска,
  // но не дольше нескольких секунд, и завершается напрямую: окна уже закрыты,
  // а повторный app.quit() изредка оставлял процесс висеть без окон.
  let flushed = false
  app.on('will-quit', (event) => {
    if (flushed) return
    flushed = true
    event.preventDefault()
    const limit = new Promise((resolve) => setTimeout(resolve, 5_000))
    void Promise.race([settings.flush(), limit]).finally(() => {
      app.exit(0)
    })
  })
}

/**
 * Первые окна: файл из аргументов запуска — в одном окне; без файла —
 * окна и вкладки прошлого сеанса, если это включено в Параметрах.
 * Отсутствующие файлы пропускаются, о них сообщает самое активное окно.
 */
async function openStartupWindows(
  windows: WindowManager,
  settings: SettingsStore,
  file: string | null
): Promise<void> {
  const session = settings.get().session
  if (file !== null || !session.restore || session.windows.length === 0) {
    windows.create(file === null ? {} : { open: { files: [file], active: file } })
    return
  }
  const paths = session.windows.flatMap((window) => window.tabs)
  const found = new Set(
    (await Promise.all(paths.map(async (path) => ((await isFile(path)) ? path : null)))).filter(
      (path) => path !== null
    )
  )
  const plan = planSessionRestore(session.windows, (path) => found.has(path))
  if (plan.windows.length === 0) {
    windows.create({ open: { missing: plan.missing } })
    return
  }
  plan.windows.forEach((window, index) => {
    const last = index === plan.windows.length - 1
    windows.create({
      frame: window.frame,
      maximized: window.maximized,
      open: { files: window.files, active: window.active, missing: last ? plan.missing : [] }
    })
  })
}

async function isFile(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
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
