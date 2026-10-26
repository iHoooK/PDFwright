import * as mupdf from 'mupdf'
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  extractText,
  listPageObjects,
  PdfContentError,
  replaceText,
  type PageTextLine
} from '@shared/pdf-content'
import {
  inspectProtection,
  permissionsValue,
  protectPdf,
  relockPdf,
  unlockPdf
} from '@shared/pdf-content/protect'

/** Двухстраничный документ с текстом, закладкой-ссылкой и метаданными. */
async function makePlain(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of ['Hello protected world', 'Second page text']) {
    doc.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 14, font })
  }
  doc.setTitle('Secret report')
  return doc.save()
}

/** Сколько прав даёт пароль: 0 — не подходит, 2 — открытие, 4 — владелец. */
function access(bytes: Uint8Array, password: string): number {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    return doc.authenticatePassword(password)
  } finally {
    doc.destroy()
  }
}

function needsPassword(bytes: Uint8Array): boolean {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    return doc.needsPassword()
  } finally {
    doc.destroy()
  }
}

/** Зашифрованный MuPDF-файл с потоками объектов, как у чужих программ. */
function encryptWithMupdf(bytes: Uint8Array, options: Record<string, string>): Uint8Array {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    const buffer = doc.saveToBuffer({ ...options, garbage: 'yes', objstms: 'yes', compress: 'yes' })
    try {
      return buffer.asUint8Array().slice()
    } finally {
      buffer.destroy()
    }
  } finally {
    doc.destroy()
  }
}

let plain: Uint8Array

beforeAll(async () => {
  plain = await makePlain()
})

describe('protectPdf и unlockPdf', () => {
  it('файл открывается только с паролем, после снятия защиты — без него', async () => {
    const locked = await protectPdf(plain, {
      userPassword: 'open-1',
      ownerPassword: '',
      allowPrint: true,
      allowCopy: true
    })
    expect(needsPassword(locked)).toBe(true)
    expect(access(locked, 'wrong')).toBe(0)
    // Без пароля владельца он равен паролю на открытие: права полные.
    expect(access(locked, 'open-1') & 4).toBe(4)
    await expect(PDFDocument.load(locked)).rejects.toThrow(/encrypt/i)

    const unlocked = await unlockPdf(locked, 'open-1')
    expect(unlocked.info).toEqual({
      method: 'AES-256',
      access: 'owner',
      canPrint: true,
      canCopy: true
    })
    expect(needsPassword(unlocked.bytes)).toBe(false)
    expect(new TextDecoder('latin1').decode(unlocked.bytes)).not.toContain('/Encrypt')
    expect(await extractText(unlocked.bytes)).toEqual(['Hello protected world', 'Second page text'])
    const reloaded = await PDFDocument.load(unlocked.bytes)
    expect(reloaded.getTitle()).toBe('Secret report')
  })

  it('неверный пароль — понятная ошибка', async () => {
    const locked = await protectPdf(plain, {
      userPassword: 'right',
      ownerPassword: '',
      allowPrint: true,
      allowCopy: true
    })
    await expect(unlockPdf(locked, 'left')).rejects.toThrow(PdfContentError)
    await expect(unlockPdf(locked, 'left')).rejects.toThrow('Неверный пароль.')
  })

  it('незашифрованный документ возвращается как есть', async () => {
    const result = await unlockPdf(plain, '')
    expect(result.info).toBeNull()
    expect(result.bytes).toBe(plain)
    expect(await inspectProtection(plain, '')).toBeNull()
  })

  it('пароль владельца с запретом печати и копирования', async () => {
    const locked = await protectPdf(plain, {
      userPassword: 'reader',
      ownerPassword: 'boss',
      allowPrint: false,
      allowCopy: false
    })
    expect(access(locked, 'reader')).toBe(2)
    expect(access(locked, 'boss')).toBe(4)
    expect(await inspectProtection(locked, 'reader')).toEqual({
      method: 'AES-256',
      access: 'user',
      canPrint: false,
      canCopy: false
    })
    const owner = await inspectProtection(locked, 'boss')
    expect(owner?.access).toBe('owner')
    // Пароль владельца тоже открывает документ.
    expect((await unlockPdf(locked, 'boss')).info?.access).toBe('owner')
  })

  it('пароли с запятыми, знаком равенства и кириллицей', async () => {
    const locked = await protectPdf(plain, {
      userPassword: 'Пароль, с=знаками',
      ownerPassword: 'вла,делец',
      allowPrint: true,
      allowCopy: false
    })
    expect(access(locked, 'Пароль, с=знаками')).toBe(2)
    expect(access(locked, 'вла,делец')).toBe(4)
    expect(access(locked, 'Пароль')).toBe(0)
    const info = await inspectProtection(locked, 'Пароль, с=знаками')
    expect(info?.canPrint).toBe(true)
    expect(info?.canCopy).toBe(false)
  })

  it('пустой пароль на открытие и повторное шифрование отклоняются', async () => {
    await expect(
      protectPdf(plain, { userPassword: '', ownerPassword: 'x', allowPrint: true, allowCopy: true })
    ).rejects.toThrow(PdfContentError)
    const locked = await protectPdf(plain, {
      userPassword: 'a',
      ownerPassword: '',
      allowPrint: true,
      allowCopy: true
    })
    await expect(
      protectPdf(locked, {
        userPassword: 'b',
        ownerPassword: '',
        allowPrint: true,
        allowCopy: true
      })
    ).rejects.toThrow(/уже зашифрован/)
  })

  it('значение /P для ограничений', () => {
    expect(permissionsValue({ allowPrint: true, allowCopy: true })).toBe(-4)
    const noPrint = permissionsValue({ allowPrint: false, allowCopy: true })
    expect(noPrint & 4).toBe(0)
    expect(noPrint & 2048).toBe(0)
    expect(noPrint & 16).toBe(16)
    const noCopy = permissionsValue({ allowPrint: true, allowCopy: false })
    expect(noCopy & 16).toBe(0)
    expect(noCopy & 4).toBe(4)
  })
})

