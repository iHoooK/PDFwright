/// <reference lib="dom" />
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { _electron as electron, type Page } from 'playwright'
import { afterEach, beforeEach, describe, it } from 'vitest'
import { APP_COMMAND_CHANNEL, type AppCommand } from '../../src/shared/ipc-contract'
import { clickPage, ctx, drag, pagePoint, ROOT, scrollToShare, tool } from '../e2e/helpers'
import { writeDemoDocuments } from './demo'
import { writeShowcaseReport, writeSignaturePng } from './showcase'

/**
 * Снимки для сайта и рекламы: `npm run build && npm run site:shots`. Окно
 * 1440×900 с масштабом 2, поэтому картинки 2880×1800 — чёткие и на экранах
 * с высокой плотностью. Документы — демо-отчёт и демо-договор, без личных данных.
 */

const OUT = resolve(import.meta.dirname, '../../marketing/screenshots')
let files: { report: string; contract: string; contract2: string; signature: string | null }

async function snap(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0)
  await page
    .locator('[role="status"]')
    .first()
    .waitFor({ state: 'detached', timeout: 8_000 })
    .catch(() => undefined)
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

async function start(
  open: readonly string[],
  options: { theme?: 'light' | 'dark'; language?: 'ru' | 'en' } = {}
): Promise<Page> {
  await mkdir(join(ctx.work, 'userData'), { recursive: true })
  await writeFile(
    join(ctx.work, 'userData', 'settings.json'),
    JSON.stringify({
      general: { language: options.language ?? 'ru', theme: options.theme ?? 'light' },
      updates: { autoCheck: false }
    })
  )
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  ctx.app = await electron.launch({
    cwd: ROOT,
    args: ['--force-device-scale-factor=2', '.', ...open],
    env: { ...env, PDFWRIGHT_USER_DATA: join(ctx.work, 'userData'), ELECTRON_RENDERER_URL: '' }
  })
  const page = await ctx.app.firstWindow()
  // Строка вкладок на любом языке интерфейса.
  await page.locator('[role="tablist"]').first().waitFor({ timeout: 60_000 })
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.unmaximize()
    window?.setContentSize(1440, 900)
    window?.setPosition(0, 0)
  })
  if (open.length > 0) {
    await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
    const english = options.language === 'en'
    const props = page
      .getByRole('toolbar', { name: english ? 'Commands' : 'Команды' })
      .getByRole('button', { name: english ? 'Properties' : 'Свойства', exact: true })
    if ((await props.getAttribute('aria-pressed')) === 'false') await props.click()
  }
  await page.waitForTimeout(800)
  return page
}

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

