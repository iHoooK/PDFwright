/// <reference lib="dom" />
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
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
    const process = app.process()
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))])
    if (process.exitCode === null) process.kill()
    app = null
  }
  await rm(work, { recursive: true, force: true })
})

async function launch(pdfPath: string): Promise<Page> {
  app = await electron.launch({
    cwd: ROOT,
    args: ['.', pdfPath],
    env: { ...process.env, PDFWRIGHT_USER_DATA: join(work, 'userData'), ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
  return page
}

async function statusText(page: Page): Promise<string> {
  return (await page.locator('footer').textContent()) ?? ''
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
})
