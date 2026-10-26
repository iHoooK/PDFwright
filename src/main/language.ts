import { app } from 'electron'
import { resolveLanguage, type InterfaceLanguage } from '@shared/settings-schema'
import type { SettingsStore } from './services/settings-store'

/** Язык окон и меню: из настроек, а «как в системе» — по языку Windows (app.getLocale()). */
export function interfaceLanguage(settings: SettingsStore): InterfaceLanguage {
  return resolveLanguage(settings.get().general.language, app.getLocale())
}
