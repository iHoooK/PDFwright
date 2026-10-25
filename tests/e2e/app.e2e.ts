/// <reference lib="dom" />
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  type PDFRawStream
} from 'pdf-lib'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Сквозные проверки собранного приложения (out/): запуск Electron с файлом
 * в аргументах, как при двойном клике в Проводнике. Перед запуском нужен
 * `npm run build`. Данные приложения — во временной папке (PDFWRIGHT_USER_DATA).
 */

const ROOT = resolve(import.meta.dirname, '../..')
let work: string
let app: ElectronApplication | null = null

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'pdfwright-e2e-'))
})

afterEach(async () => {
  if (app) {
    const child = app.process()
    const exited = new Promise((r) => child.once('exit', r))
    // app.exit не спрашивает про несохранённые документы, в отличие от закрытия окна.
    await app
      .evaluate(({ app: electronApp }) => {
        setTimeout(() => {
          electronApp.exit(0)
        }, 0)
      })
      .catch(() => undefined)
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))])
    if (child.exitCode === null) child.kill()
    app = null
  }
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

async function launch(pdfPath: string): Promise<Page> {
  app = await electron.launch({
    cwd: ROOT,
    args: ['.', pdfPath],
    env: { ...process.env, PDFWRIGHT_USER_DATA: join(work, 'userData'), ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
  // Окно уже 1100 px (раннер CI) скрывает панель свойств; тестам разметки она нужна.
  const props = page
    .getByRole('toolbar', { name: 'Команды' })
    .getByRole('button', { name: 'Свойства', exact: true })
  if ((await props.getAttribute('aria-pressed')) === 'false') await props.click()
  return page
}

async function statusText(page: Page): Promise<string> {
  return (await page.locator('footer').textContent()) ?? ''
}

/** Снимки экрана для ручной проверки: PDFWRIGHT_SHOTS=<папка>. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.PDFWRIGHT_SHOTS
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) })
}

/**
 * Точка на странице в долях её ширины и высоты, в координатах окна. Страница
 * выше экрана, поэтому документ прокручивается так, чтобы точка была видна.
 */
async function pagePoint(
  page: Page,
  pageNumber: number,
  fx: number,
  fy: number,
  scroll = true
): Promise<{ x: number; y: number }> {
  const target = page.locator(`[data-page="${pageNumber}"]`).first()
  if (scroll) await scrollToShare(page, pageNumber, fy)
  const box = await target.boundingBox()
  if (!box) throw new Error(`страница ${pageNumber} не на экране`)
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

async function scrollToShare(page: Page, pageNumber: number, fy: number): Promise<void> {
  const target = page.locator(`[data-page="${pageNumber}"]`).first()
  await target.evaluate((element, share) => {
    const scroller = element.closest('[aria-label="Документ"]')
    if (!scroller) return
    const rect = element.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    const y = rect.top + rect.height * share
    if (y < view.top + 60 || y > view.bottom - 60) {
      scroller.scrollTop += y - (view.top + view.height / 2)
    }
  }, fy)
  await page.waitForTimeout(100)
}

async function drag(
  page: Page,
  pageNumber: number,
  from: [number, number],
  to: [number, number]
): Promise<void> {
  await scrollToShare(page, pageNumber, (from[1] + to[1]) / 2)
  const a = await pagePoint(page, pageNumber, from[0], from[1], false)
  const b = await pagePoint(page, pageNumber, to[0], to[1], false)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.mouse.up()
}

async function clickPage(page: Page, pageNumber: number, fx: number, fy: number): Promise<void> {
  const p = await pagePoint(page, pageNumber, fx, fy)
  await page.mouse.click(p.x, p.y)
}

/** Подтипы аннотаций страницы и словари для проверок. */
function annotations(doc: PDFDocument, index: number): PDFDict[] {
  const annots = doc.getPage(index).node.Annots()
  return annots ? annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict)) : []
}

function subtypes(doc: PDFDocument, index: number): string[] {
  return annotations(doc, index).map((a) => a.get(PDFName.of('Subtype'))?.toString() ?? '?')
}

function tool(page: Page, name: string): ReturnType<Page['getByRole']> {
  return page.getByRole('toolbar', { name: 'Команды' }).getByRole('button', { name, exact: true })
}

describe('PDFwright (собранное приложение)', () => {
  it('открывает файл из аргументов, поворачивает страницу и сохраняет её на диск', async () => {
    const target = join(work, 'документ.pdf')
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
    const target = join(work, 'big.pdf')
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
    const target = join(work, 'разметка.pdf')
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
    expect((moved?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(50)
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
    const target = join(work, 'flatten.pdf')
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
    const target = join(work, 'подпись.pdf')
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
      await readFile(join(work, 'userData', 'settings.json'), 'utf8')
    ) as { markup: { signatures: { src: string }[] } }
    expect(settings.markup.signatures).toHaveLength(1)
    expect(settings.markup.signatures[0]?.src).toMatch(/^data:image\/png;base64,/)
  })
})
