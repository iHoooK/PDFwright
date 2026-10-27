/// <reference lib="dom" />
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { _electron as electron, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  ctx,
  launch,
  launchSecondInstance,
  ROOT,
  shot,
  statusText,
  tabNames,
  tool,
  useElectronApp,
  waitForShell
} from './helpers'

/** Исправления по отчёту QA просмотра: закладки, поиск, масштаб, окна, «Недавние», файлы. */
useElectronApp()

function app(): NonNullable<typeof ctx.app> {
  if (!ctx.app) throw new Error('приложение не запущено')
  return ctx.app
}

/** Три страницы без закладок: две A4 и A5 альбомная; на первой — две строки подряд. */
async function makeDocument(name: string): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const first = doc.addPage([595, 842])
  first.drawText('The parties signed', { x: 72, y: 760, size: 18, font })
  first.drawText('this contract today', { x: 72, y: 736, size: 18, font })
  doc.addPage([595, 842]).drawText('Second page', { x: 72, y: 760, size: 18, font })
  doc.addPage([595, 420]).drawText('Third page', { x: 72, y: 360, size: 18, font })
  const path = join(ctx.work, name)
  await writeFile(path, await doc.save())
  return path
}

async function command(name: string): Promise<void> {
  await app().evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:command', cmd)
  }, name)
}

async function windowTitle(): Promise<string> {
  return app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '')
}

async function recentJson(): Promise<{ path: string; pages?: number }[]> {
  try {
    return JSON.parse(await readFile(join(ctx.work, 'userData', 'recent.json'), 'utf8')) as {
      path: string
      pages?: number
    }[]
  } catch {
    return []
  }
}

const sidebar = (page: Page): ReturnType<Page['getByRole']> =>
  page.getByRole('complementary', { name: 'Боковая панель' })

