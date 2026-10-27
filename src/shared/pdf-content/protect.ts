import { m } from '../messages'
import type { PDFDocument as MuDocument, PDFObject } from 'mupdf'
import { loadMupdf, type Mupdf } from './mupdf'
import { PdfContentError } from './types'

/**
 * Защита PDF паролем на MuPDF: шифрование AES-256 с паролем на открытие и
 * паролем владельца, расшифровка документа, открытого паролем, и возврат
 * исходного шифрования после правки расшифрованной копии.
 *
 * Программа правит расшифрованную копию документа (её понимают pdf-lib, MuPDF и
 * pdf.js), а шифрование возвращает при записи файла. Пароли передаются в
 * функции аргументами и нигде не сохраняются.
 */

export interface ProtectOptions {
  /** Пароль на открытие документа. */
  userPassword: string
  /** Пароль владельца; пустой — такой же, как пароль на открытие (ограничений нет). */
  ownerPassword: string
  /** Разрешить печать; действует, только если пароль владельца отличается. */
  allowPrint: boolean
  /** Разрешить копирование текста и картинок. */
  allowCopy: boolean
}

/** Какие права даёт введённый пароль: только открытие или права владельца. */
export type PasswordAccess = 'user' | 'owner'

export interface ProtectionInfo {
  /** Алгоритм шифрования: AES-256, AES-128, RC4-128, RC4-40. */
  method: string
  access: PasswordAccess
  /** Ограничения документа (флаги /P): разрешены ли печать и копирование. */
  canPrint: boolean
  canCopy: boolean
  /**
   * У документа отдельный пароль владельца: введённый пароль не даёт сразу и
   * права на открытие, и права владельца (как бывает, когда пароли совпадают).
   */
  separateOwner: boolean
}

/** Что запрещено в программе: ограничения действуют, пока не введён пароль владельца. */
export function restrictionsOf(info: ProtectionInfo | null): { print: boolean; copy: boolean } {
  if (!info || info.access === 'owner') return { print: false, copy: false }
  return { print: !info.canPrint, copy: !info.canCopy }
}

export interface UnlockResult {
  /** Расшифрованные байты; у незашифрованного документа — исходные. */
  bytes: Uint8Array
  /** null — документ не зашифрован. */
  info: ProtectionInfo | null
}

/** Флаги /P (ISO 32000, табл. 22): печать, печать высокого качества, копирование. */
const PERMISSION_PRINT = 1 << 2
const PERMISSION_PRINT_HQ = 1 << 11
const PERMISSION_COPY = 1 << 4
/** Все разрешения; биты 1–2 по стандарту нулевые. */
const PERMISSIONS_ALL = -4

