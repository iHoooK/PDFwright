/// <reference lib="dom" />
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDict, PDFName, type PDFDocument } from 'pdf-lib'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { afterEach, beforeEach } from 'vitest'

/**
 * Общие помощники сквозных проверок собранного приложения (out/): запуск
 * Electron с файлом в аргументах, как при двойном клике в Проводнике.
 * Перед запуском нужен `npm run build`. Данные приложения — во временной
 * папке (PDFWRIGHT_USER_DATA). Каждый файл *.e2e.ts вызывает useElectronApp()
 * на верхнем уровне и берёт временную папку из ctx.work.
 */

export const ROOT = resolve(import.meta.dirname, '../..')

/** Состояние текущего теста: временная папка и запущенное приложение. */
export const ctx: { work: string; app: ElectronApplication | null } = { work: '', app: null }

/** Регистрирует подготовку и уборку: временная папка, окно 1024×768, выход из приложения. */
export function useElectronApp(): void {
  beforeEach(async () => {
    ctx.work = await mkdtemp(join(tmpdir(), 'pdfwright-e2e-'))
    // Окно как на раннере CI (экран 1024×768): масштаб и раскладка не зависят от машины.
    // Язык русский явно: по умолчанию он «как в системе», а система раннера английская.
    await mkdir(join(ctx.work, 'userData'), { recursive: true })
    await writeFile(
      join(ctx.work, 'userData', 'settings.json'),
      JSON.stringify({
        general: { language: 'ru' },
        window: { width: 1024, height: 768, maximized: false }
      })
    )
  })

  afterEach(async () => {
    if (ctx.app) {
      const child = ctx.app.process()
      const exited = new Promise((r) => child.once('exit', r))
      // app.exit не спрашивает про несохранённые документы, в отличие от закрытия окна.
      await ctx.app
        .evaluate(({ app: electronApp }) => {
          setTimeout(() => {
            electronApp.exit(0)
          }, 0)
        })
        .catch(() => undefined)
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))])
      if (child.exitCode === null) child.kill()
      ctx.app = null
    }
    await rm(ctx.work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
}

/** Запускает программу с файлом, как двойной щелчок в Проводнике, и ждёт первую страницу. */
export async function launch(pdfPath: string): Promise<Page> {
  ctx.app = await electron.launch({
    cwd: ROOT,
    args: ['.', pdfPath],
    env: {
      ...process.env,
      PDFWRIGHT_USER_DATA: join(ctx.work, 'userData'),
      ELECTRON_RENDERER_URL: ''
    }
  })
  const page = await ctx.app.firstWindow()
  await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
  // Окно уже 1100 px (раннер CI) скрывает панель свойств; тестам разметки она нужна.
  const props = page
    .getByRole('toolbar', { name: 'Команды' })
    .getByRole('button', { name: 'Свойства', exact: true })
  if ((await props.getAttribute('aria-pressed')) === 'false') await props.click()
  return page
}

export async function statusText(page: Page): Promise<string> {
  return (await page.locator('footer').textContent()) ?? ''
}

/** Снимки экрана для ручной проверки: PDFWRIGHT_SHOTS=<папка>. */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.PDFWRIGHT_SHOTS
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) })
}

/**
 * Точка на странице в долях её ширины и высоты, в координатах окна. Страница
 * выше экрана, поэтому документ прокручивается так, чтобы точка была видна.
 */
