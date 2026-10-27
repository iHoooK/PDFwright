import type { ProtectionInfo, ProtectOptions } from '@shared/pdf-content/protect'

/**
 * Логика формы «Защита паролем» без интерфейса. Смена пароля на открытие не
 * трогает пароль владельца и запреты: пустое поле нового пароля владельца
 * оставляет прежний (известный по входу паролем владельца или введённый для
 * подтверждения) вместе с запретами печати и копирования.
 */

/** Защита вкладки: только то, что нужно форме. */
export type ProtectionState =
  | { kind: 'file'; password: string; info: ProtectionInfo }
  | { kind: 'new'; options: ProtectOptions }
  | null

export interface ProtectInput {
  /** Новый пароль на открытие. */
  user: string
  /** Новый пароль владельца; пусто — оставить прежний. */
  owner: string
  /** Текущий пароль владельца (документ открыт паролем на открытие). */
  current: string
  allowPrint: boolean
  allowCopy: boolean
}

/** Прежний пароль владельца, который сохраняется при пустом поле нового. */
export function keptOwnerPassword(protection: ProtectionState, current: string): string {
  if (!protection) return ''
  if (protection.kind === 'new') {
    const { userPassword, ownerPassword } = protection.options
    return ownerPassword !== userPassword ? ownerPassword : ''
  }
  if (!protection.info.separateOwner) return ''
  return protection.info.access === 'owner' ? protection.password : current
}

/** Переключатели печати и копирования при открытии формы: как сейчас у документа. */
export function initialPermissions(protection: ProtectionState): {
  allowPrint: boolean
  allowCopy: boolean
} {
  if (!protection) return { allowPrint: true, allowCopy: true }
  if (protection.kind === 'new') {
    return { allowPrint: protection.options.allowPrint, allowCopy: protection.options.allowCopy }
  }
  return { allowPrint: protection.info.canPrint, allowCopy: protection.info.canCopy }
}

function ownerOf(protection: ProtectionState, input: ProtectInput): string {
  return input.owner !== '' ? input.owner : keptOwnerPassword(protection, input.current)
}

/** Действуют ли запреты: пароль владельца есть и отличается от пароля на открытие. */
export function isRestricted(protection: ProtectionState, input: ProtectInput): boolean {
  const owner = ownerOf(protection, input)
  return owner !== '' && owner !== input.user
}

/** Параметры шифрования для записи файла. */
export function protectOptions(protection: ProtectionState, input: ProtectInput): ProtectOptions {
  const restricted = isRestricted(protection, input)
  return {
    userPassword: input.user,
    ownerPassword: restricted ? ownerOf(protection, input) : '',
    allowPrint: restricted ? input.allowPrint : true,
    allowCopy: restricted ? input.allowCopy : true
  }
}
