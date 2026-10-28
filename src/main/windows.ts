import { app, BrowserWindow, dialog, screen, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import {
  APP_OPEN_FILE_CHANNEL,
  UPDATE_AVAILABLE_CHANNEL,
  UPDATE_PROGRESS_CHANNEL,
  type LanguageApplyResult,
  type StartupFiles,
  type UpdateAvailable,
  type UpdateProgress,
  type WindowTabs
} from '@shared/ipc-contract'
import { isAllowedExternalUrl } from '@shared/external-links'
import { UPDATE_DIRTY_ERROR } from '@shared/update-messages'
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, type SessionWindow } from '@shared/settings-schema'
import { rendererIndexUrl } from './protocol'
import { mainStrings } from './strings'
import { interfaceLanguage } from './language'
import type { SettingsStore } from './services/settings-store'
import { cascadeFrame, fitFrameToScreens, pickWindowForFile, type WindowFrame } from './window-plan'

interface WindowEntry {
  window: BrowserWindow
  /** Порядковый номер последней активации: файл из Проводника идёт в самое активное окно. */
  lastActive: number
  /** Документы с несохранёнными изменениями в этом окне. */
  dirty: number
  tabs: WindowTabs
  /** Файлы для renderer, пока он их не забрал; null — уже забрал. */
  startup: StartupFiles | null
}

interface SessionEntry {
  lastActive: number
  window: SessionWindow
}

export interface WindowOptions {
  frame?: WindowFrame
  maximized?: boolean
  open?: Partial<StartupFiles>
}

/**
 * Окна программы. У каждого окна свой renderer со своими вкладками; main
 * знает про окно его вкладки, число несохранённых документов и время
 * последней активации. Сеанс (вкладки и рамки окон) пишется в настройки при
 * закрытии окон: окно, закрытое само по себе, из сеанса уходит, а окна,
 * закрытые при выходе, и последнее окно — остаются.
 */
export class WindowManager {
  /** Ключ — id webContents: по нему IPC узнаёт окно отправителя. */
  private readonly entries = new Map<number, WindowEntry>()
  private activation = 0
  private quitting = false
  private retained: SessionEntry[] = []
  private updateOwner: WebContents | null = null
  private installingUpdate = false

  constructor(private readonly settings: SettingsStore) {}

  /** Начался выход (before-quit): окна, которые закроются дальше, остаются в сеансе. */
  beginQuit(): void {
    this.quitting = true
  }

  create(options: WindowOptions = {}): BrowserWindow {
    const saved = this.settings.get().window
    const frame = options.frame ?? { x: null, y: null, width: saved.width, height: saved.height }
    const bounds = fitFrameToScreens(
      frame,
      screen.getAllDisplays().map((display) => display.workArea)
    )

    const window = new BrowserWindow({
      ...bounds,
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
    const id = window.webContents.id
    const files = options.open?.files ?? []
    const active = options.open?.active ?? null
    this.entries.set(id, {
      window,
      lastActive: ++this.activation,
      dirty: 0,
      tabs: { paths: [...files], active },
      startup: { files: [...files], active, missing: options.open?.missing ?? [] }
    })

    if (options.maximized ?? saved.maximized) window.maximize()
    window.once('ready-to-show', () => {
      window.show()
    })
    window.on('focus', () => {
      const entry = this.entries.get(id)
      if (entry) entry.lastActive = ++this.activation
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

    // Любая навигация и новые окна из страницы запрещены; разрешённые внешние
    // ссылки открываются в системном браузере.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== window.webContents.getURL()) event.preventDefault()
    })

    window.on('close', (event) => {
      const entry = this.entries.get(id)
      if (!entry) return
      // Несохранённые изменения: спрашиваем подтверждение до закрытия окна.
      if (entry.dirty > 0 && !this.installingUpdate && !this.confirmClose(entry)) {
        event.preventDefault()
        // Отказ закрыть окно отменяет и выход: окна, закрытые до этого, в сеанс не идут.
        this.quitting = false
        this.retained = []
        return
      }
      const snapshot = { lastActive: entry.lastActive, window: this.snapshot(entry) }
      if (this.quitting || this.entries.size === 1) this.retained.push(snapshot)
      this.entries.delete(id)
      void this.persist(snapshot.window)
    })
    window.on('closed', () => {
      this.entries.delete(id)
    })

    void window.loadURL(this.pageUrl())
    return window
  }

  /** Адрес интерфейса на языке из настроек (dev-сервер или протокол app://). */
  private pageUrl(): string {
    const language = interfaceLanguage(this.settings)
    const devServerUrl = process.env.ELECTRON_RENDERER_URL
    if (!app.isPackaged && devServerUrl) {
      const url = new URL(devServerUrl)
      url.searchParams.set('lang', language)
      return url.toString()
    }
    return rendererIndexUrl(language)
  }

  /**
   * Новый язык интерфейса: каждое окно загружается заново и открывает те же
   * вкладки. Если где-то есть несохранённые правки, ничего не перезагружается —
   * язык сменится при следующем запуске или после сохранения.
   */
  applyLanguage(): LanguageApplyResult {
    const language = interfaceLanguage(this.settings)
    // «Как в системе» вместо того же языка: окна уже на нём, перезагрузка не нужна.
    const stale = [...this.entries.values()].filter((entry) => {
      const url = URL.parse(entry.window.webContents.getURL())
      return url?.searchParams.get('lang') !== language
    })
    if (stale.length === 0) return { applied: true, dirty: 0 }
    const dirty = [...this.entries.values()].reduce((sum, entry) => sum + entry.dirty, 0)
    if (dirty > 0) return { applied: false, dirty }
    for (const entry of stale) {
      entry.startup = { files: [...entry.tabs.paths], active: entry.tabs.active, missing: [] }
      void entry.window.loadURL(this.pageUrl())
    }
    return { applied: true, dirty: 0 }
  }

  /** «Файл → Новое окно»: пустое окно со сдвигом от активного. */
  newWindow(): BrowserWindow {
    return this.createNear(BrowserWindow.getFocusedWindow() ?? this.latest()?.window ?? null, {})
  }

  /** Вкладка «Открыть в новом окне»: файл переезжает в новое окно рядом с исходным. */
  openInNewWindow(sender: WebContents, path: string): void {
    this.createNear(BrowserWindow.fromWebContents(sender), { files: [path], active: path })
  }

  /** Файл из Проводника или второго экземпляра программы. */
  openFile(path: string): void {
    const target = pickWindowForFile(
      [...this.entries].map(([id, entry]) => ({
        id,
        lastActive: entry.lastActive,
        tabs: entry.tabs.paths
      })),
      path
    )
    const entry = target === null ? undefined : this.entries.get(target)
    if (!entry) {
      this.create({ open: { files: [path], active: path } })
      return
    }
    if (entry.startup) {
      // Renderer ещё не загрузился: файл уйдёт вместе со стартовым набором.
      if (!entry.startup.files.includes(path)) entry.startup.files.push(path)
      entry.startup.active = path
    } else {
      entry.window.webContents.send(APP_OPEN_FILE_CHANNEL, path)
    }
    this.reveal(entry.window)
  }

  /** Второй запуск без файла: показываем последнее активное окно. */
  revealLatest(): void {
    const entry = this.latest()
    if (entry) this.reveal(entry.window)
  }

  takeStartup(sender: WebContents): StartupFiles {
    const entry = this.entries.get(sender.id)
    const startup = entry?.startup ?? { files: [], active: null, missing: [] }
    if (entry) entry.startup = null
    return startup
  }

  setDirty(sender: WebContents, count: number): void {
    const entry = this.entries.get(sender.id)
    if (entry) entry.dirty = count
  }

  setTabs(sender: WebContents, tabs: WindowTabs): void {
    const entry = this.entries.get(sender.id)
    if (entry) entry.tabs = tabs
  }

  /** Прогресс скачивания обновления видит окно, которое его начало. */
  setUpdateOwner(sender: WebContents): void {
    this.updateOwner = sender
  }

  /** Автоматическая проверка нашла новую версию: предупреждают все окна. */
  sendUpdateAvailable(update: UpdateAvailable): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(UPDATE_AVAILABLE_CHANNEL, update)
    }
  }

