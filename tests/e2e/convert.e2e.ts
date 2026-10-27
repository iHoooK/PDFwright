/// <reference lib="dom" />
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { readImageInfo } from '../../src/shared/convert/image-info'
import { protectPdf } from '../../src/shared/pdf-content/protect'
import { ctx, launch, ROOT, shot, statusText, tool, useElectronApp } from './helpers'

/** Фаза 6: PDF в картинки, картинки в PDF, извлечение текста, сжатие. */
useElectronApp()

function app(): NonNullable<typeof ctx.app> {
  if (!ctx.app) throw new Error('приложение не запущено')
  return ctx.app
}

/** Команда меню приложения, как пункт «Инструменты» в меню окна. */
async function command(name: string): Promise<void> {
  await app().evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:command', cmd)
  }, name)
}

/** Подменяет системный диалог открытия: он «выбирает» заданные файлы или папку. */
async function stubOpenDialog(paths: string[]): Promise<void> {
  await app().evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths })
  }, paths)
}

async function stubSaveDialog(path: string): Promise<void> {
  await app().evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath })
  }, path)
}

type Rgb = [number, number, number]

function halves(width: number, height: number, a: Rgb, b: Rgb): mupdf.Pixmap {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  const pixels = pixmap.getPixels()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, bl] = x < width / 2 ? a : b
      const at = (y * width + x) * 3
      pixels[at] = r
      pixels[at + 1] = g
      pixels[at + 2] = bl
    }
  }
  return pixmap
}

/** JPEG с ориентацией EXIF 6 («повернуть на 90° по часовой»). */
function rotatedJpeg(): Uint8Array {
  const pixmap = halves(400, 300, [230, 20, 20], [20, 20, 230])
  const jpeg = pixmap.asJPEG(92).slice()
  pixmap.destroy()
  const tiff = new Uint8Array(26)
  const view = new DataView(tiff.buffer)
  tiff.set([0x49, 0x49, 0x2a, 0x00])
  view.setUint32(4, 8, true)
  view.setUint16(8, 1, true)
  view.setUint16(10, 0x0112, true)
  view.setUint16(12, 3, true)
  view.setUint32(14, 1, true)
  view.setUint16(18, 6, true)
  const body = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff])
  const app1 = new Uint8Array([0xff, 0xe1, 0, body.length + 2])
  return new Uint8Array([...jpeg.subarray(0, 2), ...app1, ...body, ...jpeg.subarray(2)])
}

