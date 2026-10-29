/// <reference lib="dom" />
import { execFile } from 'node:child_process'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { UPDATE_AVAILABLE_CHANNEL, type UpdateAvailable } from '../../src/shared/ipc-contract'
import {
  clickMenuItem,
  clickPage,
  ctx,
  launch,
  launchWithoutFile,
  pagePoint,
  quitApp,
  ROOT,
  shot,
  statusText,
  tabNames,
  tool,
  useElectronApp,
  waitForShell
} from './helpers'

/**
 * Поведение на Mac (docs/MACOS_PLAN.md, M1): шапка с кнопками окна, файлы из
 * Finder, Dock без окон, правка текста через меню и подписи с ⌘. Работает
 * только на macOS (Mac-машины GitHub Actions); в Windows пропускается.
 *
 * Playwright на Mac передаёт ⌘V и ⌘Z в страницу вместе с командой редактора,
 * минуя строку меню. Поэтому путь «клавиша → меню» проверяется вызовом пункта
 * меню, а сами пункты — по меню, установленному в программе.
 */
useElectronApp()

const CHIP = process.arch === 'arm64' ? 'Apple Silicon' : 'Intel'

async function fixture(name: string): Promise<string> {
  const target = join(ctx.work, name)
  await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
  return target
}

function app() {
  if (!ctx.app) throw new Error('программа не запущена')
  return ctx.app
}

/** Файл из Finder или Dock: macOS присылает событие open-file. */
async function openFromFinder(path: string): Promise<void> {
  await app().evaluate(({ app: electronApp }, file) => {
    electronApp.emit('open-file', { preventDefault: () => undefined }, file)
  }, path)
}

