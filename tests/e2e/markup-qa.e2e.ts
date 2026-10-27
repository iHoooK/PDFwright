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
  tool,
  useElectronApp
} from './helpers'

/** Исправления по отчётам QA: разметка, аннотации документа, распознавание, цвета. */
useElectronApp()

const A4 = { width: 595, height: 842 }
const share = (x: number, y: number): [number, number] => [x / A4.width, 1 - y / A4.height]

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`нет ${selector}`)
  return box
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

/** Сохраняет, пока файл не станет таким, как ждёт check (правки аннотаций пишутся в фоне). */
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
        try {
          return check(read.doc)
        } catch {
          return false
        }
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  if (!read.doc) throw new Error('файл не прочитан')
  return read.doc
}

describe('исправления QA: разметка и аннотации', () => {
  it('повёрнутый вид: текстовый слой лежит на тексте, маркер выделяет заголовок (M2)', async () => {
    const target = join(ctx.work, 'поворот.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)
    await page.keyboard.press('Control+r')

    // Слой pdf.js повёрнут вместе со страницей: его рамка совпадает с рамкой страницы.
    const layer = '[data-page="1"] .textLayer'
    await expect
      .poll(async () => {
        const pageBox = await boxOf(page, '[data-page="1"]')
        const layerBox = await boxOf(page, layer)
        return (
          pageBox.width > pageBox.height &&
          Math.abs(layerBox.width - pageBox.width) < 3 &&
          Math.abs(layerBox.height - pageBox.height) < 3 &&
          Math.abs(layerBox.x - pageBox.x) < 3
        )
      })
      .toBe(true)

    // Заголовок (72…309 × 694…726 пт) в виде, повёрнутом по часовой: x = y, y = x страницы.
    const title = page.locator(`${layer} span`, { hasText: 'PDFwright test page 1' }).first()
    const pageBox = await boxOf(page, '[data-page="1"]')
    const span = await title.boundingBox()
    if (!span) throw new Error('нет заголовка в текстовом слое')
    const cx = (span.x + span.width / 2 - pageBox.x) / pageBox.width
    const cy = (span.y + span.height / 2 - pageBox.y) / pageBox.height
    expect(cx).toBeCloseTo(710 / 842, 1)
    expect(cy).toBeCloseTo(190.5 / 595, 1)

    await tool(page, 'Маркер').click()
    await drag(page, 1, [710 / 842, 76 / 595], [710 / 842, 305 / 595])
    await expect.poll(() => page.locator('[data-markup-layer="1"] svg rect').count()).toBe(1)
    await shot(page, 'qa-marker-rotated')
    const saved = await saveUntil(page, target, (doc) => annotations(doc, 0).length === 1)
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = numbers(bySubtype(saved, 'Highlight'), 'Rect')
    // Пометка легла на заголовок, а не полосой на пустое место.
    expect(x0).toBeGreaterThan(60)
    expect(x1).toBeLessThan(330)
    expect(y0).toBeGreaterThan(680)
    expect(y1).toBeLessThan(740)
  })

  it('фигура выбирается щелчком внутри, стрелки двигают, цвета и пустой текст (M8, M14, C14)', async () => {
    const target = join(ctx.work, 'фигуры.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    // Подчёркивание по умолчанию синее, выделение снова жёлтое; кнопки названы цветом.
    await tool(page, 'Маркер').click()
    await page.getByRole('radio', { name: 'Подчеркнуть' }).click()
    await expect
      .poll(() => page.getByRole('button', { name: 'Синий' }).first().getAttribute('aria-pressed'))
      .toBe('true')
    await page.getByRole('radio', { name: 'Выделить' }).click()
    await expect
      .poll(() => page.getByRole('button', { name: 'Жёлтый' }).first().getAttribute('aria-pressed'))
      .toBe('true')

    await tool(page, 'Фигуры').click()
    await drag(page, 1, share(150, 300), share(350, 200))
    const shape = page.locator('[data-markup-layer="1"] svg rect')
    await expect.poll(() => shape.count()).toBe(1)

    // Щелчок посередине пустого прямоугольника выбирает его.
    await tool(page, 'Выделение').click()
    await clickPage(page, 1, ...share(250, 250))
    const frame = '[data-markup-selected="rect"]'
    await page.locator(frame).waitFor()

    // Стрелка — шаг 1 пт, с Shift — 10 пт, по экрану.
    const start = await boxOf(page, frame)
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await boxOf(page, frame)).x - start.x).toBeGreaterThan(0.5)
    const afterRight = await boxOf(page, frame)
    const step = afterRight.x - start.x
    expect(Math.abs(afterRight.y - start.y)).toBeLessThan(0.5)
    await page.keyboard.press('Shift+ArrowDown')
    await expect
      .poll(async () => (await boxOf(page, frame)).y - afterRight.y)
      .toBeGreaterThan(step * 8)

    // Свой цвет из палитры применяется к выбранной фигуре.
    await page.locator('[data-markup-props] [data-custom-color]').fill('#123456')
    await expect.poll(() => shape.first().getAttribute('stroke')).toBe('#123456')

    // Текст, стёртый в панели, удаляет пустой блок.
    await tool(page, 'Текст').click()
    await clickPage(page, 1, ...share(150, 500))
    await page.locator('[data-markup-editor] textarea').waitFor()
    await page.keyboard.type('Привет')
    await page.keyboard.press('Escape')
    const text = page.locator('[data-markup-layer="1"] [data-markup-kind="text"]')
    await expect.poll(() => text.count()).toBe(1)
    await tool(page, 'Выделение').click()
    const textBox = await boxOf(page, '[data-markup-layer="1"] [data-markup-kind="text"]')
    await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2)
    const field = page.locator('#markup-text')
    await expect.poll(() => field.inputValue()).toBe('Привет')
    await field.fill('')
    await field.blur()
    await expect.poll(() => text.count()).toBe(0)
    await shot(page, 'qa-shapes')
  })

  it('аннотации из файла: правка FreeText двойным щелчком и концы линии (M9)', async () => {
    const target = join(ctx.work, 'аннотации.pdf')
    const doc = await PDFDocument.create()
    const pdfPage = doc.addPage([A4.width, A4.height])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    pdfPage.drawText('Annotated document', { x: 72, y: 760, size: 16, font })
    const add = (dict: Record<string, unknown>): void => {
      pdfPage.node.addAnnot(
        doc.context.register(doc.context.obj({ Type: 'Annot', ...dict } as never))
      )
    }
    add({
      Subtype: 'FreeText',
      Rect: [300, 600, 520, 640],
      Contents: PDFHexString.fromText('Old note'),
      DA: PDFString.of('/Helv 12 Tf 0 0 0 rg')
    })
    add({ Subtype: 'Line', Rect: [95, 395, 305, 405], L: [100, 400, 300, 400], C: [1, 0, 0] })
    await writeFile(target, await doc.save())
    const page = await launch(target)
    await expect
      .poll(() => page.locator('[data-markup-layer="1"]').getAttribute('data-annotations'))
      .toBe('2')

    // Линия: ручки на концах, а не рамка из восьми.
    await clickPage(page, 1, ...share(200, 400))
    await page.locator('[data-annotation-selected="Line"]').waitFor()
    expect(await page.locator('[data-markup-handle]').count()).toBe(2)
    const end = await boxOf(page, '[data-markup-handle="to"]')
    const to = await pagePoint(page, 1, ...share(300, 300), false)
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()
    let saved = await saveUntil(page, target, (d) => {
      const l = numbers(bySubtype(d, 'Line'), 'L')
      return Math.abs((l[3] ?? 0) - 300) < 8
    })
    expect(numbers(bySubtype(saved, 'Line'), 'L')[0]).toBeCloseTo(100, 0)

    // Двойной щелчок по текстовому полю — правка на месте.
    await page.keyboard.press('Escape')
    const field = await pagePoint(page, 1, ...share(400, 620))
    await page.mouse.dblclick(field.x, field.y)
    const editor = page.locator('[data-markup-editor] textarea')
    await expect.poll(() => editor.inputValue()).toBe('Old note')
    await editor.fill('Правка на месте')
    await page.keyboard.press('Escape')
    saved = await saveUntil(
      page,
      target,
      (d) =>
        (bySubtype(d, 'FreeText').lookup(PDFName.of('Contents')) as PDFHexString).decodeText() ===
        'Правка на месте'
    )
    expect(annotations(saved, 0)).toHaveLength(2)
  })

  it('подпись: точка рисуется, плитка не обрезана; распознавание на виду (M11, M13, C10, C11)', async () => {
    const target = join(ctx.work, 'подпись.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    await tool(page, 'Подпись').click()
    await page.getByRole('button', { name: 'Нарисовать…' }).click()
    const pad = page.getByRole('dialog').locator('canvas')
    const padBox = await pad.boundingBox()
    if (!padBox) throw new Error('нет холста подписи')
    // Одиночный щелчок без движения — точка.
    await page.mouse.click(padBox.x + 200, padBox.y + 100)
    await page.getByRole('button', { name: 'Сохранить подпись' }).click()
    const tile = page.getByRole('radio', { name: 'Подпись 1' })
    await tile.waitFor()
    const tileBox = await tile.boundingBox()
    const imageBox = await tile.locator('img').boundingBox()
    if (!tileBox || !imageBox) throw new Error('нет плитки подписи')
    expect(imageBox.y).toBeGreaterThanOrEqual(tileBox.y - 0.5)
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(tileBox.y + tileBox.height + 0.5)

    // Распознавание: кнопка в панели документа и предупреждение о дублировании текста.
    await page.getByRole('button', { name: 'Распознать текст…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Распознать текст' })
    await dialog.waitFor()
    expect(await dialog.locator('[data-ocr-duplicate-warning]').count()).toBe(0)
    await dialog.getByRole('switch').click()
    await dialog.locator('[data-ocr-duplicate-warning]').waitFor()
    await shot(page, 'qa-ocr-warning')
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.isVisible()).toBe(false)

    // Плитка на стартовом экране.
    await page.getByRole('tablist', { name: 'Документы' }).getByText('Начало').click()
    await page.locator('[data-start-ocr]').click()
    await dialog.waitFor()
    expect(await statusText(page)).toBeTruthy()
  })
})