describe('Конвертация (собранное приложение)', () => {
  it('сохраняет страницы картинками PNG и JPEG с размером по DPI', async () => {
    const target = join(ctx.work, 'документ.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const source = await PDFDocument.load(await readFile(target))
    const { width, height } = source.getPage(0).getSize()
    const page = await launch(target)

    await command('tools.toImages')
    const dialog = page.getByRole('dialog', { name: 'PDF в изображения' })
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('radio', { name: 'Диапазон' }).click()
    await dialog.getByRole('textbox', { name: /Диапазон страниц/ }).fill('1-2')
    await expect
      .poll(() => dialog.textContent())
      .toContain(
        `Первая страница: ${Math.round((width * 150) / 72)} × ${Math.round((height * 150) / 72)} пикселей`
      )
    await shot(page, 'convert-to-images')
    await dialog.getByRole('button', { name: 'Сохранить картинки' }).click()
    await expect
      .poll(() => dialog.textContent(), { timeout: 30_000 })
      .toContain('Сохранено картинок: 2')
    for (const n of [1, 2]) {
      const info = readImageInfo(await readFile(join(ctx.work, `документ_стр${n}.png`)))
      expect(info).toMatchObject({
        kind: 'png',
        width: Math.round((width * 150) / 72),
        height: Math.round((height * 150) / 72),
        dpi: 150
      })
    }
    await expect(stat(join(ctx.work, 'документ_стр3.png'))).rejects.toThrow()

    // Все страницы в JPEG 72 dpi: пиксель равен пункту.
    await dialog.getByRole('radio', { name: 'Все' }).click()
    await dialog.getByRole('radio', { name: '72 dpi' }).click()
    await dialog.getByRole('radio', { name: /JPEG/ }).click()
    await dialog.getByRole('button', { name: 'Сохранить картинки' }).click()
    await expect
      .poll(() => dialog.textContent(), { timeout: 30_000 })
      .toContain('Сохранено картинок: 3')
    const jpeg = readImageInfo(await readFile(join(ctx.work, 'документ_стр3.jpg')))
    expect(jpeg).toMatchObject({
      kind: 'jpeg',
      width: Math.round(width),
      height: Math.round(height),
      dpi: 72
    })
  })

  it('собирает PDF из картинок со стартового экрана: порядок, поворот EXIF, сохранение', async () => {
    const target = join(ctx.work, 'документ.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const photo = join(ctx.work, 'фото.jpg')
    const picture = join(ctx.work, 'схема.png')
    await writeFile(photo, rotatedJpeg())
    const plain = halves(200, 100, [20, 160, 20], [240, 240, 240])
    await writeFile(picture, plain.asPNG())
    plain.destroy()
    const page = await launch(target)

    await page.getByRole('tab', { name: 'Начало' }).click()
    await page.getByRole('button', { name: /Из изображений/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Изображения в PDF' })
    await stubOpenDialog([photo, picture])
    await dialog.getByRole('button', { name: 'Добавить картинки…' }).click()
    const items = dialog
      .getByRole('list', { name: 'Картинки по порядку страниц' })
      .getByRole('listitem')
    await expect.poll(() => items.count()).toBe(2)
    // Снимок с телефона повёрнут по EXIF: 300 × 400.
    await expect.poll(() => items.nth(0).textContent()).toContain('300 × 400')

    // Перетаскиванием ставим схему первой.
    await items.nth(1).dragTo(items.nth(0), { targetPosition: { x: 40, y: 4 } })
    await expect.poll(() => items.nth(0).textContent()).toContain('схема.png')

    await dialog.getByRole('radio', { name: 'По размеру картинки' }).click()
    await shot(page, 'convert-from-images')
    await dialog.getByRole('button', { name: 'Создать PDF' }).click()

    await expect.poll(() => statusText(page), { timeout: 30_000 }).toContain('Страница 1 из 2')
    expect(await statusText(page)).toContain('Не сохранено')
    await expect
      .poll(() =>
        page
          .getByRole('tablist', { name: 'Документы' })
          .getByRole('tab', { selected: true })
          .textContent()
      )
      .toContain('Изображения.pdf')

    const saved = join(ctx.work, 'из картинок.pdf')
    await stubSaveDialog(saved)
    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')
    const doc = await PDFDocument.load(await readFile(saved))
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: 150, height: 75 })
    expect(doc.getPage(1).getSize()).toEqual({ width: 225, height: 300 })
  })

  it('извлекает текст в порядке строк: буфер обмена и .txt с BOM', async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(
      await readFile(join(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf')),
      { subset: true }
    )
    const first = doc.addPage([400, 400])
    first.drawText('Первая строка', { x: 40, y: 340, size: 14, font })
    first.drawText('Третья строка', { x: 40, y: 300, size: 14, font })
    first.drawText('Вторая строка', { x: 40, y: 320, size: 14, font })
    doc.addPage([400, 400]).drawText('Вторая страница', { x: 40, y: 340, size: 14, font })
    const target = join(ctx.work, 'текст.pdf')
    await writeFile(target, await doc.save())
    const page = await launch(target)

    await command('tools.extractText')
    const dialog = page.getByRole('dialog', { name: 'Извлечь текст' })
    const preview = dialog.getByRole('textbox', { name: 'Извлечь текст' })
    const expected = 'Первая строка\nВторая строка\nТретья строка\n\nВторая страница\n'
    await expect.poll(() => preview.inputValue(), { timeout: 30_000 }).toBe(expected)

    await dialog.getByRole('button', { name: 'Копировать' }).click()
    // Буфер обмена Windows хранит переводы строк как CRLF.
    await expect
      .poll(() =>
        app()
          .evaluate(({ clipboard }) => clipboard.readText())
          .then((text) => text.replace(/\r\n/g, '\n'))
      )
      .toBe(expected)

    await dialog.getByRole('switch').click()
    await expect.poll(() => preview.inputValue()).toContain('— Страница 2 —')

    const txt = join(ctx.work, 'текст.txt')
    await stubSaveDialog(txt)
    await dialog.getByRole('button', { name: /Сохранить в/ }).click()
    await expect
      .poll(() =>
        stat(txt).then(
          () => true,
          () => false
        )
      )
      .toBe(true)
    const bytes = await readFile(txt)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes.subarray(3))
    expect(text).toContain('— Страница 1 —\r\n\r\nПервая строка\r\nВторая строка\r\nТретья строка')
  })

  it('«Выбрать файл…»: пароль зашифрованного файла, понятная ошибка битого, степень запоминается', async () => {
    const target = join(ctx.work, 'документ.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const locked = join(ctx.work, 'секрет.pdf')
    await writeFile(
      locked,
      await protectPdf(new Uint8Array(await readFile(target)), {
        userPassword: 'открыть',
        ownerPassword: 'владелец',
        allowPrint: true,
        allowCopy: true
      })
    )
    const broken = join(ctx.work, 'битый.pdf')
    await writeFile(broken, 'это не PDF, а просто текст')
    const page = await launch(target)

    await command('tools.compress')
    const dialog = page.getByRole('dialog', { name: 'Сжать PDF' })
    await expect.poll(() => dialog.isVisible()).toBe(true)
    // Открытый документ: предупреждение про Ctrl+Z на месте.
    await expect.poll(() => dialog.textContent()).toContain('изменение отменяет Ctrl+Z')

    await stubOpenDialog([locked])
    await dialog.getByRole('button', { name: 'Выбрать файл…' }).click()
    const ask = page.getByRole('dialog', { name: 'Документ защищён паролем' })
    await ask.getByLabel('Документ защищён паролем').fill('открыть')
    await ask.getByRole('button', { name: 'Открыть' }).click()
    await expect.poll(() => dialog.textContent(), { timeout: 30_000 }).toContain('секрет.pdf')
    const text = (await dialog.textContent()) ?? ''
    expect(text).not.toContain('зашифрован')
    expect(text).not.toContain('следующих версиях')
    // Внешний файл не меняется на месте: Ctrl+Z здесь ни при чём.
    expect(text).not.toContain('изменение отменяет Ctrl+Z')
    expect(text).not.toContain('−0 %')

    await stubOpenDialog([broken])
    await dialog.getByRole('button', { name: 'Выбрать файл…' }).click()
    await expect
      .poll(() => dialog.textContent(), { timeout: 15_000 })
      .toContain('Файл не является PDF или повреждён.')
    expect(await dialog.textContent()).not.toContain('Failed to parse')

    // Степень сжатия запоминается до следующего открытия диалога.
    await dialog.getByRole('radio', { name: /Лёгкое/ }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.isVisible()).toBe(false)
    await command('tools.compress')
    await expect
      .poll(() => dialog.getByRole('radio', { name: /Лёгкое/ }).getAttribute('aria-checked'))
      .toBe('true')
  })

  it('сжимает документ со сканом шагом истории: Ctrl+Z возвращает исходные байты', async () => {
    const doc = await PDFDocument.create()
    const scan = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 1240, 1754], false)
    const pixels = scan.getPixels()
    let seed = 3
    for (let i = 0; i < pixels.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      pixels[i] = (((i / 3720) | 0) + ((seed >> 16) % 32)) & 255
    }
    const image = await doc.embedPng(scan.asPNG())
    scan.destroy()
    doc.addPage([595.28, 841.89]).drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 })
    const target = join(ctx.work, 'скан.pdf')
    const original = await doc.save()
    await writeFile(target, original)
    const page = await launch(target)

    await command('tools.compress')
    const dialog = page.getByRole('dialog', { name: 'Сжать PDF' })
    await dialog.getByRole('radio', { name: /Сильное/ }).click()
    await expect
      .poll(() => dialog.textContent(), { timeout: 60_000 })
      .toContain('Пересжато картинок: 1 из 1')
    await shot(page, 'convert-compress')
    await dialog.getByRole('button', { name: 'Применить к документу' }).click()
    await expect.poll(() => dialog.isVisible()).toBe(false)
    await expect.poll(() => statusText(page)).toContain('Не сохранено')

    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')
    const compressed = await readFile(target)
    expect(compressed.length).toBeLessThan(original.length / 3)
    expect((await PDFDocument.load(compressed)).getPageCount()).toBe(1)

    await tool(page, 'Отменить').click()
    await expect.poll(() => statusText(page)).toContain('Не сохранено')
    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')
    expect(Buffer.compare(await readFile(target), Buffer.from(original))).toBe(0)
  })
})