async function selectText(page: Page, pageNumber: number, text: string): Promise<void> {
  const span = page.locator(`[data-page="${String(pageNumber)}"] .textLayer span`, {
    hasText: text
  })
  const box = await span.first().boundingBox()
  if (!box) throw new Error(`нет текста «${text}»`)
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

beforeEach(async () => {
  // Папка в корне диска: на снимках путь к файлу без имени пользователя Windows.
  ctx.work = await mkdtemp(join(parse(OUT).root, 'PDFwright-demo-'))
  await mkdir(OUT, { recursive: true })
  const demo = await writeDemoDocuments(ctx.work)
  files = {
    report: await writeShowcaseReport(ctx.work),
    contract: demo.first,
    contract2: demo.second,
    signature: await writeSignaturePng(ctx.work)
  }
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

describe('снимки для сайта', () => {
  it('начало, просмотр и правка документа', async () => {
    const page = await start([files.contract, files.report])
    await page.getByRole('tab', { name: 'Начало' }).click()
    await page.waitForTimeout(800)
    await snap(page, '01-nachalo')
    await page.getByRole('tab', { name: 'Отчёт 2026.pdf' }).click()
    await page.locator('[data-page="1"] canvas').first().waitFor()
    await snap(page, '02-prosmotr')

    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready]').waitFor()
    const intro = await pagePoint(page, 1, 0.4, 0.215)
    await page.mouse.dblclick(intro.x, intro.y)
    const editor = page.locator('[data-content-editor]')
    await editor.waitFor()
    await editor.press('Control+End')
    await page.keyboard.type(' Отдельное спасибо всем клиентам за доверие!')
    await snap(page, '03-pravka-teksta')
    await editor.press('Control+Enter')
    await page.waitForTimeout(1500)
    await clickPage(page, 1, 0.4, 0.215)
    await page.locator('[data-content-selected="block"]').waitFor()
    await snap(page, '04-pravka-abzaca')
    await page.keyboard.press('Escape')
    await clickPage(page, 1, 0.75, 0.58)
    await page.locator('[data-content-selected="image"]').waitFor()
    await snap(page, '05-pravka-kartinok')
    await page.keyboard.press('Escape')
  })

  it('разметка и подпись', async () => {
    const page = await start([files.contract, files.report])
    await scrollToShare(page, 1, 0.6)
    await tool(page, 'Маркер').click()
    await selectText(page, 1, 'Главные проекты')
    await tool(page, 'Фигуры').click()
    await page.getByRole('button', { name: 'Красный' }).first().click()
    await drag(page, 1, [0.065, 0.405], [0.5, 0.635])
    await tool(page, 'Текст').click()
    await page.getByRole('button', { name: 'Красный' }).first().click()
    await clickPage(page, 1, 0.12, 0.43)
    await page.locator('[data-markup-editor] textarea').waitFor()
    await page.keyboard.type('Рекордный год!')
    await page.keyboard.press('Escape')
    await tool(page, 'Заметка').click()
    await clickPage(page, 1, 0.9, 0.665)
    await page.keyboard.type('Добавить фото с фестиваля')
    await page.keyboard.press('Escape')
    await tool(page, 'Выделение').click()
    await page.keyboard.press('Escape')
    await scrollToShare(page, 1, 0.55)
    await snap(page, '06-razmetka')

    await page.getByRole('tab', { name: 'Договор.pdf' }).click()
    await page.locator('[data-page="1"] canvas').first().waitFor()
    await tool(page, 'Подпись').click()
    if (files.signature) {
      await page.locator('[data-signature-input]').setInputFiles(files.signature)
    } else {
      await page.getByRole('button', { name: 'Нарисовать…' }).click()
      const pad = page.getByRole('dialog').locator('canvas')
      const box = await pad.boundingBox()
      if (!box) throw new Error('нет холста подписи')
      await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6)
      await page.mouse.down()
      for (let i = 0; i <= 80; i += 1) {
        const t = i / 80
        await page.mouse.move(
          box.x + box.width * (0.15 + 0.7 * t),
          box.y + box.height * (0.55 - Math.sin(t * Math.PI * 6) * 0.15),
          { steps: 2 }
        )
      }
      await page.mouse.up()
      await page.getByRole('button', { name: 'Сохранить подпись' }).click()
    }
    await page.getByRole('radio', { name: 'Подпись 1' }).waitFor()
    await clickPage(page, 1, 0.78, 0.845)
    await page.waitForTimeout(500)
    await snap(page, '07-podpis')
  })

  it('формы, страницы, распознавание, защита', async () => {
    const page = await start([files.contract])
    await scrollToShare(page, 2, 0.3)
    const inputs = page.locator('[data-page="2"] input')
    await inputs.first().click()
    await page.keyboard.type('Петров Пётр Петрович')
    await page.keyboard.press('Tab')
    await page.keyboard.type('+7 900 123-45-67')
    await page.locator('[data-page="2"] select').first().selectOption('Kazan')
    await page.locator('[data-page="2"] input[type="checkbox"]').first().click()
    await snap(page, '08-formy')

    await page.keyboard.press('Control+g')
    await page.waitForTimeout(800)
    await page.locator('[draggable] button').nth(2).click()
    await chooseFile(files.report)
    await page.getByRole('button', { name: 'Вставить из файла…' }).click()
    await page.waitForTimeout(2000)
    await page.locator('[draggable] button').nth(3).click()
    await page.keyboard.down('Control')
    await page.locator('[draggable] button').nth(4).click()
    await page.keyboard.up('Control')
    await page.waitForTimeout(800)
    await snap(page, '09-stranicy')
    await page.keyboard.press('Control+g')
    await page.waitForTimeout(600)

    await scrollToShare(page, 3, 0.5)
    await command('tools.ocr')
    const ocr = page.getByRole('dialog', { name: 'Распознать текст' })
    await ocr.waitFor()
    await ocr.getByRole('radio', { name: /Текущая/ }).click()
    await ocr.getByRole('button', { name: 'Распознать', exact: true }).click()
    await ocr.waitFor({ state: 'hidden', timeout: 90_000 })
    await page.keyboard.press('Control+f')
    const search = page.getByPlaceholder('Поиск в документе')
    await search.fill('выполнены')
    await search.press('Enter')
    await page.waitForTimeout(800)
    await snap(page, '10-raspoznavanie')
    await page.keyboard.press('Escape')

    await command('file.protect')
    const protect = page.getByRole('dialog', { name: 'Защита паролем' })
    await protect.waitFor()
    const fields = protect.locator('input[type="password"]')
    await fields.nth(0).fill('Sever2026')
    await fields.nth(1).fill('Sever2026')
    await fields.nth(2).fill('Owner-2026')
    await snap(page, '11-zashchita-parolem')
  })

  it('сравнение и сжатие', async () => {
    const report = await start([files.report])
    await command('tools.compress')
    await report.getByRole('dialog', { name: 'Сжать PDF' }).waitFor()
    await report.waitForTimeout(2500)
    await snap(report, '13-szhatie')
    if (ctx.app) await ctx.app.close().catch(() => undefined)
    ctx.app = null

    const page = await start([files.contract])
    await chooseFile(files.contract2)
    await command('tools.compare')
    await page.getByRole('button', { name: 'Следующее отличие' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1200)
    await snap(page, '12-sravnenie')
  })

  it('тёмная тема и английский интерфейс', async () => {
    const dark = await start([files.report], { theme: 'dark' })
    await tool(dark, 'Правка').click()
    await dark.locator('[data-content-layer="1"][data-content-ready]').waitFor()
    await clickPage(dark, 1, 0.3, 0.355)
    await snap(dark, '14-temnaya-tema')
    if (ctx.app) await ctx.app.close().catch(() => undefined)
    ctx.app = null

    const english = await start([files.report], { language: 'en' })
    await snap(english, '15-english')
  })
})
