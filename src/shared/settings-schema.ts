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

export const MARKUP_SAVE_MODES = ['annotation', 'content'] as const
/** annotation — PDF-аннотации, content — впечатать разметку в содержимое страницы. */
export type MarkupSaveMode = (typeof MARKUP_SAVE_MODES)[number]

export const SIGNATURES_MAX = 8
/** Предел длины data URL одной подписи (около 1 МБ картинки). */
export const SIGNATURE_MAX_LENGTH = 1_500_000

export interface SavedSignature {
  id: string
  /** PNG как data URL: нарисованная подпись или загруженный файл. */
  src: string
}

export interface MarkupSettings {
  saveMode: MarkupSaveMode
  signatures: SavedSignature[]
}

export interface WindowSettings {
  width: number
  height: number
  maximized: boolean
}

export const SESSION_WINDOWS_MAX = 8
export const SESSION_TABS_MAX = 50
export const SESSION_PATH_MAX = 4096

/** Окно прошлого сеанса: рамка и открытые вкладки. */
export interface SessionWindow {
  /** Положение окна; null — окно ставит система. */
  x: number | null
  y: number | null
  width: number
  height: number
  maximized: boolean
  /** Пути открытых документов по порядку вкладок. */
  tabs: string[]
  /** Номер активной вкладки в tabs. */
  active: number
}

export interface SessionSettings {
  /** Открывать окна и вкладки прошлого сеанса при запуске без файла. */
  restore: boolean
  windows: SessionWindow[]
}

export interface AppSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION
  general: GeneralSettings
  viewer: ViewerSettings
  files: FilesSettings
  markup: MarkupSettings
  window: WindowSettings
  session: SessionSettings
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
    markup: { saveMode: 'annotation', signatures: [] },
    window: { width: 1280, height: 800, maximized: false },
    session: { restore: true, windows: [] }
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

function pickSignatures(value: unknown): SavedSignature[] {
  if (!Array.isArray(value)) return []
  const result: SavedSignature[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const { id, src } = item
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) continue
    if (typeof src !== 'string' || src.length > SIGNATURE_MAX_LENGTH) continue
    if (!src.startsWith('data:image/png;base64,')) continue
    if (result.some((s) => s.id === id)) continue
    result.push({ id, src })
    if (result.length === SIGNATURES_MAX) break
  }
  return result
}

function pickCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000
    ? Math.round(value)
    : null
}

function isSessionPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SESSION_PATH_MAX &&
    !value.includes('\0')
  )
}

/**
 * Окна прошлого сеанса из файла настроек: битые поля чинятся, окна без
 * вкладок и повторы путей отбрасываются. Файл, открытый в одном окне, во
 * втором уже не восстанавливается.
 */
export function normalizeSessionWindows(value: unknown): SessionWindow[] {
  if (!Array.isArray(value)) return []
  const defaults = createDefaultSettings().window
  const seen = new Set<string>()
  const result: SessionWindow[] = []
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.tabs)) continue
    const rawTabs: unknown[] = item.tabs
    const tabs: string[] = []
    const rawActive = rawTabs[pickInteger(item.active, 0, 0, rawTabs.length - 1)]
    let active = 0
    for (const tab of rawTabs) {
      if (!isSessionPath(tab) || seen.has(tab.toLowerCase())) continue
      seen.add(tab.toLowerCase())
      if (tab === rawActive) active = tabs.length
      tabs.push(tab)
      if (tabs.length === SESSION_TABS_MAX) break
    }
    if (tabs.length === 0) continue
    const x = pickCoordinate(item.x)
    const y = pickCoordinate(item.y)
    result.push({
      x: y === null ? null : x,
      y: x === null ? null : y,
      width: pickInteger(item.width, defaults.width, WINDOW_MIN_WIDTH, 16_384),
      height: pickInteger(item.height, defaults.height, WINDOW_MIN_HEIGHT, 16_384),
      maximized: pickBoolean(item.maximized, false),
      tabs,
      active
    })
    if (result.length === SESSION_WINDOWS_MAX) break
  }
  return result
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
  const markup = isRecord(input.markup) ? input.markup : {}
  const window = isRecord(input.window) ? input.window : {}
  const session = isRecord(input.session) ? input.session : {}

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
    markup: {
      saveMode: pickEnum(markup.saveMode, MARKUP_SAVE_MODES, defaults.markup.saveMode),
      signatures: pickSignatures(markup.signatures)
    },
    window: {
      width: pickInteger(window.width, defaults.window.width, WINDOW_MIN_WIDTH, 16_384),
      height: pickInteger(window.height, defaults.window.height, WINDOW_MIN_HEIGHT, 16_384),
      maximized: pickBoolean(window.maximized, defaults.window.maximized)
    },
    session: {
      restore: pickBoolean(session.restore, defaults.session.restore),
      windows: normalizeSessionWindows(session.windows)
    }
  }
}

/** Накладывает patch на текущие настройки и повторно валидирует результат. */
export function applySettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  const merged: Record<string, unknown> = { schemaVersion: current.schemaVersion }
  for (const section of ['general', 'viewer', 'files', 'markup', 'window', 'session'] as const) {
    const sectionPatch: object = isRecord(patch[section]) ? patch[section] : {}
    merged[section] = { ...current[section], ...sectionPatch }
  }
  return normalizeSettings(merged)
}
