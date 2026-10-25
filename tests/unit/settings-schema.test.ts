import { describe, expect, it } from 'vitest'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings,
  RECENT_LIMIT_MAX,
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
    expect(result.general).toEqual({ theme: 'dark', language: 'ru' })
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
