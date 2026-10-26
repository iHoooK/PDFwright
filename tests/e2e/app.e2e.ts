/// <reference lib="dom" />
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  type PDFRawStream
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { listPageObjects } from '../../src/shared/pdf-content'
import {
  annotations,
  clickPage,
  ctx,
  drag,
  launch,
  pagePoint,
  ROOT,
  shot,
  statusText,
  subtypes,
  tool,
  useElectronApp
} from './helpers'

/** Основные сценарии: просмотр, страницы, разметка, подпись, правка содержимого. */
useElectronApp()

describe('PDFwright (собранное приложение)', () => {
  it('открывает файл из аргументов, поворачивает страницу и сохраняет её на диск', async () => {
    const target = join(ctx.work, 'документ.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    expect(await statusText(page)).toContain('Страница 1 из 3')
    await expect
      .poll(() => page.locator('.textLayer').first().textContent())
      .toContain('PDFwright test page 1')

    const toolbar = page.getByRole('toolbar', { name: 'Команды' })
    await toolbar.getByRole('button', { name: 'Страницы', exact: true }).click()
    await page.locator('[draggable] button').first().click()
    await page
      .getByRole('toolbar', { name: 'Страницы' })
      .getByRole('button', { name: 'Повернуть ↻' })
      .click()
    await expect.poll(() => statusText(page)).toContain('Не сохранено')

    await toolbar.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')

    const saved = await PDFDocument.load(await readFile(target), { updateMetadata: false })
    expect(saved.getPageCount()).toBe(3)
    expect(saved.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 0])
    expect(saved.getProducer()).toBe('PDFwright')
  })

  it('рисует только страницы рядом с экраном в большом документе', async () => {
    const big = await PDFDocument.create()
    const font = await big.embedFont(StandardFonts.Helvetica)
    for (let i = 1; i <= 400; i += 1) {
      big.addPage([595, 842]).drawText(`Big document page ${i}`, { x: 72, y: 760, size: 24, font })
    }
    const target = join(ctx.work, 'big.pdf')
    await writeFile(target, await big.save())
    const page = await launch(target)

    expect(await statusText(page)).toContain('из 400')
    await page.locator('div[aria-label="Документ"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect
      .poll(() => statusText(page), { timeout: 20_000 })
      .toMatch(/Страница (39\d|400) из 400/)
    await expect
      .poll(() => page.locator('[data-page="400"] .textLayer').textContent(), { timeout: 20_000 })
      .toContain('Big document page 400')

    const rendered = await page
      .locator('[data-page] canvas')
      .evaluateAll((canvases) => canvases.filter((c) => (c as HTMLCanvasElement).width > 0).length)
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThanOrEqual(12)
  })

  it('рисует фигуру, пишет текст по-русски и сохраняет их PDF-аннотациями', async () => {
    const target = join(ctx.work, 'разметка.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    await tool(page, 'Фигуры').click()
    await drag(page, 1, [0.2, 0.4], [0.6, 0.55])
    await expect.poll(() => page.locator('[data-markup-layer="1"] svg rect').count()).toBe(1)

    await tool(page, 'Текст').click()
    await clickPage(page, 1, 0.2, 0.7)
    const editor = page.locator('[data-markup-editor] textarea')
    await editor.waitFor()
    await page.keyboard.type('Привет, мир!')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Вторая строка')
    await page.keyboard.press('Escape')
    await expect.poll(() => editor.count()).toBe(0)
    await expect
      .poll(() => page.locator('[data-markup-layer="1"] [data-markup-kind="text"] text').count())
      .toBe(2)
    expect(await statusText(page)).toContain('Не сохранено')
    await shot(page, 'markup-annotations')

    // Выделение: щелчок по рамке выбирает её, панель свойств показывает объект.
    await tool(page, 'Выделение').click()
    await clickPage(page, 1, 0.2, 0.47)
    await page.locator('[data-markup-selected="rect"]').waitFor()
    await page.locator('[data-markup-props="rect"]').waitFor()

    // Перемещение за контур, изменение размера за угол, Delete и отмена удаления.
    const rect = page.locator('[data-markup-layer="1"] svg rect')
    const before = await rect.boundingBox()
    await drag(page, 1, [0.2, 0.47], [0.3, 0.5])
    const moved = await rect.boundingBox()
    const pageWidth = (await page.locator('[data-page="1"]').boundingBox())?.width ?? 0
    expect((moved?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(pageWidth * 0.08)
    expect(Math.round(moved?.width ?? 0)).toBe(Math.round(before?.width ?? 0))
    const corner = await page.locator('[data-markup-handle="2"]').boundingBox()
    if (!corner) throw new Error('нет угла рамки')
    await page.mouse.move(corner.x + 5, corner.y + 5)
    await page.mouse.down()
    await page.mouse.move(corner.x + 65, corner.y + 45, { steps: 5 })
    await page.mouse.up()
    const resized = await rect.boundingBox()
    expect((resized?.width ?? 0) - (moved?.width ?? 0)).toBeGreaterThan(40)
    await page.keyboard.press('Delete')
    await expect.poll(() => rect.count()).toBe(0)
    await page.keyboard.press('Control+z')
    await expect.poll(() => rect.count()).toBe(1)

    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')

    const saved = await PDFDocument.load(await readFile(target))
    expect(subtypes(saved, 0)).toEqual(['/Square', '/FreeText'])
    const freeText = annotations(saved, 0)[1]
    const contents = freeText?.lookup(PDFName.of('Contents'))
    expect(contents).toBeInstanceOf(PDFHexString)
    expect((contents as PDFHexString).decodeText()).toBe('Привет, мир!\nВторая строка')
    const appearance = freeText?.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as
      PDFRawStream | undefined
    const fonts = appearance?.dict
      .lookup(PDFName.of('Resources'), PDFDict)
      .lookup(PDFName.of('Font'), PDFDict)
    expect(fonts?.keys().length).toBe(1)
    // После сохранения объекты стали аннотациями документа: pdf.js рисует их сам.
    await expect.poll(() => page.locator('[data-markup-layer="1"] svg rect').count()).toBe(0)
  })

  it('маркер по тексту и перо, отмена и повтор, сохранение в содержимое страницы', async () => {
    const target = join(ctx.work, 'flatten.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)
    await expect
      .poll(() => page.locator('[data-page="1"] .textLayer').textContent())
      .toContain('PDFwright test page 1')

    await tool(page, 'Маркер').click()
    // Выделение двух строк: от начала заголовка до конца строки под ним.
    const lineBox = async (
      text: string
    ): Promise<{ x: number; y: number; width: number; height: number }> => {
      const found = await page
        .locator('[data-page="1"] .textLayer span', { hasText: text })
        .first()
        .boundingBox()
      if (!found) throw new Error(`нет строки «${text}»`)
      return found
    }
    const first = await lineBox('PDFwright test page 1')
    const second = await lineBox('Arendnaya plata')
    await page.mouse.move(first.x + 2, first.y + first.height / 2)
    await page.mouse.down()
    await page.mouse.move(second.x + second.width - 2, second.y + second.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => page.locator('[data-markup-layer="1"] svg rect').count()).toBe(2)

    // 20 штрихов пера отменяются и повторяются без расхождений (план 4.6).
    await tool(page, 'Перо').click()
    for (let i = 0; i < 20; i += 1) {
      const x = 0.1 + (i % 5) * 0.16
      const y = 0.3 + Math.floor(i / 5) * 0.04
      await drag(page, 1, [x, y], [x + 0.1, y + 0.02])
    }
    const strokes = page.locator('[data-markup-layer="1"] polyline')
    const highlight = page.locator('[data-markup-layer="1"] svg rect')
    const pointsOf = (): Promise<(string | null)[]> =>
      strokes.evaluateAll((elements) => elements.map((e) => e.getAttribute('points')))
    await expect.poll(() => strokes.count()).toBe(20)
    const drawn = await pointsOf()
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Control+z')
    await expect.poll(() => strokes.count()).toBe(0)
    expect(await highlight.count()).toBe(2)
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Control+y')
    await expect.poll(() => strokes.count()).toBe(20)
    expect(await pointsOf()).toEqual(drawn)
    await shot(page, 'markup-flatten')

    await page.getByRole('radio', { name: 'Часть содержимого страницы' }).click()
    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')

    const saved = await PDFDocument.load(await readFile(target))
    expect(annotations(saved, 0)).toHaveLength(0)
    const contents = saved.getPage(0).node.Contents()
    expect(contents).toBeInstanceOf(PDFArray)
    const xobjects = saved.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
    expect(xobjects?.keys().filter((k) => k.toString().startsWith('/PWMarkup'))).toHaveLength(21)
  })

  it('рисует подпись, ставит её на две страницы и вставляет картинку', async () => {
    const target = join(ctx.work, 'подпись.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    await tool(page, 'Подпись').click()
    await page.getByRole('button', { name: 'Нарисовать…' }).click()
    const pad = page.getByRole('dialog').locator('canvas')
    const padBox = await pad.boundingBox()
    if (!padBox) throw new Error('нет холста подписи')
    await page.mouse.move(padBox.x + 60, padBox.y + 120)
    await page.mouse.down()
    for (const [x, y] of [
      [120, 60],
      [180, 140],
      [260, 70],
      [330, 130]
    ] as const) {
      await page.mouse.move(padBox.x + x, padBox.y + y, { steps: 5 })
    }
    await page.mouse.up()
    await page.getByRole('button', { name: 'Сохранить подпись' }).click()
    await page.getByRole('radio', { name: 'Подпись 1' }).waitFor()

    await clickPage(page, 1, 0.7, 0.85)
    await clickPage(page, 2, 0.7, 0.85)
    await expect.poll(() => page.locator('[data-markup-kind="image"]').count()).toBe(2)

    // Картинка PNG: в центр текущей страницы, сразу выбрана для перемещения.
    await page.locator('[data-image-input]').setInputFiles(join(ROOT, 'resources/icon-256.png'))
    await expect.poll(() => page.locator('[data-markup-kind="image"]').count()).toBe(3)
    await page.locator('[data-markup-selected="image"]').waitFor()
    await shot(page, 'markup-signature')

    await page.keyboard.press('Control+s')
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('Сохранено')

    const saved = await PDFDocument.load(await readFile(target))
    const stamps = [0, 1, 2].map((i) => subtypes(saved, i).filter((t) => t === '/Stamp').length)
    expect(stamps.reduce((sum, n) => sum + n, 0)).toBe(3)
    expect(stamps[0]).toBeGreaterThanOrEqual(1)
    expect(stamps[1]).toBeGreaterThanOrEqual(1)
    const settings = JSON.parse(
      await readFile(join(ctx.work, 'userData', 'settings.json'), 'utf8')
    ) as { markup: { signatures: { src: string }[] } }
    expect(settings.markup.signatures).toHaveLength(1)
    expect(settings.markup.signatures[0]?.src).toMatch(/^data:image\/png;base64,/)
  })

  it('правит содержимое: абзацы, ширина, новый текст, картинка, ластик', async () => {
    // Страница 595×842 пт: три строки и картинка 200×200 с левым нижним углом в (72, 300).
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    const png = await source.embedPng(await readFile(join(ROOT, 'resources/icon-256.png')))
    const sheet = source.addPage([595, 842])
    sheet.drawText('Delete this line', { x: 72, y: 760, size: 20, font })
    sheet.drawText('Fix tpyo here', { x: 72, y: 700, size: 20, font })
    sheet.drawText('Keep this line', { x: 72, y: 640, size: 20, font })
    sheet.drawImage(png, { x: 72, y: 300, width: 200, height: 200 })
    const target = join(ctx.work, 'содержимое.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)

    /** Доля высоты страницы для точки с координатой y в пространстве PDF. */
    const fy = (y: number): number => (842 - y) / 842
    const fx = (x: number): number => x / 595
    const layerText = (): Promise<string | null> =>
      page.locator('[data-page="1"] .textLayer').textContent()

    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready="4"]').waitFor()

    const handleTo = async (handle: string, fxTo: number, fyTo: number): Promise<void> => {
      const box = await page.locator(`[data-content-handle="${handle}"]`).boundingBox()
      if (!box) throw new Error(`нет ручки ${handle}`)
      const to = await pagePoint(page, 1, fxTo, fyTo, false)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 6 })
      await page.mouse.up()
    }
    const ready = (): Promise<void> =>
      page.locator('[data-content-layer="1"][data-content-ready]').waitFor()

    // Щелчок выбирает абзац (здесь — из одной строки), Delete вырезает его из документа.
    await clickPage(page, 1, fx(110), fy(767))
    await page.locator('[data-content-selected="block"]').waitFor()
    await page.locator('[data-content-props="block"]').waitFor()
    await page.keyboard.press('Delete')
    await expect.poll(layerText, { timeout: 20_000 }).not.toContain('Delete this line')
    expect(await statusText(page)).toContain('Не сохранено')

    // Двойной щелчок открывает правку абзаца на месте, Ctrl+Enter — готово.
    await ready()
    const p = await pagePoint(page, 1, fx(110), fy(707))
    await page.mouse.dblclick(p.x, p.y)
    const editor = page.locator('[data-content-editor]')
    await editor.waitFor()
    await editor.fill('Fixed typo here')
    await editor.press('Control+Enter')
    await expect.poll(layerText, { timeout: 20_000 }).toContain('Fixed typo here')
    await shot(page, 'content-replaced')

    // Ctrl+Z возвращает исходную строку, Ctrl+Y — исправленную.
    await page.keyboard.press('Control+z')
    await expect.poll(layerText, { timeout: 20_000 }).toContain('Fix tpyo here')
    await page.keyboard.press('Control+y')
    await expect.poll(layerText, { timeout: 20_000 }).toContain('Fixed typo here')

    // Ширина абзаца: правая ручка сужает колонку, текст переносится на две строки.
    await ready()
    await clickPage(page, 1, fx(110), fy(647))
    await page.locator('[data-content-selected="block"]').waitFor()
    await handleTo('end', fx(167), fy(647))
    await expect.poll(layerText, { timeout: 20_000 }).not.toContain('Keep this line')

    // Картинку перетаскиваем вправо на 100 пт, затем тянем правую ручку: только ширина.
    await drag(page, 1, [fx(172), fy(400)], [fx(272), fy(400)])
    await expect.poll(() => page.locator('[data-content-selected]').count()).toBe(0)
    await ready()
    await clickPage(page, 1, fx(272), fy(400))
    await page.locator('[data-content-selected="image"]').waitFor()
    await page.locator('[data-content-props="image"]').waitFor()
    await handleTo('e', fx(422), fy(400))
    await expect
      .poll(() => page.locator('[data-content-selected]').count(), { timeout: 20_000 })
      .toBe(0)
    await shot(page, 'content-resized')

    // Новый текст шрифтом документа: щелчок по странице и набор.
    await ready()
    await page.getByRole('radio', { name: 'Новый текст' }).click()
    await clickPage(page, 1, fx(72), fy(570))
    await editor.waitFor()
    await page.keyboard.type('Added line')
    await page.keyboard.press('Control+Enter')
    await expect.poll(layerText, { timeout: 20_000 }).toContain('Added line')

    // Ластик: рамка вокруг нового текста вырезает его.
    await page.getByRole('radio', { name: 'Ластик области' }).click()
    await drag(page, 1, [fx(60), fy(575)], [fx(220), fy(540)])
    await expect.poll(layerText, { timeout: 20_000 }).not.toContain('Added line')

    await page.keyboard.press('Control+s')
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('Сохранено')

    const objects = await listPageObjects(new Uint8Array(await readFile(target)), 0)
    expect(objects.lines.map((line) => line.text).sort()).toEqual(
      ['Fixed typo here', 'Keep this', 'line'].sort()
    )
    expect(objects.images).toHaveLength(1)
    expect(objects.images[0]?.rect.width).toBeCloseTo(250, -1)
    expect(objects.images[0]?.rect.height).toBeCloseTo(200, -1)
  })
})
