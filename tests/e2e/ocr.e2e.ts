/// <reference lib="dom" />
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { ctx, launch, ROOT, shot, tool, useElectronApp } from './helpers'

/** Фаза 17: распознавание текста сканов и невидимый текстовый слой. */
useElectronApp()

function app(): NonNullable<typeof ctx.app> {
  if (!ctx.app) throw new Error('приложение не запущено')
  return ctx.app
}

async function command(name: string): Promise<void> {
  await app().evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:command', cmd)
  }, name)
}

/**
 * Фикстура-скан: строки текста рисуются в PNG (MuPDF рендерит временный PDF
 * со шрифтом PT Sans в 300 dpi), картинка вставляется страницей через
 * pdf-lib. Текста в документе нет — только картинка.
 */
async function scanFixture(path: string, lines: string[][]): Promise<void> {
  const font = await readFile(join(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  const scan = await PDFDocument.create()
  for (const pageLines of lines) {
    const draft = await PDFDocument.create()
    draft.registerFontkit(fontkit)
    const sans = await draft.embedFont(font)
    const sheet = draft.addPage([420, 300])
    pageLines.forEach((line, i) => {
      sheet.drawText(line, { x: 36, y: 240 - i * 50, size: 24, font: sans })
    })
    const pdf = new mupdf.PDFDocument(await draft.save())
    const pixmap = pdf
      .loadPage(0)
      .toPixmap(mupdf.Matrix.scale(300 / 72, 300 / 72), mupdf.ColorSpace.DeviceRGB, false)
    const png = pixmap.asPNG().slice()
    pixmap.destroy()
    pdf.destroy()
    const page = scan.addPage([420, 300])
    page.drawImage(await scan.embedPng(png), { x: 0, y: 0, width: 420, height: 300 })
  }
  await writeFile(path, await scan.save())
}

function ocrDialog(page: Awaited<ReturnType<typeof launch>>): ReturnType<typeof page.getByRole> {
  return page.getByRole('dialog', { name: 'Распознать текст' })
}

describe('Распознавание текста (собранное приложение)', () => {
  it('распознаёт скан: поиск находит слово, текст выделяется и копируется, слой сохраняется', async () => {
    const target = join(ctx.work, 'скан.pdf')
    await scanFixture(target, [['Сканированный документ', 'Invoice number 2026']])
    const page = await launch(target)
    const textLayer = page.locator('[data-page="1"] .textLayer')
    expect(((await textLayer.textContent()) ?? '').trim()).toBe('')

    await command('tools.ocr')
    const dialog = ocrDialog(page)
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('radio', { name: 'Текущая (1)' }).click()
    await shot(page, 'ocr-dialog')
    await dialog.getByRole('button', { name: 'Распознать', exact: true }).click()
    await expect.poll(() => dialog.isVisible(), { timeout: 60_000 }).toBe(false)
    await expect.poll(() => page.getByRole('status').textContent()).toContain('Текст распознан')

    // Текстовый слой pdf.js теперь есть: по нему работают выделение и копирование.
    await expect.poll(() => textLayer.textContent()).toContain('Сканированный')
    await expect.poll(() => textLayer.textContent()).toContain('Invoice')
    await shot(page, 'ocr-done')
    await textLayer.evaluate((layer) => {
      const selection = window.getSelection()
      selection?.selectAllChildren(layer)
    })
    await shot(page, 'ocr-selected')
    await app().evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.copy()
    })
    await expect
      .poll(() => app().evaluate(({ clipboard }) => clipboard.readText()))
      .toMatch(/Сканированный\s+документ/)

    // Поиск находит распознанное слово.
    await command('edit.find')
    const search = page.getByRole('searchbox', { name: 'Поиск в документе' })
    await search.fill('документ')
    await search.press('Enter')
    await expect.poll(() => page.getByText('1 из 1', { exact: true }).isVisible()).toBe(true)

    // Слой — часть файла после сохранения: MuPDF находит слово, а картинка та же.
    await tool(page, 'Сохранить').click()
    await expect
      .poll(async () => {
        const doc = new mupdf.PDFDocument(await readFile(target))
        const hits = doc.loadPage(0).search('Invoice', '').length
        doc.destroy()
        return hits
      })
      .toBe(1)
  })

  it('пропускает страницы с текстом и останавливается по кнопке', async () => {
    const target = join(ctx.work, 'текст.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)
    await command('tools.ocr')
    const dialog = ocrDialog(page)
    await dialog.getByRole('button', { name: 'Распознать', exact: true }).click()
    await expect.poll(() => dialog.textContent(), { timeout: 30_000 }).toContain('уже есть текст')

    // Распознавание тоже страниц с текстом и «Остановить» сразу после запуска.
    await dialog.getByRole('switch').click()
    await dialog.getByRole('button', { name: 'Распознать', exact: true }).click()
    await dialog.getByRole('button', { name: 'Остановить' }).click()
    await expect
      .poll(async () => `${await page.locator('body').textContent()}`, { timeout: 30_000 })
      .toContain('Остановлено')
  })
})
