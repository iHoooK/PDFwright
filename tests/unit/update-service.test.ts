import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateService } from '../../src/main/services/update-service'

type Listener = (...args: unknown[]) => void

/** electron-updater без сети: проверка сразу сообщает о версии 1.1.0. */
const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<Listener>>()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    logger: {},
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
      return updater
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener)
      return updater
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
    },
    reset() {
      listeners.clear()
    },
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    quitAndInstall: vi.fn()
  }
  return { updater }
})

vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '1.0.0' } }))
vi.mock('electron-updater', () => ({
  autoUpdater: mocks.updater,
  CancellationToken: class {
    cancel(): void {
      // проверке отмена не нужна
    }
  }
}))

const release = {
  version: '1.1.0',
  releaseDate: '2026-11-01T00:00:00.000Z',
  releaseNotes: null,
  files: [{ url: 'PDFwright-Setup-x64.exe', sha512: 'x', size: 123 }]
}

describe('UpdateService: кто ставит обновление сам', () => {
  beforeEach(() => {
    const { updater } = mocks
    updater.reset()
    updater.checkForUpdates.mockImplementation(() => {
      queueMicrotask(() => {
        updater.emit('update-available', release)
      })
      return Promise.resolve(null)
    })
    updater.downloadUpdate.mockClear()
  })

  it('Windows, установленная версия: предлагает скачать и установить', async () => {
    const service = new UpdateService(false, () => undefined, 'win32')
    const result = await service.check()
    expect(result).toMatchObject({ status: 'available', canInstall: true })
    await service.download()
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('Windows, portable: только ссылка на страницу релиза', async () => {
    const service = new UpdateService(true, () => undefined, 'win32')
    expect(await service.check()).toMatchObject({ status: 'available', canInstall: false })
  })

  it('Mac: новая версия находится, а ставится вручную со страницы релиза', async () => {
    const service = new UpdateService(false, () => undefined, 'darwin')
    const result = await service.check()
    expect(result).toEqual({
      status: 'available',
      canInstall: false,
      info: {
        version: '1.1.0',
        releaseDate: '2026-11-01T00:00:00.000Z',
        releaseNotes: null,
        size: 123,
        page: 'https://github.com/iHoooK/PDFwright/releases/tag/v1.1.0'
      }
    })
    await expect(service.download()).rejects.toThrow('страницы релиза')
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })
})
