import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings,
  type AppSettings,
  type SettingsPatch
} from '@shared/settings-schema'

/**
 * Хранилище настроек: один JSON-файл в userData. Запись атомарная —
 * во временный файл и переименование, чтобы сбой питания не оставил
 * половину файла. Чтение терпимо к любому мусору: см. normalizeSettings.
 */
export class SettingsStore {
  private settings: AppSettings = createDefaultSettings()
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static forUserData(userDataPath: string): SettingsStore {
    return new SettingsStore(join(userDataPath, 'settings.json'))
  }

  get path(): string {
    return this.filePath
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.settings = normalizeSettings(JSON.parse(raw))
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn(
          `[settings] не удалось прочитать ${this.filePath}, используются значения по умолчанию:`,
          error
        )
      }
      this.settings = createDefaultSettings()
    }
    this.loaded = true
    return this.settings
  }

  get(): AppSettings {
    return this.settings
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    if (!this.loaded) await this.load()
    this.settings = applySettingsPatch(this.settings, patch)
    await this.persist()
    return this.settings
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.settings, null, 2) + '\n'
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => writeAtomic(this.filePath, snapshot))
    return this.writeQueue
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}