export async function pagePoint(
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

export async function scrollToShare(page: Page, pageNumber: number, fy: number): Promise<void> {
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

export async function drag(
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

export async function clickPage(
  page: Page,
  pageNumber: number,
  fx: number,
  fy: number
): Promise<void> {
  const p = await pagePoint(page, pageNumber, fx, fy)
  await page.mouse.click(p.x, p.y)
}

/** Подтипы аннотаций страницы и словари для проверок. */
export function annotations(doc: PDFDocument, index: number): PDFDict[] {
  const annots = doc.getPage(index).node.Annots()
  return annots ? annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict)) : []
}

export function subtypes(doc: PDFDocument, index: number): string[] {
  return annotations(doc, index).map((a) => a.get(PDFName.of('Subtype'))?.toString() ?? '?')
}

export function tool(page: Page, name: string): ReturnType<Page['getByRole']> {
  return page.getByRole('toolbar', { name: 'Команды' }).getByRole('button', { name, exact: true })
}

/** Окружение запуска: данные программы во временной папке теста, собранный renderer. */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return { ...env, PDFWRIGHT_USER_DATA: join(ctx.work, 'userData'), ELECTRON_RENDERER_URL: '' }
}

function requireApp(): ElectronApplication {
  if (!ctx.app) throw new Error('программа не запущена')
  return ctx.app
}

/** Ждёт интерфейс окна: строку вкладок документов. */
export async function waitForShell(page: Page): Promise<Page> {
  await page.getByRole('tablist', { name: 'Документы' }).waitFor({ timeout: 60_000 })
  return page
}

/** Запуск без файла в аргументах: так восстанавливаются окна и вкладки прошлого сеанса. */
export async function launchWithoutFile(): Promise<Page> {
  ctx.app = await electron.launch({ cwd: ROOT, args: ['.'], env: appEnv() })
  return waitForShell(await ctx.app.firstWindow())
}

/**
 * Повторный запуск программы с файлом, как двойной щелчок в Проводнике при
 * открытой программе: второй экземпляр передаёт файл первому и завершается.
 */
export async function launchSecondInstance(pdfPath: string): Promise<void> {
  const electronPath = createRequire(import.meta.url)('electron') as string
  const child = spawn(electronPath, ['.', pdfPath], { cwd: ROOT, env: appEnv(), stdio: 'ignore' })
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('второй экземпляр не завершился'))
    }, 30_000)
    child.once('exit', (exitCode) => {
      clearTimeout(timer)
      resolve(exitCode)
    })
  })
  if (code !== 0) throw new Error(`второй экземпляр завершился с кодом ${String(code)}`)
}

/** Выход как «Файл → Выход»: окна закрываются по-настоящему, сеанс записывается. */
export async function quitApp(): Promise<void> {
  const app = requireApp()
  const child = app.process()
  const exited = new Promise((r) => child.once('exit', r))
  await app
    .evaluate(({ app: electronApp }) => {
      setTimeout(() => {
        electronApp.quit()
      }, 0)
    })
    .catch(() => undefined)
  // На раннере CI запись сеанса и закрытие окон бывают заметно медленнее, чем локально.
  await Promise.race([exited, new Promise((r) => setTimeout(r, 45_000))])
  if (child.exitCode === null && child.signalCode === null) {
    const windows = await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
      .catch(() => 'неизвестно')
    throw new Error(`программа не завершилась после команды выхода (окон: ${String(windows)})`)
  }
  ctx.app = null
}

/** Нажимает пункт меню приложения по id: нативное меню Playwright не видит. */
export async function clickMenuItem(id: string): Promise<void> {
  await requireApp().evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`нет пункта меню ${itemId}`)
    // Тип click в Electron — общий Function; обработчики PDFwright аргументов не читают.
    ;(item.click as () => void)()
  }, id)
}

/** Выполняет действие и ждёт открытое им новое окно с готовым интерфейсом. */
export async function waitForNewWindow(action: () => Promise<unknown>): Promise<Page> {
  const [page] = await Promise.all([requireApp().waitForEvent('window'), action()])
  return waitForShell(page)
}

/** Имена файлов во вкладках документов окна, по порядку. */
export async function tabNames(page: Page): Promise<string[]> {
  return page
    .getByRole('tablist', { name: 'Документы' })
    .locator('[role="tab"][title]')
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('title')?.split(/[\\/]/).pop() ?? ''))
}
