import { messageLanguage } from '@shared/messages'
import { isMac } from '@renderer/app/platform'
import { en, enMac } from './en'
import { applyOverrides } from './overrides'
import { ru, ruMac, type Strings } from './ru'

/**
 * Язык интерфейса окна. main задаёт его параметром `?lang=` адреса страницы
 * (из настроек); смена языка перезагружает окно, поэтому язык и словарь
 * выбираются один раз при загрузке модуля — их можно читать и в константах
 * уровня модуля.
 */
export const language = messageLanguage()

const base: Strings = language === 'en' ? en : ru

/** Активный набор строк; на Mac — с заменами для Mac (⌘, Finder). */
export const t: Strings = isMac ? applyOverrides(base, language === 'en' ? enMac : ruMac) : base

/** Локаль для Intl: даты, числа, размеры. */
export const locale = language === 'en' ? 'en-US' : 'ru-RU'

if (typeof document !== 'undefined') document.documentElement.lang = language
