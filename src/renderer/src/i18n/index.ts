import { messageLanguage } from '@shared/messages'
import { en } from './en'
import { ru, type Strings } from './ru'

/**
 * Язык интерфейса окна. main задаёт его параметром `?lang=` адреса страницы
 * (из настроек); смена языка перезагружает окно, поэтому язык и словарь
 * выбираются один раз при загрузке модуля — их можно читать и в константах
 * уровня модуля.
 */
export const language = messageLanguage()

/** Активный набор строк. */
export const t: Strings = language === 'en' ? en : ru

/** Локаль для Intl: даты, числа, размеры. */
export const locale = language === 'en' ? 'en-US' : 'ru-RU'

if (typeof document !== 'undefined') document.documentElement.lang = language