describe('Просмотр: исправления QA (собранное приложение)', () => {
  it('закладки, размер текущей страницы, заголовок окна, масштаб, поиск и «Начало»', async () => {
    const target = await makeDocument('договор.pdf')
    const page = await launch(target)

    // V10: заголовок окна по документу на экране.
    await expect.poll(windowTitle).toBe('договор.pdf — PDFwright')

    // V1: документ без закладок — понятное сообщение, а не вечное «…».
    await sidebar(page).getByRole('tab', { name: 'Закладки' }).click()
    await sidebar(page).getByText('В документе нет закладок.').waitFor()

    // V3: строка состояния — размер текущей страницы (третья — A5 альбомная).
    expect(await statusText(page)).toContain('210 × 297 мм')
    await page.keyboard.press('PageDown')
    await page.keyboard.press('PageDown')
    await expect.poll(() => statusText(page)).toContain('Страница 3 из 3')
    await expect.poll(() => statusText(page)).toContain('210 × 148 мм')

    // V15: своё значение масштаба и меню режимов.
    const zoom = page.getByRole('textbox', { name: 'Масштаб, %' })
    await zoom.click()
    await zoom.fill('150')
    await zoom.press('Enter')
    await expect.poll(() => statusText(page)).toContain('150%')
    await expect.poll(() => zoom.inputValue()).toBe('150%')
    await page.getByRole('button', { name: 'Режим масштаба' }).click()
    const menu = page.getByRole('menu', { name: 'Режим масштаба' })
    await expect
      .poll(() => menu.getByRole('menuitem').allTextContents())
      .toEqual(expect.arrayContaining(['По ширине', 'Страница целиком', '200%']))
    await menu.getByRole('menuitem', { name: '200%' }).waitFor()
    await page.waitForTimeout(300)
    await shot(page, 'qa-zoom-menu')
    await menu.getByRole('menuitem', { name: '200%' }).click()
    await expect.poll(() => statusText(page)).toContain('200%')

    // V7: слова соседних строк не склеиваются, Esc сбрасывает результаты и подсветку.
    await page.keyboard.press('Control+f')
    const input = sidebar(page).getByRole('searchbox', { name: 'Поиск в документе' })
    await input.fill('signed this')
    await input.press('Enter')
    await expect.poll(() => sidebar(page).textContent()).toContain('1 из 1')
    await expect
      .poll(() => sidebar(page).textContent())
      .toContain('The parties signed this contract')
    await expect.poll(() => page.locator('.textLayer mark.highlight').count()).toBeGreaterThan(0)
    await input.press('Escape')
    await expect.poll(() => page.locator('.textLayer mark.highlight').count()).toBe(0)
    expect(await sidebar(page).textContent()).not.toContain('1 из 1')
    expect(await input.inputValue()).toBe('')

    // V14: на «Начале» строка состояния не говорит о скрытом документе.
    await page.getByRole('tab', { name: 'Начало' }).click()
    await expect.poll(() => statusText(page)).not.toContain('Страница')
    expect(await statusText(page)).not.toContain('Сохранено')
    await expect.poll(windowTitle).toBe('PDFwright')
  })

  it('«По одной»: колесо и стрелки у края страницы листают на соседнюю', async () => {
    await writeFile(
      join(ctx.work, 'userData', 'settings.json'),
      JSON.stringify({
        general: { language: 'ru' },
        window: { width: 1024, height: 768, maximized: false },
        viewer: { scrollMode: 'single', defaultZoom: 'fit-width' }
      })
    )
    const target = await makeDocument('по-одной.pdf')
    const page = await launch(target)
    const box = await page.locator('div[aria-label="Документ"]').boundingBox()
    if (!box) throw new Error('нет области документа')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    // Страница выше окна: колесо сначала прокручивает её, у нижнего края — следующая.
    for (let i = 0; i < 12 && !(await statusText(page)).includes('Страница 2'); i += 1) {
      await page.mouse.wheel(0, 600)
      await page.waitForTimeout(250)
    }
    expect(await statusText(page)).toContain('Страница 2 из 3')

    // Стрелка вверх у верхнего края возвращает на первую страницу, к её низу.
    await page.waitForTimeout(500)
    const scroller = page.locator('div[aria-label="Документ"]')
    const scrollTop = (): Promise<number> => scroller.evaluate((el) => el.scrollTop)
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => statusText(page)).toContain('Страница 1 из 3')
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2))
      .toBe(true)

    // Посреди страницы стрелка прокручивает её, а у нижнего края — листает вперёд.
    const bottom = await scrollTop()
    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowUp')
    await expect.poll(scrollTop).toBeLessThan(bottom)
    expect(await statusText(page)).toContain('Страница 1 из 3')
    await page.keyboard.press('ArrowDown')
    await expect.poll(scrollTop).toBeGreaterThanOrEqual(bottom - 2)
    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => statusText(page)).toContain('Страница 2 из 3')
  })

  it('«Страницы»: поворот вида не трогает миниатюры, флажок не закрывает страницу, подсказка у «Удалить»', async () => {
    const target = await makeDocument('страницы.pdf')
    const page = await launch(target)
    const commands = page.getByRole('toolbar', { name: 'Команды' })

    await page.keyboard.press('Control+r')
    await page.keyboard.press('Control+g')
    const frame = page.locator('[draggable] button > span').first()
    await expect.poll(async () => (await frame.boundingBox())?.height ?? 0).toBeGreaterThan(0)
    const frameBox = await frame.boundingBox()
    if (!frameBox) throw new Error('нет миниатюры')
    // A4 книжная: выше, чем шире, хотя вид повёрнут.
    expect(frameBox.height).toBeGreaterThan(frameBox.width)
    expect(
      await commands.getByRole('button', { name: 'Повернуть вид', exact: true }).isDisabled()
    ).toBe(true)

    // V16: флажок выбора — под миниатюрой.
    await page.locator('[draggable] button').first().click()
    const check = await page.locator('[draggable] button small > span').first().boundingBox()
    if (!check) throw new Error('нет флажка')
    expect(check.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height - 1)

    // V19: при выборе всех страниц видно, почему «Удалить» неактивна.
    await page.keyboard.press('Control+a')
    const pages = page.getByRole('toolbar', { name: 'Страницы' })
    await pages.getByText('Выбраны все — удалить нельзя').waitFor()
    const remove = pages.getByRole('button', { name: 'Удалить', exact: true })
    expect(await remove.isDisabled()).toBe(true)
    expect(await remove.getAttribute('title')).toContain('Все страницы удалить нельзя')
    await shot(page, 'qa-pages-all-selected')
  })

  it('несколько файлов в аргументах, «Недавние» с числом страниц, пропавший и битый файл', async () => {
    const a = await makeDocument('первый.pdf')
    const b = await makeDocument('второй.pdf')
    ctx.app = await electron.launch({
      cwd: ROOT,
      args: ['.', a, b],
      env: {
        ...process.env,
        PDFWRIGHT_USER_DATA: join(ctx.work, 'userData'),
        ELECTRON_RENDERER_URL: ''
      }
    })
    const page = await waitForShell(await ctx.app.firstWindow())

    // V9: все файлы вкладками, активна последняя.
    await expect.poll(() => tabNames(page)).toEqual(['первый.pdf', 'второй.pdf'])
    await expect
      .poll(() => page.getByRole('tab', { name: 'второй.pdf' }).getAttribute('aria-selected'))
      .toBe('true')
    await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
    await expect
      .poll(async () => (await recentJson()).map((item) => [item.path, item.pages]))
      .toEqual(
        expect.arrayContaining([
          [a, 3],
          [b, 3]
        ])
      )

    // F12/V17: битый файл не попадает в «Недавние», инструменты на его вкладке неактивны.
    const bad = join(ctx.work, 'битый.pdf')
    await writeFile(bad, 'это не PDF')
    await launchSecondInstance(bad)
    await page.getByText('Файл не является PDF или повреждён.').waitFor()
    expect(await tool(page, 'Маркер').isDisabled()).toBe(true)
    expect(await tool(page, 'Выделение').isDisabled()).toBe(true)
    expect((await recentJson()).some((item) => item.path === bad)).toBe(false)
    await page.getByRole('button', { name: 'Закрыть вкладку', exact: true }).first().click()

    // V13: в «Недавних» число страниц и значок вместо пустого квадрата.
    await page.getByRole('tab', { name: 'первый.pdf' }).click()
    await page.keyboard.press('Control+w')
    await expect.poll(() => tabNames(page)).toEqual(['второй.pdf'])
    await page.getByRole('tab', { name: 'Начало' }).click()
    const recentItem = page.getByRole('button', { name: /первый\.pdf/ }).first()
    await expect.poll(() => recentItem.textContent()).toContain('3 стр.')
    expect(await recentItem.locator('svg').count()).toBeGreaterThan(0)

    // V2: удалённый файл — «Файл не найден» и предложение убрать его из списка.
    await rm(a)
    await recentItem.click()
    await page.getByRole('heading', { name: 'Файл не найден' }).waitFor()
    expect(await page.textContent('body')).not.toContain('ENOENT')
    await shot(page, 'qa-recent-missing')
    await page.getByRole('button', { name: /Убрать из.«Недавних»/ }).click()
    await expect.poll(() => tabNames(page)).toEqual(['второй.pdf'])
    await expect.poll(async () => (await recentJson()).some((item) => item.path === a)).toBe(false)
  })

  it('«Разделить» не перезаписывает файлы, «Извлечь…» не переключает на новый файл', async () => {
    const target = await makeDocument('док.pdf')
    const page = await launch(target)

    const split = async (): Promise<void> => {
      await command('tools.split')
      const dialog = page.getByRole('dialog', { name: 'Разделить PDF' })
      await expect.poll(() => dialog.isVisible()).toBe(true)
      await dialog.getByRole('radio', { name: 'Каждую страницу отдельно' }).click()
      await dialog.getByRole('button', { name: 'Разделить', exact: true }).click()
      await expect.poll(() => dialog.textContent()).toContain('Показать в папке')
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).last().click()
      await expect.poll(() => dialog.count()).toBe(0)
    }
    await split()
    const firstPart = join(ctx.work, 'док_стр1.pdf')
    const before = (await stat(firstPart)).mtimeMs
    await split()
    // V4: вторая порция рядом под свободными именами, первая не тронута.
    for (const n of [1, 2, 3]) await stat(join(ctx.work, `док_стр${n} (2).pdf`))
    expect((await stat(firstPart)).mtimeMs).toBe(before)

    // V19: извлечённый файл открывается только по кнопке «Открыть».
    const extracted = join(ctx.work, 'извлечено.pdf')
    await app().evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath })
    }, extracted)
    await page.keyboard.press('Control+g')
    await page.locator('[draggable] button').first().click()
    await page
      .getByRole('toolbar', { name: 'Страницы' })
      .getByRole('button', { name: 'Извлечь…' })
      .click()
    const open = page.getByRole('status').getByRole('button', { name: 'Открыть' })
    await open.waitFor()
    await stat(extracted)
    expect(await tabNames(page)).toEqual(['док.pdf'])
    expect((await recentJson()).some((item) => item.path === join(ctx.work, 'док_стр1.pdf'))).toBe(
      false
    )
    await open.click()
    await expect.poll(() => tabNames(page)).toEqual(['док.pdf', 'извлечено.pdf'])
  })

  it('«О программе»: падеж, диагностика, Markdown в лицензиях; свойства в низком окне', async () => {
    const target = await makeDocument('свойства.pdf')
    const page = await launch(target)

    // V18: кнопки «Свойств документа» видны и в окне минимальной высоты.
    await app().evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(900, 600)
    })
    await page.waitForTimeout(300)
    await command('file.properties')
    const props = page.getByRole('dialog', { name: 'Свойства документа' })
    await expect.poll(() => props.isVisible()).toBe(true)
    const apply = await props.getByRole('button', { name: 'Записать' }).boundingBox()
    const viewport = await page.evaluate(() => window.innerHeight)
    if (!apply) throw new Error('нет кнопки «Записать»')
    expect(apply.y + apply.height).toBeLessThanOrEqual(viewport)
    await shot(page, 'qa-properties-small')
    await props.getByRole('button', { name: 'Закрыть', exact: true }).last().click()

    // V12, V11: «версия для разработки», подписи диагностики из словаря.
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: 'О программе' }).click()
    await page.getByText(/Windows x64 · версия для разработки/).waitFor()
    await page.getByRole('button', { name: 'Скопировать диагностику' }).click()
    await expect
      .poll(() => app().evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('Тип сборки: версия для разработки')

    // V8: перечень компонентов — таблица, а не сырой Markdown.
    await page.getByRole('button', { name: /Лицензии и.приватность/ }).click()
    const licenses = page.getByRole('dialog', { name: /Лицензии и.приватность/ })
    await licenses.getByRole('tab', { name: 'Сторонние компоненты' }).click()
    await expect.poll(() => licenses.locator('table').count()).toBeGreaterThanOrEqual(2)
    await licenses.getByRole('heading', { name: 'Сторонние компоненты' }).waitFor()
    expect(await licenses.textContent()).not.toMatch(/\| ?---|# /)
    await licenses.getByRole('tab', { name: 'Приватность' }).click()
    await licenses.getByRole('heading', { name: 'Приватность — PDFwright' }).waitFor()
    expect(await licenses.locator('code').count()).toBeGreaterThan(0)
    await shot(page, 'qa-licenses')
  })
})
