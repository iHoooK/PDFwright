import { describe, expect, it } from 'vitest'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSessionWindows,
  normalizeSettings,
  RECENT_LIMIT_MAX,
  resolveLanguage,
  SESSION_TABS_MAX,
  SESSION_WINDOWS_MAX,
  SETTINGS_SCHEMA_VERSION,
  SIGNATURE_MAX_LENGTH,
  SIGNATURES_MAX,
  WINDOW_MIN_WIDTH
} from '@shared/settings-schema'

describe('normalizeSettings', () => {
  it('возвращает значения по умолчанию для любого мусора', () => {
    const defaults = createDefaultSettings()
    for (const garbage of [null, undefined, 42, 'text', [], {}, { general: 'no' }]) {
      expect(normalizeSettings(garbage)).toEqual(defaults)
    }
  })

  it('сохраняет валидные значения и чинит невалидные по отдельности', () => {
    const result = normalizeSettings({
      schemaVersion: 99,
      general: { theme: 'dark', language: 'xx' },
      viewer: { defaultZoom: 'fit-page', scrollMode: 7 },
      files: { backupOnSave: true, recentLimit: RECENT_LIMIT_MAX + 1 },
      window: { width: WINDOW_MIN_WIDTH - 1, height: 1000.4, maximized: 'yes' }
    })

    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(result.general).toEqual({ theme: 'dark', language: 'system' })
    expect(result.viewer).toEqual({ defaultZoom: 'fit-page', scrollMode: 'continuous' })
    expect(result.files).toEqual({ backupOnSave: true, recentLimit: 10 })
    expect(result.window).toEqual({ width: 1280, height: 1000, maximized: false })
  })

  it('оставляет только корректные подписи PNG и не больше лимита', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const result = normalizeSettings({
      markup: {
        saveMode: 'content',
        signatures: [
          { id: 'a', src: png },
          { id: 'a', src: png },
          { id: 'b', src: 'data:image/jpeg;base64,/9j/' },
          { id: 'c', src: 'data:image/png;base64,' + 'A'.repeat(SIGNATURE_MAX_LENGTH) },
          'мусор',
          ...Array.from({ length: SIGNATURES_MAX + 2 }, (_, i) => ({ id: `s${i}`, src: png }))
        ]
      }
    })
    expect(result.markup.saveMode).toBe('content')
    expect(result.markup.signatures).toHaveLength(SIGNATURES_MAX)
    expect(result.markup.signatures[0]).toEqual({ id: 'a', src: png })
    expect(result.markup.signatures.some((s) => s.id === 'b' || s.id === 'c')).toBe(false)
    expect(normalizeSettings({ markup: { saveMode: 'flat' } }).markup.saveMode).toBe('annotation')
  })

  it('не бросает исключений на NaN и Infinity', () => {
    expect(() => normalizeSettings({ window: { width: NaN, height: Infinity } })).not.toThrow()
  })
})

describe('applySettingsPatch', () => {
  it('меняет только указанные поля и валидирует результат', () => {
    const current = createDefaultSettings()
    const next = applySettingsPatch(current, {
      general: { theme: 'light' },
      files: { recentLimit: -5 }
    })

    expect(next.general.theme).toBe('light')
    expect(next.general.language).toBe(current.general.language)
    expect(next.files.recentLimit).toBe(current.files.recentLimit)
    expect(next.viewer).toEqual(current.viewer)
  })

  it('не мутирует исходный объект', () => {
    const current = createDefaultSettings()
    const copy = structuredClone(current)
    applySettingsPatch(current, { window: { maximized: true } })
    expect(current).toEqual(copy)
  })
})

describe('сеанс в настройках', () => {
  it('старый файл настроек без раздела session получает безопасные значения', () => {
    const result = normalizeSettings({ general: { theme: 'dark' }, window: { width: 1200 } })
    expect(result.session).toEqual({ restore: true, windows: [] })
    expect(normalizeSettings({ session: 'мусор' }).session).toEqual({ restore: true, windows: [] })
  })

  it('чинит окна сеанса: повторы путей, активная вкладка, рамка, пустые окна', () => {
    const windows = normalizeSessionWindows([
      { x: 100, y: 50, width: 1200.6, height: 800, maximized: true, tabs: ['C:/a.pdf'], active: 0 },
      {
        x: 'левый',
        y: 50,
        width: 10,
        height: 'высокий',
        tabs: ['C:/b.pdf', 42, 'C:/A.PDF', '', 'C:/c.pdf'],
        active: 4
      },
      { tabs: [] },
      { tabs: 'C:/d.pdf' },
      null
    ])
    expect(windows).toEqual([
      {
        x: 100,
        y: 50,
        width: 1201,
        height: 800,
        maximized: true,
        tabs: ['C:/a.pdf'],
        active: 0
      },
      {
        x: null,
        y: null,
        width: 1280,
        height: 800,
        maximized: false,
        tabs: ['C:/b.pdf', 'C:/c.pdf'],
        active: 1
      }
    ])
  })

  it('ограничивает число окон и вкладок, неверный номер вкладки — первая', () => {
    const many = Array.from({ length: SESSION_WINDOWS_MAX + 3 }, (_, i) => ({
      tabs: [`C:/w${i}.pdf`],
      active: 7
    }))
    const windows = normalizeSessionWindows(many)
    expect(windows).toHaveLength(SESSION_WINDOWS_MAX)
    expect(windows[0]?.active).toBe(0)
    const tabs = Array.from({ length: SESSION_TABS_MAX + 5 }, (_, i) => `C:/t${i}.pdf`)
    expect(normalizeSessionWindows([{ tabs }])[0]?.tabs).toHaveLength(SESSION_TABS_MAX)
  })

  it('patch переключателя не стирает окна сеанса', () => {
    const current = normalizeSettings({ session: { windows: [{ tabs: ['C:/a.pdf'] }] } })
    const next = applySettingsPatch(current, { session: { restore: false } })
    expect(next.session.restore).toBe(false)
    expect(next.session.windows).toHaveLength(1)
  })
})

describe('язык «как в системе»', () => {
  it('по умолчанию у новых установок, выбранный язык прежних настроек не меняется', () => {
    expect(createDefaultSettings().general.language).toBe('system')
    expect(normalizeSettings({}).general.language).toBe('system')
    expect(normalizeSettings({ general: { language: 'ru' } }).general.language).toBe('ru')
    expect(normalizeSettings({ general: { language: 'en' } }).general.language).toBe('en')
    expect(normalizeSettings({ general: { language: 'system' } }).general.language).toBe('system')
  })

  it('русский для русской локали системы, иначе английский', () => {
    for (const locale of ['ru', 'ru-RU', 'RU', 'ru_UA', ' ru-by ']) {
      expect(resolveLanguage('system', locale)).toBe('ru')
    }
    for (const locale of ['en-US', 'en', 'de-DE', 'uk-UA', 'be', '', 'kru']) {
      expect(resolveLanguage('system', locale)).toBe('en')
    }
  })

  it('явно выбранный язык не зависит от системы', () => {
    expect(resolveLanguage('ru', 'en-US')).toBe('ru')
    expect(resolveLanguage('en', 'ru-RU')).toBe('en')
  })
})