async function windowCount(): Promise<number> {
  return app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

/** Снимок всего экрана: кнопки окна рисует macOS, в снимок страницы они не попадают. */
async function screenShot(name: string): Promise<void> {
  const dir = process.env.PDFWRIGHT_SHOTS
  if (!dir) return
  await app().evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.focus()
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  await new Promise<void>((resolve) => {
    // Без разрешения на запись экрана снимок не выйдет — это не ошибка теста.
    execFile('screencapture', ['-x', join(dir, `${name}.png`)], { timeout: 15_000 }, () => {
      resolve()
    })
  })
}

async function cssOf(page: Page, selector: string, property: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
}

describe.runIf(process.platform === 'darwin')('Mac: поведение и интерфейс', () => {
  it('шапка: отступ под кнопки окна, перетаскивание, полный экран и тёмная тема', async () => {
    const page = await launch(await fixture('документ.pdf'))
    expect(await page.evaluate(() => document.documentElement.dataset.platform)).toBe('darwin')
    expect(await cssOf(page, 'header', 'padding-left')).toBe('84px')
    expect(await cssOf(page, 'header', '-webkit-app-region')).toBe('drag')
    expect(await cssOf(page, '[role="tab"]', '-webkit-app-region')).toBe('no-drag')
    await shot(page, 'mac-titlebar')
    await screenShot('mac-screen-titlebar')

    // Полный экран: кнопок окна нет, отступ уходит.
    await app().evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setFullScreen(true)
    })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-fullscreen')), {
        timeout: 20_000
      })
      .toBe(true)
    await expect.poll(() => cssOf(page, 'header', 'padding-left')).toBe('12px')
    await shot(page, 'mac-fullscreen')
    await app().evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setFullScreen(false)
    })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-fullscreen')), {
        timeout: 20_000
      })
      .toBe(false)
    await expect.poll(() => cssOf(page, 'header', 'padding-left')).toBe('84px')

    // Тёмная тема: кнопка переключает светлую и тёмную, настройка применяется не сразу.
    const theme = (): Promise<string | undefined> =>
      page.evaluate(() => document.documentElement.dataset.theme)
    if ((await theme()) !== 'dark') {
      await page.getByRole('button', { name: 'Переключить тему' }).click()
    }
    await expect.poll(theme).toBe('dark')
    await shot(page, 'mac-dark')
    await screenShot('mac-screen-dark')
  })

  it('подписи: ⌘ вместо Ctrl, Finder, macOS и процессор в «О программе»', async () => {
    const page = await launch(await fixture('документ.pdf'))
    expect(await statusText(page)).toContain('⌘F')
    expect(await tool(page, 'Сохранить').getAttribute('title')).toBe('Сохранить (⌘S)')
    expect(await tool(page, 'Повторить').getAttribute('title')).toBe('Повторить (⇧⌘Z)')

    await page.keyboard.press('Meta+,')
    await page.getByRole('heading', { name: 'Общие' }).waitFor()
    const settings = page.locator('main')
    await expect.poll(() => settings.textContent()).toContain('⇧⌘S')
    expect(await settings.textContent()).not.toContain('Ctrl')
    await shot(page, 'mac-hotkeys')

    await page.getByRole('button', { name: 'О программе' }).click()
    await expect.poll(() => settings.textContent()).toContain(`macOS · ${CHIP}`)
    await shot(page, 'mac-about')

    await page.getByRole('button', { name: 'О разработчике' }).click()
    await expect.poll(() => settings.textContent()).toContain('сайты, игры и\u00a0программы')
    await shot(page, 'mac-author')

    await page.getByRole('tab', { name: 'Начало' }).click()
    await expect.poll(() => page.locator('main').textContent()).toContain('Finder')
    await shot(page, 'mac-start')
  })

  it('меню: программа, правка текста и «Окно»', async () => {
    await launch(await fixture('документ.pdf'))
    const menu = await app().evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).map((item) => ({
        label: item.label,
        items: (item.submenu?.items ?? []).map((sub) => (sub.role ?? sub.label).toLowerCase())
      }))
    )
    expect(menu.map((item) => item.label)).toEqual([
      'PDFwright',
      'Файл',
      'Правка',
      'Инструменты',
      'Вид',
      'Окно',
      'Справка'
    ])
    expect(menu[0]?.items).toEqual(
      expect.arrayContaining(['services', 'hide', 'hideothers', 'unhide', 'quit'])
    )
    expect(menu[2]?.items).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectall']))
    expect(menu[5]?.items).toEqual(expect.arrayContaining(['minimize', 'zoom', 'front']))
  })

  it('⌘V и ⌘Z в поле поиска правят текст, ⌘Z в документе отменяет одну операцию', async () => {
    const page = await launch(await fixture('документ.pdf'))
    // Две операции документа: поворот страницы и её копия (страниц становится 4).
    await page.keyboard.press('Meta+g')
    const pages = page.getByRole('toolbar', { name: 'Страницы' })
    await page.locator('[draggable] button').nth(0).click()
    await pages.getByRole('button', { name: 'Повернуть ↻' }).click()
    await expect.poll(() => statusText(page)).toContain('Не сохранено')
    await pages.getByRole('button', { name: 'Дублировать' }).click()
    await expect.poll(() => page.locator('[draggable] button').count()).toBe(4)
    await page.keyboard.press('Meta+g')
    await page.locator('[data-page="1"] canvas').first().waitFor()
    await expect.poll(() => statusText(page)).toContain('из 4')

    // ⌘V вставляет в поле поиска текст из буфера.
    await app().evaluate(({ clipboard }) => clipboard.writeText('PDFwright'))
    await page.keyboard.press('Meta+f')
    const search = page.getByRole('searchbox', { name: 'Поиск в документе' })
    await expect.poll(() => search.evaluate((el) => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Meta+v')
    await expect.poll(() => search.inputValue()).toBe('PDFwright')

    // ⌘Z в поле отменяет набор, а не операцию документа.
    await page.keyboard.type(' test')
    await expect.poll(() => search.inputValue()).toBe('PDFwright test')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => search.inputValue()).not.toBe('PDFwright test')
    // То же через меню: пункт «Отменить», который macOS вызывает по ⌘Z из поля.
    await search.fill('')
    await page.keyboard.type('abc')
    await clickMenuItem('edit.undo')
    await expect.poll(() => search.inputValue()).not.toBe('abc')
    expect(await statusText(page)).toContain('из 4')

    // ⌘Z вне документа (Параметры) ничего не отменяет.
    await page.keyboard.press('Meta+,')
    await page.getByRole('heading', { name: 'Общие' }).waitFor()
    await page.keyboard.press('Meta+z')
    await page.getByRole('button', { name: 'Назад к документу' }).click()
    await page.locator('[data-page="1"] canvas').first().waitFor()
    expect(await statusText(page)).toContain('из 4')

    // В документе ⌘Z отменяет ровно одну операцию: копия страницы исчезает, поворот остаётся.
    await page.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    await page.keyboard.press('Meta+z')
    await expect.poll(() => statusText(page)).toContain('из 3')
    expect(await statusText(page)).toContain('Не сохранено')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => statusText(page)).toContain('Сохранено')
    // Пункт меню «Повторить» вне поля повторяет операцию документа.
    await clickMenuItem('edit.redo')
    await expect.poll(() => statusText(page)).toContain('Не сохранено')
    expect(await statusText(page)).toContain('из 3')
  })

  it('клавиша delete (Backspace) удаляет страницы, ⌘↩ и ⌘-щелчок — в правке', async () => {
    const source = await PDFDocument.create()
    const font = await source.embedFont(StandardFonts.Helvetica)
    const sheet = source.addPage([595, 842])
    sheet.drawText('Alpha line', { x: 72, y: 760, size: 20, font })
    sheet.drawText('Beta line', { x: 72, y: 680, size: 20, font })
    source.addPage([595, 842])
    source.addPage([595, 842])
    const target = join(ctx.work, 'страницы.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)

    await page.keyboard.press('Meta+g')
    await page.locator('[draggable] button').nth(2).click()
    await page.keyboard.press('Backspace')
    await expect.poll(() => page.locator('[draggable] button').count()).toBe(2)
    await page.keyboard.press('Meta+g')
    await page.locator('[data-page="1"] canvas').first().waitFor()

    // ⌘-щелчок добавляет абзац к выбору.
    const fx = (x: number): number => x / 595
    const fy = (y: number): number => (842 - y) / 842
    await tool(page, 'Правка').click()
    await page.locator('[data-content-layer="1"][data-content-ready="2"]').waitFor()
    await clickPage(page, 1, fx(100), fy(767))
    await page.locator('[data-content-selected="block"]').waitFor()
    const beta = await pagePoint(page, 1, fx(100), fy(687))
    await page.keyboard.down('Meta')
    await page.mouse.click(beta.x, beta.y)
    await page.keyboard.up('Meta')
    await expect.poll(() => page.locator('[data-content-selected]').count()).toBe(2)
    await page.keyboard.press('Escape')

    // Новый текст: ⌘↩ — готово.
    await page.getByRole('radio', { name: 'Новый текст' }).click()
    await clickPage(page, 1, fx(72), fy(560))
    const editor = page.locator('[data-content-editor]')
    await editor.waitFor()
    await page.keyboard.type('Added on Mac')
    await page.keyboard.press('Meta+Enter')
    await expect
      .poll(() => page.locator('[data-page="1"] .textLayer').textContent(), { timeout: 20_000 })
      .toContain('Added on Mac')
  })

  it('Finder и Dock: файлы в открытом окне, программа без окон, сеанс без «призраков»', async () => {
    const a = await fixture('первый.pdf')
    const b = await fixture('второй.pdf')
    const c = await fixture('третий.pdf')
    const first = await launch(a)

    // Несколько файлов из Finder — вкладками последнего активного окна.
    await openFromFinder(b)
    await openFromFinder(c)
    await expect.poll(() => tabNames(first)).toEqual(['первый.pdf', 'второй.pdf', 'третий.pdf'])

    // Закрыли последнее окно — программа осталась в Dock.
    await app().evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await expect.poll(windowCount).toBe(0)
    expect(app().process().exitCode).toBeNull()

    // Щелчок по значку в Dock открывает пустое окно.
    const [empty] = await Promise.all([
      app().waitForEvent('window'),
      app().evaluate(({ app: electronApp }) => {
        electronApp.emit('activate', { preventDefault: () => undefined }, false)
      })
    ])
    await waitForShell(empty)
    expect(await tabNames(empty)).toEqual([])
    await openFromFinder(b)
    await expect.poll(() => tabNames(empty)).toEqual(['второй.pdf'])
    await empty.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
    await shot(empty, 'mac-dock-window')

    // Файл из Finder, когда окон нет, открывает новое окно.
    await app().evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await expect.poll(windowCount).toBe(0)
    const [reopened] = await Promise.all([app().waitForEvent('window'), openFromFinder(c)])
    await waitForShell(reopened)
    await expect.poll(() => tabNames(reopened)).toEqual(['третий.pdf'])
    await reopened.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })

    // ⌘Q и новый запуск: только окно, открытое последним, — без закрытых раньше.
    await quitApp()
    const restored = await launchWithoutFile()
    await expect.poll(() => tabNames(restored)).toEqual(['третий.pdf'])
    expect(await windowCount()).toBe(1)
  })

  it('обновление: карточка ведёт на страницу релиза и говорит про .dmg', async () => {
    const page = await launch(await fixture('документ.pdf'))
    const found: UpdateAvailable = {
      canInstall: false,
      info: {
        version: '1.0.1',
        releaseDate: null,
        releaseNotes: null,
        size: 120_000_000,
        page: 'https://github.com/iHoooK/PDFwright/releases/tag/v1.0.1'
      }
    }
    await app().evaluate(
      ({ BrowserWindow }, [channel, payload]) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
      },
      [UPDATE_AVAILABLE_CHANNEL, found] as const
    )
    const notice = page.getByRole('alertdialog', { name: 'Доступна новая версия PDFwright' })
    await notice.waitFor()
    expect(await notice.textContent()).toContain('.dmg')
    await notice.getByRole('button', { name: 'Открыть страницу релиза' }).waitFor()
    await shot(page, 'mac-update-notice')
  })
})