describe('relockPdf: правка расшифрованной копии с прежним шифрованием', () => {
  async function lineOf(bytes: Uint8Array, text: string): Promise<PageTextLine> {
    const objects = await listPageObjects(bytes, 0)
    const line = objects.lines.find((l) => l.text === text)
    if (!line) throw new Error(`строка «${text}» не найдена`)
    return line
  }

  it('после правки MuPDF оба пароля и ограничения те же', async () => {
    const locked = await protectPdf(plain, {
      userPassword: 'reader',
      ownerPassword: 'boss',
      allowPrint: false,
      allowCopy: true
    })
    // Известен только пароль на открытие: пароль владельца должен уцелеть.
    const { bytes: copy } = await unlockPdf(locked, 'reader')
    const edited = await replaceText(
      copy,
      0,
      await lineOf(copy, 'Hello protected world'),
      'Edited text'
    )
    const relocked = await relockPdf(locked, 'reader', edited)

    expect(needsPassword(relocked)).toBe(true)
    expect(access(relocked, 'reader')).toBe(2)
    expect(access(relocked, 'boss')).toBe(4)
    expect(access(relocked, 'other')).toBe(0)
    const info = await inspectProtection(relocked, 'reader')
    expect(info).toMatchObject({ method: 'AES-256', canPrint: false, canCopy: true })
    const { bytes: check } = await unlockPdf(relocked, 'boss')
    expect(await extractText(check)).toEqual(['Edited text', 'Second page text'])
    expect((await PDFDocument.load(check)).getTitle()).toBe('Secret report')
  })

  it('после операций pdf-lib (поворот, новая страница, потоки объектов)', async () => {
    const locked = encryptWithMupdf(plain, {
      encrypt: 'aes-128',
      'user-password': 'u',
      'owner-password': 'o',
      permissions: '-4'
    })
    const { bytes: copy, info } = await unlockPdf(locked, 'o')
    expect(info?.method).toBe('AES-128')
    const doc = await PDFDocument.load(copy)
    doc.getPage(1).setRotation(degrees(90))
    doc.addPage([100, 100])
    const edited = await doc.save()

    const relocked = await relockPdf(locked, 'o', edited)
    expect(access(relocked, 'u')).toBe(2)
    expect(access(relocked, 'o')).toBe(4)
    expect((await inspectProtection(relocked, 'u'))?.method).toBe('AES-128')
    const { bytes: check } = await unlockPdf(relocked, 'u')
    const result = await PDFDocument.load(check)
    expect(result.getPageCount()).toBe(3)
    expect(result.getPage(1).getRotation().angle).toBe(90)
    expect((await extractText(check))[0]).toBe('Hello protected world')
  })

  it('неверный пароль и зашифрованная копия отклоняются', async () => {
    const locked = await protectPdf(plain, {
      userPassword: 'p',
      ownerPassword: '',
      allowPrint: true,
      allowCopy: true
    })
    const { bytes: copy } = await unlockPdf(locked, 'p')
    await expect(relockPdf(locked, 'q', copy)).rejects.toThrow('Неверный пароль.')
    await expect(relockPdf(locked, 'p', locked)).rejects.toThrow(PdfContentError)
    await expect(relockPdf(plain, '', copy)).rejects.toThrow(PdfContentError)
  })
})
