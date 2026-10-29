import { app } from 'electron'
import {
  autoUpdater,
  CancellationToken,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater'
import { PROJECT_REPOSITORY, RELEASES_PAGE } from '@shared/external-links'
import type { UpdateCheckResult, UpdateProgress } from '@shared/ipc-contract'

/**
 * Обновления через GitHub Releases на electron-updater. Проверку запускает
 * кнопка в Параметрах или расписание (`update-schedule.ts`); скачивание и
 * установка — только по команде пользователя. Целостность установщика проверяет сам electron-updater
 * по sha512 из latest.yml релиза; draft и pre-release не предлагаются.
 * На Mac программа без подписи Apple, и Squirrel.Mac её не обновит: там, как
 * у portable-версии, новая версия только находится, а ставится вручную со
 * страницы релиза.
 */
export class UpdateService {
  private cancellation: CancellationToken | null = null
  private available: UpdateInfo | null = null
  private downloaded = false
  private busy = false
  private readonly mac: boolean

  constructor(
    private readonly portable: boolean,
    onProgress: (progress: UpdateProgress) => void,
    platform: NodeJS.Platform = process.platform
  ) {
    this.mac = platform === 'darwin'
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = {
      info: (message: unknown) => {
        console.log(`[updater] ${String(message)}`)
      },
      warn: (message: unknown) => {
        console.warn(`[updater] ${String(message)}`)
      },
      error: (message: unknown) => {
        console.error(`[updater] ${String(message)}`)
      },
      debug: () => undefined
    }
    autoUpdater.on('download-progress', (info: ProgressInfo) => {
      onProgress({
        percent: Math.max(0, Math.min(100, Math.round(info.percent))),
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond
      })
    })
  }

  async check(): Promise<UpdateCheckResult> {
    if (!app.isPackaged) {
      throw new Error('Проверка обновлений работает только в собранной программе.')
    }
    if (this.busy) throw new Error('Обновление уже выполняется.')
    this.busy = true
    this.downloaded = false
    this.available = null
    try {
      const info = await this.waitForCheck()
      if (!info) return { status: 'none', current: app.getVersion() }
      this.available = info
      const file = info.files[0]
      return {
        status: 'available',
        canInstall: !this.portable && !this.mac,
        info: {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
          size: file?.size ?? null,
          page: `${RELEASES_PAGE}/tag/v${info.version}`
        }
      }
    } finally {
      this.busy = false
    }
  }

  /** Результат проверки берём из событий: `checkForUpdates` возвращает его не во всех версиях. */
  private waitForCheck(): Promise<UpdateInfo | null> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        autoUpdater.off('update-available', onAvailable)
        autoUpdater.off('update-not-available', onNone)
        autoUpdater.off('error', onError)
      }
      const onAvailable = (info: UpdateInfo): void => {
        cleanup()
        resolve(info)
      }
      const onNone = (): void => {
        cleanup()
        resolve(null)
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      autoUpdater.on('update-available', onAvailable)
      autoUpdater.on('update-not-available', onNone)
      autoUpdater.on('error', onError)
      autoUpdater.checkForUpdates().catch((error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  async download(): Promise<void> {
    // Предупреждение могло прийти из другого окна или после ручной проверки без новой версии.
    if (!this.available) await this.check()
    if (!this.available) throw new Error('Сначала проверьте обновления.')
    if (this.portable) throw new Error('Для portable-версии скачайте архив со страницы релиза.')
    if (this.mac) throw new Error('На Mac скачайте новую версию со страницы релиза.')
    if (this.busy) throw new Error('Обновление уже выполняется.')
    this.busy = true
    this.cancellation = new CancellationToken()
    try {
      await autoUpdater.downloadUpdate(this.cancellation)
      this.downloaded = true
    } finally {
      this.cancellation = null
      this.busy = false
    }
  }

  cancel(): void {
    this.cancellation?.cancel()
  }

  install(): void {
    if (!this.downloaded) throw new Error('Установщик ещё не скачан.')
    // Закрывает окна и запускает мастер установки; после установки программа запустится снова.
    autoUpdater.quitAndInstall(false, true)
  }

  static get repository(): string {
    return PROJECT_REPOSITORY
  }
}