  sendUpdateProgress(progress: UpdateProgress): void {
    const owner = this.updateOwner
    if (owner && !owner.isDestroyed()) owner.send(UPDATE_PROGRESS_CHANNEL, progress)
  }

  /**
   * Установка обновления закрывает все окна без вопросов, поэтому
   * несохранённые документы в любом окне её запрещают.
   */
  runUpdateInstall(install: () => void): void {
    if ([...this.entries.values()].some((entry) => entry.dirty > 0)) {
      throw new Error(UPDATE_DIRTY_ERROR)
    }
    this.installingUpdate = true
    try {
      install()
    } catch (error) {
      this.installingUpdate = false
      throw error
    }
  }

  private createNear(source: BrowserWindow | null, open: Partial<StartupFiles>): BrowserWindow {
    if (!source || source.isDestroyed()) return this.create({ open })
    return this.create({
      frame: cascadeFrame(source.getNormalBounds()),
      maximized: source.isMaximized(),
      open
    })
  }

  private latest(): WindowEntry | undefined {
    let best: WindowEntry | undefined
    for (const entry of this.entries.values()) {
      if (!best || entry.lastActive > best.lastActive) best = entry
    }
    return best
  }

  private reveal(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    window.focus()
  }

  private confirmClose(entry: WindowEntry): boolean {
    const s = mainStrings(interfaceLanguage(this.settings)).close
    const choice = dialog.showMessageBoxSync(entry.window, {
      type: 'warning',
      title: 'PDFwright',
      message: entry.dirty === 1 ? s.oneDirty : s.manyDirty(entry.dirty),
      detail: this.entries.size > 1 && !this.quitting ? s.closeWindow : s.quitApp,
      buttons: [s.discard, s.cancel],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    return choice === 0
  }

  private snapshot(entry: WindowEntry): SessionWindow {
    const bounds = entry.window.getNormalBounds()
    const { paths, active } = entry.tabs
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: entry.window.isMaximized(),
      tabs: paths,
      active: active === null ? 0 : Math.max(0, paths.indexOf(active))
    }
  }

  /**
   * Пишет сеанс и размер закрытого окна (по нему открываются новые окна).
   * Окна идут по времени активации: самое активное восстановится последним
   * и окажется сверху.
   */
  private async persist(closed: SessionWindow): Promise<void> {
    const live: SessionEntry[] = [...this.entries.values()].map((entry) => ({
      lastActive: entry.lastActive,
      window: this.snapshot(entry)
    }))
    const windows = [...this.retained, ...live]
      .sort((a, b) => a.lastActive - b.lastActive)
      .map((item) => item.window)
    try {
      await this.settings.update({
        window: { width: closed.width, height: closed.height, maximized: closed.maximized },
        session: { windows: this.settings.get().session.restore ? windows : [] }
      })
    } catch (error) {
      console.warn('[windows] не удалось сохранить сеанс:', error)
    }
  }
}
