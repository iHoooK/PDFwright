/// <reference lib="dom" />
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, beforeEach, describe, it } from 'vitest'
import { APP_COMMAND_CHANNEL, type AppCommand } from '../../src/shared/ipc-contract'
import {
  clickPage,
  ctx,
  drag,
  launch,
  launchWithoutFile,
  pagePoint,
  scrollToShare,
  tool
} from '../e2e/helpers'
import { writeDemoDocuments } from './demo'

/**
 * Снимки экрана для инструкции по ручной проверке (docs/MANUAL_CHECK.md):
 * `npm run build && npm run docs:shots`. Программа запускается на демо-договоре
 * в окне 1280×800, каждый шаг сохраняет снимок в docs/manual-check.
 */

const OUT = resolve(import.meta.dirname, '../../docs/manual-check')
let demo: { first: string; second: string }

async function snap(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

/** Команда меню приложения, как при выборе пункта по Alt. */
async function command(name: AppCommand): Promise<void> {
  if (!ctx.app) throw new Error('программа не запущена')
  await ctx.app.evaluate(
    ({ BrowserWindow }, [channel, cmd]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(channel, cmd)
    },
    [APP_COMMAND_CHANNEL, name] as const
  )
}

async function chooseFile(path: string): Promise<void> {
  if (!ctx.app) throw new Error('программа не запущена')
  await ctx.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] })
  }, path)
}

async function settings(theme: 'light' | 'dark' = 'light'): Promise<void> {
  await mkdir(join(ctx.work, 'userData'), { recursive: true })
  await writeFile(
    join(ctx.work, 'userData', 'settings.json'),
    JSON.stringify({
      general: { language: 'ru', theme },
      window: { width: 1280, height: 800, maximized: false }
    })
  )
}

beforeEach(async () => {
  ctx.work = await mkdtemp(join(tmpdir(), 'pdfwright-tour-'))
  await mkdir(OUT, { recursive: true })
  demo = await writeDemoDocuments(ctx.work)
  await settings()
})

afterEach(async () => {
  if (ctx.app) {
    const child = ctx.app.process()
    const exited = new Promise((r) => child.once('exit', r))
    await ctx.app
      .evaluate(({ app }) => {
        setTimeout(() => {
          app.exit(0)
        }, 0)
      })
      .catch(() => undefined)
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))])
    if (child.exitCode === null) child.kill()
    ctx.app = null
  }
  await rm(ctx.work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('снимки инструкции', () => {
  it('начало и просмотр', async () => {
    const start = await launchWithoutFile()
    await snap(start, '01-start')
    await start.close().catch(() => undefined)
    if (ctx.app) await ctx.app.close().catch(() => undefined)
    ctx.app = null

    const page = await launch(demo.first)
    await snap(page, '02-viewer')
    await page.keyboard.press('Control+f')
    await page.keyboard.type('договор')
    await page.keyboard.press('Enter')
    await snap(page, '03-search')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+g')
    await page.waitForTimeout(800)
    await snap(page, '04-pages')
  })

  it('разметка', async () => {
    const page = await launch(demo.first)
    await tool(page, 'Маркер').click()
    const title = await page
      .locator('[data-page="1"] .textLayer span', { hasText: 'Договор оказания' })
      .first()
      .boundingBox()
    if (title) {
      await page.mouse.move(title.x + 2, title.y + title.height / 2)
      await page.mouse.down()
      await page.mouse.move(title.x + title.width - 2, title.y + title.height / 2, { steps: 8 })
      await page.mouse.up()
    }
    await tool(page, 'Фигуры').click()
    await drag(page, 1, [0.62, 0.36], [0.92, 0.44])
    await tool(page, 'Текст').click()
    await clickPage(page, 1, 0.62, 0.48)
    await page.locator('[data-markup-editor] textarea').waitFor()
    await page.keyboard.type('Проверить сроки')
    await page.keyboard.press('Escape')
    await tool(page, 'Заметка').click()
    await clickPage(page, 1, 0.9, 0.2)
    await page.keyboard.type('Уточнить у юриста')
    await page.keyboard.press('Escape')
    await tool(page, 'Выделение').click()
    await clickPage(page, 1, 0.75, 0.4)
    await snap(page, '05-markup')
    await tool(page, 'Подпись').click()
    await page.waitForTimeout(400)
    await snap(page, '06-signature')
  })

  it('правка содержимого', async () => {
    const page = await launch(demo.first)
    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready]').waitFor()
    await snap(page, '07-edit-mode')
    await clickPage(page, 1, 0.3, 0.2)
    await page.locator('[data-content-selected="block"]').waitFor()
    await snap(page, '08-edit-paragraph')
    const p = await pagePoint(page, 1, 0.3, 0.2)
    await page.mouse.dblclick(p.x, p.y)
    const editor = page.locator('[data-content-editor]')
    await editor.waitFor()
    await editor.press('Control+End')
    await page.keyboard.type(' Договор вступает в силу с момента подписания обеими сторонами.')
    await snap(page, '09-edit-inline')
    await editor.press('Control+Enter')
    await page.waitForTimeout(1500)
    await snap(page, '10-edit-shifted')
    await clickPage(page, 1, 0.905, 0.035)
    await page.locator('[data-content-selected="image"]').waitFor()
    await snap(page, '11-edit-image')
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'Новый текст' }).click()
    await clickPage(page, 1, 0.085, 0.82)
    await page.locator('[data-content-editor]').waitFor()
    await page.keyboard.type('Приложение № 1 — техническое задание.')
    await snap(page, '12-edit-new-text')
  })

  it('формы, свойства, защита', async () => {
    const page = await launch(demo.first)
    await scrollToShare(page, 2, 0.3)
    const fio = page.locator('[data-page="2"] input').first()
    await fio.click()
    await page.keyboard.type('Петров Пётр Петрович')
    await page.keyboard.press('Tab')
    await page.keyboard.type('+7 900 000-00-00')
    await snap(page, '13-forms')
    await command('file.properties')
    await page.getByRole('dialog', { name: 'Свойства документа' }).waitFor()
    await snap(page, '14-properties')
    await page.keyboard.press('Escape')
    await command('file.protect')
    await page.getByRole('dialog', { name: 'Защита паролем' }).waitFor()
    await snap(page, '15-protect')
  })

  it('инструменты', async () => {
    const page = await launch(demo.first)
    await command('tools.compress')
    await page.getByRole('dialog', { name: 'Сжать PDF' }).waitFor()
    await page.waitForTimeout(1500)
    await snap(page, '16-compress')
    await page.keyboard.press('Escape')
    await command('tools.ocr')
    await page.getByRole('dialog', { name: 'Распознать текст' }).waitFor()
    await snap(page, '17-ocr')
    await page.keyboard.press('Escape')
    await command('tools.toImages')
    await page.getByRole('dialog', { name: 'PDF в изображения' }).waitFor()
    await snap(page, '18-to-images')
    await page.keyboard.press('Escape')
    await command('tools.split')
    await page.waitForTimeout(500)
    await snap(page, '19-split')
    await page.keyboard.press('Escape')
    await chooseFile(demo.second)
    await command('tools.compare')
    await page.getByRole('button', { name: 'Следующее отличие' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1000)
    await snap(page, '20-compare')
  })

  it('параметры и тёмная тема', async () => {
    await settings('dark')
    const page = await launch(demo.first)
    await snap(page, '21-dark')
    await command('app.settings')
    await page.waitForTimeout(600)
    await snap(page, '22-settings')
  })
})
