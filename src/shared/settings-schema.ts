/**
 * Схема пользовательских настроек. Хранится как JSON в
 * `%APPDATA%\PDFwright\settings.json`. Валидация написана вручную, без
 * внешних зависимостей: неизвестные и битые значения заменяются значениями
 * по умолчанию, чтобы повреждённый файл никогда не ломал запуск.
 */

export const SETTINGS_SCHEMA_VERSION = 1

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const LANGUAGES = ['ru', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const ZOOM_MODES = ['fit-width', 'fit-page', 'actual'] as const
export type ZoomMode = (typeof ZOOM_MODES)[number]

export const SCROLL_MODES = ['continuous', 'single', 'spread'] as const
export type ScrollMode = (typeof SCROLL_MODES)[number]

export interface GeneralSettings {
  theme: Theme
  language: Language
}

export interface ViewerSettings {
  defaultZoom: ZoomMode
  scrollMode: ScrollMode
}

export interface FilesSettings {
  /** Создавать `*.bak` рядом с исходником перед перезаписью. */
  backupOnSave: boolean
  recentLimit: number
}

export interface WindowSettings {
  width: number
  height: number
  maximized: boolean
}

export interface AppSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION
  general: GeneralSettings
  viewer: ViewerSettings
  files: FilesSettings
  window: WindowSettings
}

/** Частичное обновление: любой раздел и любое поле можно опустить. */
export type SettingsPatch = {
  [Section in Exclude<keyof AppSettings, 'schemaVersion'>]?: Partial<AppSettings[Section]>
}

export const WINDOW_MIN_WIDTH = 900
export const WINDOW_MIN_HEIGHT = 600
export const RECENT_LIMIT_MAX = 50

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    general: { theme: 'system', language: 'ru' },
    viewer: { defaultZoom: 'fit-width', scrollMode: 'continuous' },
    files: { backupOnSave: false, recentLimit: 10 },
    window: { width: 1280, height: 800, maximized: false }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return rounded < min || rounded > max ? fallback : rounded
}

/**
 * Приводит произвольное содержимое файла настроек к валидной схеме.
 * Никогда не бросает исключений.
 */
export function normalizeSettings(input: unknown): AppSettings {
  const defaults = createDefaultSettings()
  if (!isRecord(input)) return defaults

  const general = isRecord(input.general) ? input.general : {}
  const viewer = isRecord(input.viewer) ? input.viewer : {}
  const files = isRecord(input.files) ? input.files : {}
  const window = isRecord(input.window) ? input.window : {}

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    general: {
      theme: pickEnum(general.theme, THEMES, defaults.general.theme),
      language: pickEnum(general.language, LANGUAGES, defaults.general.language)
    },
    viewer: {
      defaultZoom: pickEnum(viewer.defaultZoom, ZOOM_MODES, defaults.viewer.defaultZoom),
      scrollMode: pickEnum(viewer.scrollMode, SCROLL_MODES, defaults.viewer.scrollMode)
    },
    files: {
      backupOnSave: pickBoolean(files.backupOnSave, defaults.files.backupOnSave),
      recentLimit: pickInteger(files.recentLimit, defaults.files.recentLimit, 0, RECENT_LIMIT_MAX)
    },
    window: {
      width: pickInteger(window.width, defaults.window.width, WINDOW_MIN_WIDTH, 16_384),
      height: pickInteger(window.height, defaults.window.height, WINDOW_MIN_HEIGHT, 16_384),
      maximized: pickBoolean(window.maximized, defaults.window.maximized)
    }
  }
}

/** Накладывает patch на текущие настройки и повторно валидирует результат. */
export function applySettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  const merged: Record<string, unknown> = { schemaVersion: current.schemaVersion }
  for (const section of ['general', 'viewer', 'files', 'window'] as const) {
    const sectionPatch: object = isRecord(patch[section]) ? patch[section] : {}
    merged[section] = { ...current[section], ...sectionPatch }
  }
  return normalizeSettings(merged)
}