/** Значение /P для выбранных ограничений (знаковое 32-битное, как в файле). */
export function permissionsValue(
  options: Pick<ProtectOptions, 'allowPrint' | 'allowCopy'>
): number {
  let value = PERMISSIONS_ALL
  if (!options.allowPrint) value &= ~(PERMISSION_PRINT | PERMISSION_PRINT_HQ)
  if (!options.allowCopy) value &= ~PERMISSION_COPY
  return value | 0
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openAny(mupdf: Mupdf, bytes: Uint8Array): MuDocument {
  try {
    return new mupdf.PDFDocument(bytes)
  } catch (error) {
    throw new PdfContentError(
      m({
        ru: `Не удалось разобрать PDF: ${errorText(error)}`,
        en: `Could not parse the PDF: ${errorText(error)}`
      })
    )
  }
}

function toBytes(doc: MuDocument, options: string | Record<string, string>): Uint8Array {
  // Объект параметров MuPDF получает как JSON: пароли могут содержать запятые.
  const buffer = doc.saveToBuffer(options)
  try {
    return buffer.asUint8Array().slice()
  } finally {
    buffer.destroy()
  }
}

function encryptDictionary(doc: MuDocument): PDFObject | null {
  const encrypt = doc.getTrailer().get('Encrypt')
  if (encrypt.isNull()) return null
  const dict = encrypt.resolve()
  return dict.isDictionary() ? dict : null
}

function numberOf(dict: PDFObject, key: string, fallback: number): number {
  const value = dict.get(key)
  return value.isNumber() ? value.asNumber() : fallback
}

function methodOf(dict: PDFObject): string {
  const version = numberOf(dict, 'V', 0)
  if (version >= 5) return 'AES-256'
  if (version === 4) {
    const filter = dict.get('CF', 'StdCF', 'CFM')
    return filter.isName() && filter.asName() === 'AESV2' ? 'AES-128' : 'RC4-128'
  }
  return numberOf(dict, 'Length', 40) > 40 ? 'RC4-128' : 'RC4-40'
}

function wrongPassword(): PdfContentError {
  return new PdfContentError(m({ ru: 'Неверный пароль.', en: 'Wrong password.' }))
}

/**
 * Проверяет пароль и сообщает о защите документа. Пароль владельца даёт права
 * владельца; у документа без пароля на открытие подходит пустой пароль.
 */
function authenticate(doc: MuDocument, password: string): ProtectionInfo | null {
  const dict = encryptDictionary(doc)
  if (!dict) return null
  // Биты результата: 2 — пароль на открытие, 4 — пароль владельца.
  const result = doc.authenticatePassword(password)
  if ((result & 6) === 0) throw wrongPassword()
  const permissions = numberOf(dict, 'P', PERMISSIONS_ALL)
  return {
    method: methodOf(dict),
    access: (result & 4) !== 0 ? 'owner' : 'user',
    canPrint: (permissions & PERMISSION_PRINT) !== 0,
    canCopy: (permissions & PERMISSION_COPY) !== 0,
    separateOwner: (result & 6) !== 6
  }
}

/**
 * Шифрует незашифрованный документ AES-256. Без отдельного пароля владельца
 * он совпадает с паролем на открытие, и ограничения не записываются.
 */
export async function protectPdf(bytes: Uint8Array, options: ProtectOptions): Promise<Uint8Array> {
  if (options.userPassword === '') {
    throw new PdfContentError(
      m({ ru: 'Пароль на открытие не задан.', en: 'The open password is empty.' })
    )
  }
  const mupdf = await loadMupdf()
  const doc = openAny(mupdf, bytes)
  try {
    if (encryptDictionary(doc)) {
      throw new PdfContentError(
        m({
          ru: 'Документ уже зашифрован: сначала снимите прежнюю защиту.',
          en: 'The document is already encrypted: remove the previous protection first.'
        })
      )
    }
    const owner = options.ownerPassword === '' ? options.userPassword : options.ownerPassword
    const restricted = owner !== options.userPassword
    try {
      return toBytes(doc, {
        encrypt: 'aes-256',
        'user-password': options.userPassword,
        'owner-password': owner,
        permissions: String(restricted ? permissionsValue(options) : PERMISSIONS_ALL),
        garbage: 'yes',
        compress: 'yes'
      })
    } catch {
      // Текст ошибки MuPDF может повторять параметры записи, а в них пароли.
      throw new PdfContentError(
        m({ ru: 'Не удалось зашифровать документ.', en: 'Could not encrypt the document.' })
      )
    }
  } finally {
    doc.destroy()
  }
}

/** Сведения о защите документа для пароля или null, если документ не зашифрован. */
export async function inspectProtection(
  bytes: Uint8Array,
  password: string
): Promise<ProtectionInfo | null> {
  const mupdf = await loadMupdf()
  const doc = openAny(mupdf, bytes)
  try {
    return authenticate(doc, password)
  } finally {
    doc.destroy()
  }
}

/**
 * Расшифровывает документ паролем. Номера объектов не меняются, поэтому ссылки
 * pdf.js на поля и аннотации расшифрованной копии те же, что у файла.
 */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  const mupdf = await loadMupdf()
  const doc = openAny(mupdf, bytes)
  try {
    const info = authenticate(doc, password)
    if (!info) return { bytes, info: null }
    return { bytes: toBytes(doc, 'encrypt=none'), info }
  } finally {
    doc.destroy()
  }
}

/** Служебные потоки файла: их собирает запись, переносить их не нужно. */
function isStructural(value: PDFObject): boolean {
  const type = value.get('Type')
  return type.isName() && (type.asName() === 'ObjStm' || type.asName() === 'XRef')
}

