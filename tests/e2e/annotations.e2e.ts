/// <reference lib="dom" />
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  type PDFDict,
  type PDFNumber
} from 'pdf-lib'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
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

/** Фаза 15: заметки, аннотации документа, разметка на миниатюрах, группа выбора. */
useElectronApp()

const A4 = { width: 595, height: 842 }

/** Доли страницы для точки в пунктах PDF (ось Y вверх). */
const share = (x: number, y: number): [number, number] => [x / A4.width, 1 - y / A4.height]

/**
 * Документ с пометками «другой программы», собранный pdf-lib: прямоугольник,
 * текстовое поле, выделение строки текста.
 */
async function annotatedFixture(path: string): Promise<void> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([A4.width, A4.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Annotated document for PDFwright', { x: 72, y: 760, size: 16, font })
  const add = (dict: Record<string, unknown>): void => {
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', ...dict } as never)))
  }
  add({ Subtype: 'Square', Rect: [100, 500, 220, 580], C: [1, 0, 0], BS: { W: 3 } })
  add({
    Subtype: 'FreeText',
    Rect: [300, 600, 520, 640],
    Contents: PDFHexString.fromText('Old note'),
    DA: PDFString.of('/Helv 12 Tf 0 0 0 rg')
  })
  add({
    Subtype: 'Highlight',
    Rect: [72, 755, 340, 778],
    C: [1, 1, 0],
    QuadPoints: [72, 778, 340, 778, 72, 755, 340, 755]
  })
  await writeFile(path, await doc.save())
}

function numbers(dict: PDFDict, key: string): number[] {
  return dict
    .lookup(PDFName.of(key), PDFArray)
    .asArray()
    .map((n) => (n as PDFNumber).asNumber())
}

function bySubtype(doc: PDFDocument, subtype: string): PDFDict {
  const found = annotations(doc, 0).find(
    (a) => a.get(PDFName.of('Subtype'))?.toString() === `/${subtype}`
  )
  if (!found) throw new Error(`нет аннотации ${subtype}`)
  return found
}

async function saveAndLoad(page: Page, path: string): Promise<PDFDocument> {
  await page.keyboard.press('Control+s')
  await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('Сохранено')
  return PDFDocument.load(await readFile(path))
}

/**
 * Сохраняет, пока файл не станет таким, как ждёт check: правка аннотации
 * пишется в байты в фоне (MuPDF в worker), и Ctrl+S во время записи не срабатывает.
 */
async function saveUntil(
  page: Page,
  path: string,
  check: (doc: PDFDocument) => boolean
): Promise<PDFDocument> {
  const read: { doc?: PDFDocument } = {}
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Control+s')
        await page.waitForTimeout(300)
        read.doc = await PDFDocument.load(await readFile(path))
        return check(read.doc)
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  if (!read.doc) throw new Error('файл не прочитан')
  return read.doc
}

/** Ждёт, пока слой страницы прочитает аннотации документа (MuPDF в worker). */
async function waitAnnotations(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => page.locator('[data-markup-layer="1"]').getAttribute('data-annotations'))
    .toBe(String(count))
}

async function sizeOf(
  page: Page,
  selector: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`нет ${selector}`)
  return box
}

/** Центр элемента в координатах окна. */
async function boxOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await sizeOf(page, selector)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

