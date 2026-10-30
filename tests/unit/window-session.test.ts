import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from '../../src/main/services/settings-store'

/**
 * Сеанс окон (WindowManager) с подменённым Electron: окна — объекты в памяти,
 * настройки — настоящий SettingsStore во временной папке.
 */
const fake = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  class Emitter {
    private readonly listeners = new Map<string, Listener[]>()
    on(event: string, listener: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      return this
    }
    once(event: string, listener: Listener): this {
      return this.on(event, listener)
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }
  let nextId = 1
  class FakeContents extends Emitter {
    readonly id = nextId++
    send(): void {
      // окно в памяти
    }
    setWindowOpenHandler(): void {
      // окно в памяти
    }
    getURL(): string {
      return 'app://renderer/index.html?lang=ru'
    }
    isDestroyed(): boolean {
      return false
    }
  }
  const all: FakeWindow[] = []
  class FakeWindow extends Emitter {
    readonly webContents = new FakeContents()
    destroyed = false
    constructor() {
      super()
      all.push(this)
    }
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
    show(): void {
      // окно в памяти
    }
    maximize(): void {
      // окно в памяти
    }
    focus(): void {
      // окно в памяти
    }
    isMaximized(): boolean {
      return false
    }
    isMinimized(): boolean {
      return false
    }
    isFullScreen(): boolean {
      return false
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    getNormalBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 10, y: 20, width: 900, height: 700 }
    }
    /** Закрытие окна пользователем: close, затем closed. */
    close(): void {
      this.emit('close', { preventDefault: () => undefined })
      this.destroyed = true
      this.emit('closed')
    }
    static getAllWindows(): FakeWindow[] {
      return all.filter((window) => !window.destroyed)
    }
    static getFocusedWindow(): null {
      return null
    }
  }
  /** Тексты подтверждений закрытия; ответ — «Закрыть без сохранения». */
  const dialogs: string[] = []
  const showMessageBoxSync = (_window: unknown, options: { detail: string }): number => {
    dialogs.push(options.detail)
    return 0
  }
  return { FakeWindow, all, dialogs, showMessageBoxSync }
})

vi.mock('electron', () => ({
  app: { isPackaged: true, getLocale: () => 'ru', getAppPath: () => '.' },
  BrowserWindow: fake.FakeWindow,
  dialog: { showMessageBoxSync: fake.showMessageBoxSync },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  shell: { openExternal: () => Promise.resolve() },
  net: {},
  protocol: {}
}))

type FakeWindow = InstanceType<typeof fake.FakeWindow>
const asFake = (window: BrowserWindow): FakeWindow => window as unknown as FakeWindow

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/** WindowManager для платформы: модуль читает process.platform при загрузке. */
async function windowManager(platform: NodeJS.Platform, settings: SettingsStore) {
  setPlatform(platform)
  vi.resetModules()
  const { WindowManager } = await import('../../src/main/windows')
  const manager = new WindowManager(settings)
  /** Окно с документом: вкладки окна сообщает renderer. */
  const open = (path: string): FakeWindow => {
    const window = asFake(manager.create())
    manager.setTabs(window.webContents as never, { paths: [path], active: path })
    return window
  }
  return { manager, open }
}

describe('сеанс окон', () => {
  let dir: string
  let settings: SettingsStore
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfwright-session-'))
    settings = SettingsStore.forUserData(dir)
    await settings.load()
    fake.all.length = 0
  })
  afterEach(async () => {
    setPlatform(realPlatform)
    await settings.flush()
    await rm(dir, { recursive: true, force: true })
  })

  const sessionTabs = async (): Promise<string[][]> => {
    await settings.flush()
    return settings.get().session.windows.map((window) => window.tabs)
  }

  it('Windows: окно, закрытое само, уходит из сеанса, последнее — остаётся', async () => {
    const { open } = await windowManager('win32', settings)
    const a = open('C:\\a.pdf')
    const b = open('C:\\b.pdf')
    a.close()
    expect(await sessionTabs()).toEqual([['C:\\b.pdf']])
    b.close()
    expect(await sessionTabs()).toEqual([['C:\\b.pdf']])
  })

  it('Windows: при выходе в сеансе остаются все окна по порядку активации', async () => {
    const { manager, open } = await windowManager('win32', settings)
    const a = open('C:\\a.pdf')
    const b = open('C:\\b.pdf')
    manager.beginQuit()
    b.close()
    a.close()
    expect(await sessionTabs()).toEqual([['C:\\a.pdf'], ['C:\\b.pdf']])
  })

  it('Mac: окно после закрытия всех начинает сеанс заново, без «призраков»', async () => {
    const { manager, open } = await windowManager('darwin', settings)
    open('/a.pdf').close()
    // Программа осталась в Dock; в сеансе — окно, закрытое последним.
    expect(await sessionTabs()).toEqual([['/a.pdf']])
    // Щелчок по значку в Dock открывает новое окно, затем ⌘Q.
    const b = open('/b.pdf')
    manager.beginQuit()
    b.close()
    expect(await sessionTabs()).toEqual([['/b.pdf']])
  })

  it('несохранённое в последнем окне: в Windows закрывается программа, на Mac — окно', async () => {
    const closeDirty = async (platform: NodeJS.Platform): Promise<string | undefined> => {
      fake.dialogs.length = 0
      const { manager, open } = await windowManager(platform, settings)
      const window = open('/a.pdf')
      manager.setDirty(window.webContents as never, 1)
      window.close()
      return fake.dialogs[0]
    }
    expect(await closeDirty('win32')).toBe(
      'Закрыть программу без сохранения? Изменения будут потеряны.'
    )
    expect(await closeDirty('darwin')).toBe(
      'Закрыть окно без сохранения? Изменения будут потеряны.'
    )
  })

  it('Mac: выход без окон оставляет в сеансе окно, закрытое последним', async () => {
    const { manager, open } = await windowManager('darwin', settings)
    const a = open('/a.pdf')
    const b = open('/b.pdf')
    a.close()
    b.close()
    manager.beginQuit()
    expect(await sessionTabs()).toEqual([['/b.pdf']])
  })
})
