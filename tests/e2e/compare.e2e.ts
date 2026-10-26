/// <reference lib="dom" />
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { ctx, launch, shot, useElectronApp } from './helpers'

/** Фаза 13: сравнение двух версий документа. */
useElectronApp()

/** Документ из pages страниц; на странице changed — фраза со словом word. */
async function version(word: string, pages = 3, changed = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i += 1) {
    const page = doc.addPage([595, 842])
    page.drawText(`Contract page ${i}`, { x: 72, y: 760, size: 24, font })
    const line =
      i === changed ? `The supplier delivers ${word} goods monthly` : 'Terms stay the same'
    page.drawText(line, { x: 72, y: 700, size: 18, font })
  }
  return doc.save()
}

/** Открывает экран сравнения: системный диалог выбора файла отдаёт path. */
async function compareWith(page: Page, path: string): Promise<ReturnType<Page['getByRole']>> {
  const app = ctx.app
  if (!app) throw new Error('приложение не запущено')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] })
  }, path)
  await page.getByRole('button', { name: 'Сравнить с…' }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Сравнение' })
  await toolbar.waitFor()
  return toolbar
}

async function listedPages(page: Page): Promise<(string | undefined)[]> {
  return page
    .locator('[data-diff-page]')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.diffPage))
}

describe('Сравнение двух версий', () => {
  it('находит отличие одним словом только на странице 2 и показывает его в тексте', async () => {
    const before = join(ctx.work, 'договор-было.pdf')
    const after = join(ctx.work, 'договор-стало.pdf')
    await writeFile(before, await version('fresh'))
    await writeFile(after, await version('frozen'))
    const page = await launch(before)
    const toolbar = await compareWith(page, after)
    await page.locator('[data-compare-done="true"]').waitFor({ timeout: 30_000 })

    // Отличие только на странице 2.
    expect(await listedPages(page)).toEqual(['2'])
    const status = (n: number): Promise<string | null> =>
      page.locator(`[data-compare-row="${n}"]`).getAttribute('data-status')
    expect([await status(1), await status(2), await status(3)]).toEqual(['same', 'changed', 'same'])
    await expect
      .poll(() => page.locator('[data-compare-row="2"] [data-diff-region]').count())
      .toBeGreaterThan(0)
    expect(await page.locator('[data-compare-row="1"] [data-diff-region]').count()).toBe(0)

    // «Следующее отличие» переходит к странице 2, панель справа показывает слова.
    await toolbar.getByRole('button', { name: 'Следующее отличие' }).click()
    const text = page.locator('[data-compare-text="2"]')
    await text.waitFor()
    await expect
      .poll(() => text.locator('del[data-diff="removed"]').allTextContents())
      .toEqual(['fresh'])
    expect(await text.locator('ins[data-diff="added"]').allTextContents()).toEqual(['frozen'])
    expect(await page.locator('[data-diff-page="2"]').getAttribute('aria-current')).toBe('true')
    await shot(page, 'compare-columns')

    // «Наложение»: маска отличий поверх страницы 2.
    await toolbar.getByRole('button', { name: 'Наложение' }).click()
    await page.locator('[data-compare-mode="overlay"]').waitFor()
    await page.locator('[data-compare-row="2"] [data-diff-mask]').waitFor({ timeout: 15_000 })
    await shot(page, 'compare-overlay')

    // Выход обратно к документу.
    await toolbar.getByRole('button', { name: 'К документу' }).click()
    await page.getByRole('toolbar', { name: 'Команды' }).waitFor()
    await page.waitForSelector('[data-page="1"] canvas')
    expect(await page.locator('[data-compare-mode]').count()).toBe(0)
  })

  it('в большом документе рисует только видимые страницы и находит отличие в конце', async () => {
    const before = join(ctx.work, 'big-before.pdf')
    const after = join(ctx.work, 'big-after.pdf')
    await writeFile(before, await version('fresh', 60, 58))
    await writeFile(after, await version('frozen', 60, 58))
    const page = await launch(before)
    const toolbar = await compareWith(page, after)

    // Сравнение идёт в фоне с прогрессом; холсты есть только у страниц рядом с экраном.
    await expect
      .poll(() => page.locator('[role="status"]').first().textContent())
      .toMatch(/Сравнено|Страниц/)
    const rendered = await page
      .locator('[data-compare-row] canvas')
      .evaluateAll((canvases) => canvases.filter((c) => (c as HTMLCanvasElement).width > 0).length)
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThanOrEqual(12)

    await page.locator('[data-compare-done="true"]').waitFor({ timeout: 90_000 })
    expect(await listedPages(page)).toEqual(['58'])
    await toolbar.getByRole('button', { name: 'Следующее отличие' }).click()
    await page.locator('[data-compare-text="58"] ins[data-diff="added"]').waitFor()
    await expect
      .poll(() =>
        page
          .locator('[data-compare-row="58"] canvas')
          .first()
          .evaluate((c) => (c as HTMLCanvasElement).width)
      )
      .toBeGreaterThan(0)
  })
})