describe('заметки и аннотации документа', () => {
  it('заметка: ставится, видна на миниатюре, двигается, правится и пишется как /Text', async () => {
    const target = join(ctx.work, 'заметка.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    await tool(page, 'Заметка').click()
    await clickPage(page, 1, 0.3, 0.3)
    const popup = page.locator('[data-note-editor] textarea')
    await popup.waitFor()
    await page.keyboard.type('Проверить сумму')
    await page.keyboard.press('Escape')
    const icon = page.locator('[data-markup-layer="1"] [data-markup-kind="note"]')
    await expect.poll(() => icon.count()).toBe(1)

    // Несохранённая заметка видна на миниатюре в боковой панели и в режиме «Страницы».
    const thumbs = page.locator('[data-thumb-markup]')
    await expect.poll(() => thumbs.first().getAttribute('data-thumb-markup')).toBe('1')
    await page.keyboard.press('Control+g')
    const grid = page.locator('[aria-busy] [data-thumb-markup]')
    await expect.poll(() => grid.count()).toBe(1)
    await shot(page, 'annotations-thumbs')
    await page.keyboard.press('Control+g')
    await page.locator('[data-page="1"] canvas').first().waitFor()

    // «Выделение»: значок перетаскивается, текст правится в панели свойств.
    await tool(page, 'Выделение').click()
    const before = await boxOf(page, '[data-markup-layer="1"] [data-markup-kind="note"]')
    await page.mouse.move(before.x, before.y)
    await page.mouse.down()
    await page.mouse.move(before.x + 40, before.y + 30, { steps: 6 })
    await page.mouse.up()
    await page.locator('[data-markup-selected="note"]').waitFor()
    const after = await boxOf(page, '[data-markup-layer="1"] [data-markup-kind="note"]')
    expect(after.x - before.x).toBeCloseTo(40, -1)
    expect(after.y - before.y).toBeCloseTo(30, -1)
    const text = page.locator('#markup-note')
    await expect.poll(() => text.inputValue()).toBe('Проверить сумму')
    await text.fill('Проверить сумму в п. 3')

    // Двойной щелчок открывает окно текста на странице.
    await page.mouse.dblclick(after.x, after.y)
    await expect.poll(() => popup.inputValue()).toBe('Проверить сумму в п. 3')
    await page.keyboard.press('Escape')

    const saved = await saveAndLoad(page, target)
    expect(subtypes(saved, 0)).toEqual(['/Text', '/Popup'])
    const note = bySubtype(saved, 'Text')
    const contents = note.lookup(PDFName.of('Contents'))
    expect((contents as PDFHexString).decodeText()).toBe('Проверить сумму в п. 3')
    expect(note.get(PDFName.of('Popup'))).toBeDefined()

    // После сохранения заметка — аннотация документа: подсветка при наведении и выбор.
    await waitAnnotations(page, 1)
    await page.mouse.move(after.x - 2, after.y - 2)
    await page.mouse.move(after.x, after.y)
    await page.locator('[data-hover-frame="annotation"]').waitFor()
    await page.mouse.click(after.x, after.y)
    await page.locator('[data-annotation-selected="Text"]').waitFor()
    const field = page.locator('#annotation-text')
    await expect.poll(() => field.inputValue()).toBe('Проверить сумму в п. 3')
  })

  it('аннотации документа: перенос, размер, цвет, текст FreeText, удаление и отмена', async () => {
    const target = join(ctx.work, 'аннотации.pdf')
    await annotatedFixture(target)
    const page = await launch(target)
    await waitAnnotations(page, 3)
    const frame = '[data-annotation-selected="Square"]'

    // Прямоугольник ловится по контуру (не посередине стороны — там ручка размера)
    // и переносится на 60 пт вправо и 40 вниз.
    const [ex, ey] = share(100, 520)
    await clickPage(page, 1, ex, ey)
    await page.locator(frame).waitFor()
    const start = await boxOf(page, frame)
    await drag(page, 1, [ex, ey], share(160, 480))
    // Рамка встаёт на новое место, когда MuPDF записал правку и список перечитан.
    await expect.poll(async () => (await boxOf(page, frame)).x - start.x).toBeGreaterThan(40)

    // Ручка справа растягивает рамку; геометрию пересчитывает MuPDF.
    const moved = await sizeOf(page, frame)
    const h = await boxOf(page, '[data-markup-handle="right"]')
    await page.mouse.move(h.x, h.y)
    await page.mouse.down()
    await page.mouse.move(h.x + 120, h.y, { steps: 6 })
    await page.mouse.up()
    await expect
      .poll(async () => (await sizeOf(page, frame)).width)
      .toBeGreaterThan(moved.width + 100)

    // Цвет из панели свойств: образец отмечается, когда цвет уже в файле.
    const props = page.locator('[data-annotation-props="Square"]')
    const blue = props.getByRole('button', { name: 'Синий' })
    await blue.click()
    await expect.poll(() => blue.getAttribute('aria-pressed')).toBe('true')

    let saved = await saveUntil(page, target, (doc) => {
      const color = numbers(bySubtype(doc, 'Square'), 'C')
      return (color[2] ?? 0) > 0.7
    })
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = numbers(bySubtype(saved, 'Square'), 'Rect')
    expect(x0).toBeCloseTo(160, -1)
    expect(y0).toBeCloseTo(460, -1)
    expect(y1 - y0).toBeCloseTo(80, 0)
    expect(x1 - x0).toBeGreaterThan(150)

    // Текст FreeText с кириллицей: правится в панели, пишется по потере фокуса.
    await clickPage(page, 1, ...share(400, 620))
    await page.locator('[data-annotation-selected="FreeText"]').waitFor()
    const text = page.locator('#annotation-text')
    await expect.poll(() => text.inputValue()).toBe('Old note')
    await text.fill('Новая заметка на полях')
    await text.blur()
    await saveUntil(
      page,
      target,
      (doc) =>
        (bySubtype(doc, 'FreeText').lookup(PDFName.of('Contents')) as PDFHexString).decodeText() ===
        'Новая заметка на полях'
    )
    await shot(page, 'annotations-edited')

    // Удаление выделения строки: его нет и в файле; отмена возвращает его.
    await clickPage(page, 1, ...share(200, 766))
    await page.locator('[data-annotation-selected="Highlight"]').waitFor()
    await page.keyboard.press('Delete')
    await waitAnnotations(page, 2)
    saved = await saveUntil(page, target, (doc) => subtypes(doc, 0).length === 2)
    expect(subtypes(saved, 0)).toEqual(['/Square', '/FreeText'])
    expect((await readFile(target)).toString('latin1')).not.toContain('/Highlight')
    await page.keyboard.press('Control+z')
    await waitAnnotations(page, 3)
  })

  it('группа: Ctrl+щелчок, перенос одним шагом отмены, рамка с Shift и удаление', async () => {
    const target = join(ctx.work, 'группа.pdf')
    await annotatedFixture(target)
    const page = await launch(target)
    await waitAnnotations(page, 3)

    // Два прямоугольника разметки рядом с прямоугольником документа.
    await tool(page, 'Фигуры').click()
    await drag(page, 1, share(300, 300), share(360, 260))
    await drag(page, 1, share(400, 300), share(460, 260))
    const shapes = page.locator('[data-markup-layer="1"] svg rect')
    await expect.poll(() => shapes.count()).toBe(2)

    await tool(page, 'Выделение').click()
    await waitAnnotations(page, 3)
    await clickPage(page, 1, ...share(300, 280))
    await page.locator('[data-markup-selected="rect"]').waitFor()
    const ctrlClick = async (x: number, y: number): Promise<void> => {
      const p = await pagePoint(page, 1, ...share(x, y))
      await page.keyboard.down('Control')
      await page.mouse.click(p.x, p.y)
      await page.keyboard.up('Control')
    }
    await ctrlClick(400, 280)
    await ctrlClick(100, 540)
    await page.locator('[data-selection-group="3"]').waitFor()
    expect(await page.locator('[data-markup-selected="rect"]').count()).toBe(2)
    expect(await page.locator('[data-annotation-selected="Square"]').count()).toBe(1)

    // Перетаскивание одного объекта двигает всю группу; Ctrl+Z возвращает всё разом.
    const rect = '[data-markup-selected="rect"]'
    const square = '[data-annotation-selected="Square"]'
    const rectBefore = await boxOf(page, rect)
    const squareBefore = await boxOf(page, square)
    const shift = async (selector: string, from: { y: number }): Promise<number> =>
      (await boxOf(page, selector)).y - from.y
    await drag(page, 1, share(300, 280), share(300, 230))
    await expect.poll(() => shift(rect, rectBefore)).toBeGreaterThan(30)
    await expect.poll(() => shift(square, squareBefore)).toBeGreaterThan(30)
    expect(await page.locator('[data-selection-group="3"]').count()).toBe(1)
    await shot(page, 'annotations-group')

    await page.keyboard.press('Control+z')
    await expect.poll(async () => Math.abs(await shift(rect, rectBefore))).toBeLessThan(2)
    await expect.poll(async () => Math.abs(await shift(square, squareBefore))).toBeLessThan(2)
    await page.keyboard.press('Control+y')
    await expect.poll(() => shift(rect, rectBefore)).toBeGreaterThan(30)
    await expect.poll(() => shift(square, squareBefore)).toBeGreaterThan(30)

    // Рамка с Shift по пустому месту выбирает оба прямоугольника разметки (и только их).
    await page.keyboard.press('Escape')
    const from = await pagePoint(page, 1, ...share(280, 280))
    const to = await pagePoint(page, 1, ...share(480, 190), false)
    await page.keyboard.down('Shift')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.locator('[data-selection-group="2"]').waitFor()
    expect(await page.locator(rect).count()).toBe(2)
    expect(await page.locator(square).count()).toBe(0)

    await page.keyboard.press('Delete')
    await expect.poll(() => shapes.count()).toBe(0)

    // В файле: прямоугольник документа сдвинут на 50 пт, разметки нет.
    const saved = await saveUntil(page, target, (doc) => {
      const y = numbers(bySubtype(doc, 'Square'), 'Rect')[1] ?? 0
      return Math.abs(y - 450) < 5
    })
    expect(subtypes(saved, 0)).toEqual(['/Square', '/FreeText', '/Highlight'])
  })
})
