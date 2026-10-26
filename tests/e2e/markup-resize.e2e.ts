/// <reference lib="dom" />
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as mupdf from 'mupdf'
import { PDFArray, PDFDocument, type PDFHexString, PDFName, type PDFNumber } from 'pdf-lib'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  annotations,
  clickPage,
  ctx,
  launch,
  ROOT,
  shot,
  statusText,
  tool,
  useElectronApp
} from './helpers'

/** Изменение размеров объектов разметки: ручки сторон, рамка текста с переносом. */
useElectronApp()

/** Тянет ручку выбранного объекта на dx, dy пикселей экрана. */
async function dragHandle(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const handle = page.locator(`[data-markup-handle="${id}"]`)
  await handle.scrollIntoViewIfNeeded()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`нет ручки ${id}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

async function boxOf(
  page: Page,
  selector: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`нет ${selector}`)
  return box
}

function rectOf(dict: ReturnType<typeof annotations>[number]): number[] {
  const rect = dict.lookup(PDFName.of('Rect'), PDFArray)
  return rect.asArray().map((n) => (n as PDFNumber).asNumber())
}

describe('изменение размеров разметки', () => {
  it('растягивает картинку по ширине и сужает текст до двух строк без смены кегля', async () => {
    const target = join(ctx.work, 'размеры.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    // Картинка встаёт выбранной; боковая ручка тянет только ширину.
    await page.locator('[data-image-input]').setInputFiles(join(ROOT, 'resources/icon-256.png'))
    await page.locator('[data-markup-selected="image"]').waitFor()
    await page.locator('[data-markup-handle="right"]').scrollIntoViewIfNeeded()
    const image = await boxOf(page, '[data-markup-kind="image"]')
    await dragHandle(page, 'right', 80, 30)
    const wide = await boxOf(page, '[data-markup-kind="image"]')
    expect(wide.width - image.width).toBeGreaterThan(75)
    expect(wide.width - image.width).toBeLessThan(85)
    expect(Math.abs(wide.height - image.height)).toBeLessThan(1)
    expect(Math.abs(wide.x - image.x)).toBeLessThan(1)

    // Текстовый блок растёт по тексту в одну строку.
    await tool(page, 'Текст').click()
    await clickPage(page, 1, 0.15, 0.15)
    const editor = page.locator('[data-markup-editor] textarea')
    await editor.waitFor()
    await page.keyboard.type('Перенос строки')
    await page.keyboard.press('Escape')
    const lines = page.locator('[data-markup-layer="1"] [data-markup-kind="text"] text')
    await expect.poll(() => lines.count()).toBe(1)

    await tool(page, 'Выделение').click()
    const line = await boxOf(page, '[data-markup-kind="text"] text')
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2)
    await page.locator('[data-markup-selected="text"]').waitFor()
    const props = page.locator('[data-markup-props="text"]')
    await expect.poll(() => props.textContent()).toContain('14 пт')
    const block = await boxOf(page, '[data-markup-kind="text"]')

    // Сужение на 40 %: два слова расходятся на две строки, кегль прежний, рамка выше.
    await dragHandle(page, 'right', -block.width * 0.4, 0)
    await expect.poll(() => lines.count()).toBe(2)
    expect(await lines.allTextContents()).toEqual(['Перенос', 'строки'])
    expect(await lines.evaluateAll((els) => els.map((e) => e.getAttribute('font-size')))).toEqual([
      '14',
      '14'
    ])
    const narrow = await boxOf(page, '[data-markup-kind="text"]')
    expect(narrow.width).toBeCloseTo(block.width * 0.6, -1)
    expect(narrow.height).toBeGreaterThan(block.height * 1.5)
    expect(Math.abs(narrow.y - block.y)).toBeLessThan(1)
    expect(await props.textContent()).toContain('14 пт')

    // Правка текста в рамке: тот же перенос в редакторе на странице.
    await page.mouse.dblclick(narrow.x + narrow.width / 2, narrow.y + narrow.height / 4)
    await editor.waitFor()
    expect(await editor.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre-wrap')
    await page.keyboard.press('Escape')
    await expect.poll(() => editor.count()).toBe(0)
    await shot(page, 'markup-resize')

    await page.keyboard.press('Control+s')
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('Сохранено')

    const bytes = await readFile(target)
    const saved = await PDFDocument.load(bytes)
    const annots = annotations(saved, 0)
    const subtype = (a: (typeof annots)[number]): string =>
      a.get(PDFName.of('Subtype'))?.toString() ?? ''
    const stamp = annots.find((a) => subtype(a) === '/Stamp')
    const freeText = annots.find((a) => subtype(a) === '/FreeText')
    if (!stamp || !freeText) throw new Error('нет аннотаций картинки и текста')
    // Квадратная картинка стала шире, чем выше: пропорции изменились только по ширине.
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rectOf(stamp)
    const ratio = (x1 - x0 - 2) / (y1 - y0 - 2)
    expect(ratio).toBeCloseTo(wide.width / wide.height, 1)
    expect(ratio).toBeGreaterThan(1.2)
    const contents = freeText.lookup(PDFName.of('Contents'))
    expect((contents as PDFHexString).decodeText()).toBe('Перенос строки')

    // Внешний вид FreeText: две строки кеглем 14 (MuPDF читает текст аннотаций).
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
    const found: { text: string; y: number; size: number }[] = []
    doc
      .loadPage(0)
      .toDisplayList(true)
      .toStructuredText('preserve-whitespace')
      .walk({
        onChar: (c, origin, _font, size) => {
          if (!/[А-Яа-яЁё]/.test(c)) return
          const row = found.find((r) => Math.abs(r.y - origin[1]) < 1)
          if (row) row.text += c
          else found.push({ text: c, y: origin[1], size })
        }
      })
    expect(found.map((r) => r.text)).toEqual(['Перенос', 'строки'])
    for (const row of found) expect(row.size).toBeCloseTo(14, 1)
  })
})
