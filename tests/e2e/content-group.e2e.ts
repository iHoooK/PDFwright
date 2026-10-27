/// <reference lib="dom" />
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { listPageObjects } from '../../src/shared/pdf-content'
import {
  clickPage,
  ctx,
  drag,
  launch,
  pagePoint,
  shot,
  statusText,
  tool,
  useElectronApp
} from './helpers'

/** «Правка» 2.0: группа объектов и сдвиг содержимого под удлинённым абзацем. */
useElectronApp()

const W = 595
const H = 842
const fx = (x: number): number => x / W
const fy = (y: number): number => (H - y) / H

describe('правка содержимого: группа и сдвиг', () => {
  it('Ctrl+щелчок собирает группу, Delete удаляет её, рамка с Shift выбирает и двигает', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    const sheet = source.addPage([W, H])
    sheet.drawText('Alpha line', { x: 72, y: 760, size: 20, font })
    sheet.drawText('Beta line', { x: 72, y: 680, size: 20, font })
    sheet.drawText('Gamma line', { x: 72, y: 600, size: 20, font })
    sheet.drawRectangle({ x: 72, y: 400, width: 150, height: 60, color: rgb(0.3, 0.5, 0.8) })
    const target = join(ctx.work, 'группа.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)

    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready="4"]').waitFor()
    // Здесь координаты постоянные: сдвиг при удалении группы проверяет следующий тест.
    await page.getByRole('radio', { name: 'Не сдвигать' }).click()
    await clickPage(page, 1, fx(100), fy(767))
    await page.locator('[data-content-selected="block"]').waitFor()
    const beta = await pagePoint(page, 1, fx(100), fy(687))
    await page.keyboard.down('Control')
    await page.mouse.click(beta.x, beta.y)
    await page.keyboard.up('Control')
    await expect.poll(() => page.locator('[data-content-selected]').count()).toBe(2)
    await page.locator('[data-content-props="group"]').waitFor()
    await shot(page, 'content-group')
    await page.keyboard.press('Delete')
    await expect
      .poll(() => page.locator('[data-page="1"] .textLayer').textContent())
      .not.toContain('Alpha')
    expect(await page.locator('[data-page="1"] .textLayer').textContent()).not.toContain('Beta')

    // Рамка с Shift вокруг оставшейся строки и плашки, затем перенос группы вниз на 50 пт.
    await page.locator('[data-content-layer="1"][data-content-ready="2"]').waitFor()
    const a = await pagePoint(page, 1, fx(60), fy(630))
    const b = await pagePoint(page, 1, fx(300), fy(390), false)
    await page.keyboard.down('Shift')
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect.poll(() => page.locator('[data-content-selected]').count()).toBe(2)
    await drag(page, 1, [fx(100), fy(607)], [fx(100), fy(557)])
    await expect.poll(() => page.locator('[data-content-selected]').count()).toBe(0)

    await page.keyboard.press('Control+s')
    await expect.poll(() => statusText(page)).toContain('Сохранено')
    const objects = await listPageObjects(new Uint8Array(await readFile(target)), 0)
    expect(objects.lines.map((l) => l.text)).toEqual(['Gamma line'])
    expect(objects.lines[0]?.origin.y).toBeCloseTo(550, -1)
    expect(objects.graphics[0]?.rect.y).toBeCloseTo(350, -1)
  })

  it('удаление группы абзацев поднимает содержимое ниже, как удаление одного', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    const sheet = source.addPage([W, H])
    sheet.drawText('Alpha line', { x: 72, y: 760, size: 20, font })
    sheet.drawText('Beta line', { x: 72, y: 700, size: 20, font })
    sheet.drawText('Below text', { x: 72, y: 500, size: 20, font })
    const target = join(ctx.work, 'группа-сдвиг.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)

    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready="3"]').waitFor()
    await clickPage(page, 1, fx(100), fy(767))
    await page.locator('[data-content-selected="block"]').waitFor()
    const beta = await pagePoint(page, 1, fx(100), fy(707))
    await page.keyboard.down('Control')
    await page.mouse.click(beta.x, beta.y)
    await page.keyboard.up('Control')
    await expect.poll(() => page.locator('[data-content-selected]').count()).toBe(2)
    await page.keyboard.press('Delete')
    await expect
      .poll(() => page.locator('[data-page="1"] .textLayer').textContent())
      .not.toContain('Alpha')
    await page.keyboard.press('Control+s')
    await expect.poll(() => statusText(page)).toContain('Сохранено')
    const objects = await listPageObjects(new Uint8Array(await readFile(target)), 0)
    expect(objects.lines.map((l) => l.text)).toEqual(['Below text'])
    expect(objects.lines[0]?.origin.y).toBeGreaterThan(520)
  })

  it('выбранный абзац из нескольких строк перетаскивается, щелчок выбирает строку', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    const sheet = source.addPage([W, H])
    sheet.drawText('The first line of a paragraph that is', { x: 72, y: 700, size: 14, font })
    sheet.drawText('long enough to wrap over two rows.', { x: 72, y: 682, size: 14, font })
    const target = join(ctx.work, 'перенос.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)

    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready]').waitFor()
    await clickPage(page, 1, fx(150), fy(705))
    await page.locator('[data-content-selected="block"]').waitFor()
    // Щелчок по выбранному абзацу без движения выбирает строку.
    await page.waitForTimeout(600)
    await clickPage(page, 1, fx(150), fy(687))
    await page.locator('[data-content-selected="text"]').waitFor()
    // Снова абзац, затем перенос за строку внутри него на 100 пт вниз.
    await page.keyboard.press('Escape')
    await clickPage(page, 1, fx(150), fy(705))
    await page.locator('[data-content-selected="block"]').waitFor()
    await page.waitForTimeout(600)
    await drag(page, 1, [fx(150), fy(687)], [fx(150), fy(587)])
    await expect
      .poll(async () => {
        await page.keyboard.press('Control+s')
        const objects = await listPageObjects(new Uint8Array(await readFile(target)), 0)
        return objects.lines.find((l) => l.text.startsWith('The first'))?.origin.y ?? 0
      })
      .toBeLessThan(620)
  })

  it('удлинённый абзац сдвигает текст ниже', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    const sheet = source.addPage([W, H])
    sheet.drawText('The first line of a paragraph that is', { x: 72, y: 700, size: 14, font })
    sheet.drawText('long enough to wrap over two rows.', { x: 72, y: 682, size: 14, font })
    sheet.drawText('Text below the paragraph', { x: 72, y: 620, size: 14, font })
    const target = join(ctx.work, 'сдвиг.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)

    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready]').waitFor()
    const p = await pagePoint(page, 1, fx(150), fy(705))
    await page.mouse.dblclick(p.x, p.y)
    const editor = page.locator('[data-content-editor]')
    await editor.waitFor()
    await editor.fill(
      'The first line of a paragraph that is long enough to wrap over two rows. Now it has a third row as well.'
    )
    await editor.press('Control+Enter')
    await expect
      .poll(() => page.locator('[data-page="1"] .textLayer').textContent())
      .toContain('third row')
    await page.keyboard.press('Control+s')
    await expect.poll(() => statusText(page)).toContain('Сохранено')

    const objects = await listPageObjects(new Uint8Array(await readFile(target)), 0)
    const below = objects.lines.find((l) => l.text === 'Text below the paragraph')
    expect(below?.origin.y).toBeCloseTo(602, 0)
  })
})