/**
 * Возвращает правленой расшифрованной копии исходное шифрование: объекты копии
 * переносятся под теми же номерами в исходный документ, открытый паролем, и он
 * записывается с прежним ключом. Так сохраняются оба пароля и ограничения, даже
 * если известен только один из паролей.
 */
export async function relockPdf(
  original: Uint8Array,
  password: string,
  edited: Uint8Array
): Promise<Uint8Array> {
  const mupdf = await loadMupdf()
  const target = openAny(mupdf, original)
  try {
    if (!authenticate(target, password)) {
      throw new PdfContentError(
        m({ ru: 'Исходный документ не зашифрован.', en: 'The original document is not encrypted.' })
      )
    }
    const source = openAny(mupdf, edited)
    try {
      if (encryptDictionary(source)) {
        throw new PdfContentError(
          m({ ru: 'Правленая копия зашифрована.', en: 'The edited copy is encrypted.' })
        )
      }
      transplant(source, target)
    } finally {
      source.destroy()
    }
    const bytes = toBytes(target, 'garbage=compact,compress')
    const check = openAny(mupdf, bytes)
    try {
      if (!authenticate(check, password)) throw wrongPassword()
    } finally {
      check.destroy()
    }
    return bytes
  } finally {
    target.destroy()
  }
}

/** Переносит все объекты source в target под теми же номерами; словарь шифрования target остаётся. */
function transplant(source: MuDocument, target: MuDocument): void {
  const count = source.countObjects()
  while (target.countObjects() < count) target.createObject()
  const encrypt = target.getTrailer().get('Encrypt')
  const encryptNum = encrypt.isIndirect() ? encrypt.asIndirect() : -1
  // Объект копии с номером словаря шифрования переезжает на новый номер.
  const moved =
    encryptNum > 0 && encryptNum < count && !source.newIndirect(encryptNum).resolve().isNull()
      ? target.createObject().asIndirect()
      : -1
  const numOf = (num: number): number => (num === encryptNum && moved > 0 ? moved : num)

  const copy = (value: PDFObject): PDFObject => {
    if (value.isIndirect()) return target.newIndirect(numOf(value.asIndirect()))
    if (value.isDictionary()) {
      const dict = target.newDictionary()
      value.forEach((item, key) => {
        dict.put(key, copy(item))
      })
      return dict
    }
    if (value.isArray()) {
      const array = target.newArray()
      value.forEach((item) => {
        array.push(copy(item))
      })
      return array
    }
    if (value.isName()) return target.newName(value.asName())
    if (value.isString()) return target.newByteString(value.asByteString())
    if (value.isBoolean()) return target.newBoolean(value.asBoolean())
    if (value.isInteger()) return target.newInteger(value.asNumber())
    if (value.isReal()) return target.newReal(value.asNumber())
    return target.newNull()
  }

  // Объекты документа читаются заранее: потоки объектов, в которых они лежат,
  // могут быть перезаписаны раньше них.
  for (let num = 1; num < target.countObjects(); num += 1) target.newIndirect(num).resolve()

  for (let num = 1; num < count; num += 1) {
    const ref = source.newIndirect(num)
    const value = ref.resolve()
    // Свободный номер копии пропускается: прежний объект документа, на который
    // больше никто не ссылается, выбросит сборка мусора при записи.
    if (value.isNull() || (ref.isStream() && isStructural(value))) continue
    const to = numOf(num)
    // Поток на месте не-потока (и наоборот) записывается в чистый номер.
    if (target.newIndirect(to).isStream() !== ref.isStream()) target.deleteObject(to)
    target.newIndirect(to).writeObject(copy(value))
    if (ref.isStream()) {
      const raw = ref.readRawStream()
      try {
        target.newIndirect(to).writeRawStream(raw)
      } finally {
        raw.destroy()
      }
    }
  }

  const trailer = target.getTrailer()
  const sourceTrailer = source.getTrailer()
  for (const key of ['Root', 'Info']) {
    const value = sourceTrailer.get(key)
    if (value.isIndirect()) trailer.put(key, target.newIndirect(numOf(value.asIndirect())))
    else if (value.isNull()) trailer.delete(key)
    else trailer.put(key, target.addObject(copy(value)))
  }
}
