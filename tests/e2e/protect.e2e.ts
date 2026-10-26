/// <reference lib="dom" />
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as mupdf from 'mupdf'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { _electron as electron, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { inspectProtection } from '../../src/shared/pdf-content/protect'
import { clickMenuItem, ctx, launch, ROOT, shot, statusText, useElectronApp } from './helpers'

/** Фаза 16: пароль на документ — установка, правка защищённого файла, снятие. */
useElectronApp()

const OPEN = 'Секрет-1'
const OWNER = 'Владелец, 2'

async function protectedSample(name: string): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of ['Protected page one', 'Protected page two']) {
    doc.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 24, font })
  }
  doc.setTitle('Before')
  const target = join(ctx.work, name)
  await writeFile(target, await doc.save())
  return target
}

/** Права пароля по MuPDF: 0 — не подходит, 2 — открытие, 4 — владелец. */
async function access(path: string, password: string): Promise<number> {
  const doc = new mupdf.PDFDocument(await readFile(path))
  try {
    return doc.authenticatePassword(password)
  } finally {
    doc.destroy()
  }
}

/** Байты файла без шифрования (для проверки содержимого через pdf-lib). */
async function decrypted(path: string, password: string): Promise<PDFDocument> {
  const doc = new mupdf.PDFDocument(await readFile(path))
  try {
    if (doc.needsPassword()) doc.authenticatePassword(password)
    const buffer = doc.saveToBuffer('encrypt=none')
    try {
      return await PDFDocument.load(buffer.asUint8Array().slice())
    } finally {
      buffer.destroy()
    }
  } finally {
    doc.destroy()
  }
}

/** Команда меню через канал main → renderer, как её шлёт пункт без id. */
async function command(name: string): Promise<void> {
  if (!ctx.app) throw new Error('программа не запущена')
  await ctx.app.evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:command', cmd)
  }, name)
}

async function stopApp(): Promise<void> {
  if (!ctx.app) return
  const child = ctx.app.process()
  const exited = new Promise((r) => child.once('exit', r))
  await ctx.app
    .evaluate(({ app }) => {
      setTimeout(() => {
        app.exit(0)
      }, 0)
    })
    .catch(() => undefined)
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))])
  if (child.exitCode === null) child.kill()
  ctx.app = null
}

/** Запуск с зашифрованным файлом: сначала окно пароля, страница — после него. */
async function launchLocked(path: string): Promise<Page> {
  ctx.app = await electron.launch({
    cwd: ROOT,
    args: ['.', path],
    env: {
      ...process.env,
      PDFWRIGHT_USER_DATA: join(ctx.work, 'userData'),
      ELECTRON_RENDERER_URL: ''
    }
  })
  return ctx.app.firstWindow()
}

async function save(page: Page): Promise<void> {
  await page.keyboard.press('Control+s')
  await expect.poll(() => statusText(page)).not.toContain('Не сохранено')
}

describe('Защита паролем (собранное приложение)', () => {
  it('ставит пароль, правит защищённый файл с теми же паролями и снимает защиту', async () => {
    const target = await protectedSample('секрет.pdf')
    let page = await launch(target)

    // 1. Пароль на открытие и пароль владельца с запретом печати.
    await clickMenuItem('file.protect')
    let dialog = page.getByRole('dialog', { name: 'Защита паролем' })
    await dialog.getByLabel('Пароль на открытие').fill(OPEN)
    await dialog.getByLabel('Повторите пароль').fill('другой')
    await dialog.getByLabel('Пароль владельца (необязательно)').fill(OWNER)
    await dialog.getByRole('button', { name: 'Установить пароль' }).click()
    await dialog.getByRole('alert').filter({ hasText: 'Пароли не совпадают.' }).waitFor()
    await dialog.getByLabel('Повторите пароль').fill(OPEN)
    await dialog.getByRole('switch', { name: 'Разрешить печать' }).click()
    await shot(page, 'protect-dialog')
    await dialog.getByRole('button', { name: 'Установить пароль' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    await expect.poll(() => statusText(page)).toContain('Не сохранено')

    // Установка пароля — шаг истории: Ctrl+Z убирает его, Ctrl+Y возвращает.
    const toast = page.getByRole('status')
    await page.keyboard.press('Control+z')
    await toast.filter({ hasText: 'Операция отменена' }).waitFor()
    await page.keyboard.press('Control+y')
    await toast.filter({ hasText: 'Операция повторена' }).waitFor()
    await save(page)

    expect(await access(target, '')).toBe(0)
    expect(await access(target, OPEN)).toBe(2)
    expect(await access(target, OWNER)).toBe(4)
    const info = await inspectProtection(new Uint8Array(await readFile(target)), OPEN)
    expect(info).toMatchObject({ method: 'AES-256', canPrint: false, canCopy: true })
    await stopApp()

    // 2. Открытие паролем (сначала неверным), правка и запись с прежней защитой.
    page = await launchLocked(target)
    const ask = page.getByRole('dialog', { name: 'Документ защищён паролем' })
    await ask.getByLabel('Документ защищён паролем').fill('не тот')
    await ask.getByRole('button', { name: 'Открыть' }).click()
    await ask.getByText('Неверный пароль. Попробуйте ещё раз.').waitFor()
    await ask.getByLabel('Документ защищён паролем').fill(OPEN)
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })

    await command('file.properties')
    const props = page.getByRole('dialog', { name: 'Свойства документа' })
    await props.getByText('AES-256', { exact: true }).waitFor()
    await props.getByLabel('Заголовок').fill('After')
    await props.getByRole('button', { name: 'Записать' }).click()
    await expect.poll(() => props.isVisible()).toBe(false)
    await save(page)

    // Пароль владельца уцелел, хотя документ открыт паролем на открытие.
    expect(await access(target, OPEN)).toBe(2)
    expect(await access(target, OWNER)).toBe(4)
    expect((await decrypted(target, OPEN)).getTitle()).toBe('After')
    expect((await decrypted(target, OPEN)).getPageCount()).toBe(2)

    // 3. Снять защиту можно только с паролем владельца.
    await clickMenuItem('file.protect')
    dialog = page.getByRole('dialog', { name: 'Защита паролем' })
    await dialog.getByText('Печать запрещена.', { exact: false }).waitFor()
    await dialog.getByLabel('Пароль владельца', { exact: true }).fill(OPEN)
    await dialog.getByRole('button', { name: 'Снять защиту' }).click()
    await dialog.getByRole('alert').filter({ hasText: 'Это не пароль владельца' }).waitFor()
    await dialog.getByLabel('Пароль владельца', { exact: true }).fill(OWNER)
    await dialog.getByRole('button', { name: 'Снять защиту' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    await save(page)

    expect(await access(target, '')).not.toBe(0)
    const plain = await PDFDocument.load(await readFile(target))
    expect(plain.getTitle()).toBe('After')
    expect(plain.getPageCount()).toBe(2)
  }, 180_000)
})
