import type { UpdateAvailable, UpdateCheckResult } from '@shared/ipc-contract'

/** Первая проверка — вскоре после запуска, чтобы не мешать открытию документов. */
export const UPDATE_CHECK_DELAY = 10_000
/** Повторная проверка, если программа долго не закрывается. */
export const UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000

export interface UpdateScheduleOptions {
  /** Включена ли проверка сейчас: настройка и собранная программа. */
  enabled: () => boolean
  check: () => Promise<UpdateCheckResult>
  /** Новая версия найдена: окна показывают предупреждение. */
  notify: (update: UpdateAvailable) => void
  setTimeout?: (run: () => void, ms: number) => unknown
  setInterval?: (run: () => void, ms: number) => unknown
}

/**
 * Автоматическая проверка обновлений: при запуске и раз в 12 часов. Ошибки
 * (нет сети, GitHub недоступен, идёт ручная проверка) не показываются —
 * следующая попытка будет по расписанию. Найденная версия запоминается,
 * чтобы окно, открытое позже, тоже предупредило о ней.
 */
export class UpdateSchedule {
  private found: UpdateAvailable | null = null

  constructor(private readonly options: UpdateScheduleOptions) {}

  start(): void {
    const later = this.options.setTimeout ?? setTimeout
    const every = this.options.setInterval ?? setInterval
    later(() => void this.run(), UPDATE_CHECK_DELAY)
    every(() => void this.run(), UPDATE_CHECK_INTERVAL)
  }

  async run(): Promise<void> {
    if (!this.options.enabled()) return
    let result: UpdateCheckResult
    try {
      result = await this.options.check()
    } catch {
      return
    }
    if (result.status === 'none') {
      this.found = null
      return
    }
    const update = { info: result.info, canInstall: result.canInstall }
    const known = this.found?.info.version === update.info.version
    this.found = update
    if (!known) this.options.notify(update)
  }

  /** Версия, найденная последней проверкой, или null. */
  get pending(): UpdateAvailable | null {
    return this.found
  }
}
