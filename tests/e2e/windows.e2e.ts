/// <reference lib="dom" />
import { copyFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clickMenuItem,
  ctx,
  launch,
  launchSecondInstance,
  launchWithoutFile,
  quitApp,
  ROOT,
  shot,
  tabNames,
  useElectronApp,
  waitForNewWindow
} from './helpers'

/** Фаза 12: несколько окон и восстановление вкладок прошлого сеанса. */
useElectronApp()

async function fixture(name: string): Promise<string> {
  const target = join(ctx.work, name)
  await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
  return target
}

describe('Окна и сеанс (собранное приложение)', () => {
  it('открывает файлы в нужных окнах и переносит вкладку в новое окно', async () => {
    const a = await fixture('первый.pdf')
    const b = await fixture('второй.pdf')
    const c = await fixture('третий.pdf')
    const first = await launch(a)

    // Файл из повторного запуска программы открывается в уже открытом окне.
    await launchSecondInstance(b)
    await expect.poll(() => tabNames(first)).toEqual(['первый.pdf', 'второй.pdf'])

    // Контекстное меню вкладки: «Открыть в новом окне».
    await first.getByRole('tab', { name: 'второй.pdf' }).click({ button: 'right' })
    const menu = first.getByRole('menu', { name: /второй\.pdf/ })
    await expect
      .poll(() => menu.getByRole('menuitem').allTextContents())
      .toEqual(['Открыть в новом окне', 'Закрыть вкладку'])
    await shot(first, 'windows-tab-menu')
    const second = await waitForNewWindow(() =>
      menu.getByRole('menuitem', { name: 'Открыть в новом окне' }).click()
    )
    await expect.poll(() => tabNames(second)).toEqual(['второй.pdf'])
    await second.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })
    await expect.poll(() => tabNames(first)).toEqual(['первый.pdf'])

    // «Файл → Новое окно», и файл из Проводника идёт в последнее активное окно.
    const third = await waitForNewWindow(() => clickMenuItem('window.new'))
    expect(await tabNames(third)).toEqual([])
    await launchSecondInstance(c)
    await expect.poll(() => tabNames(third)).toEqual(['третий.pdf'])
    await third.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })

    // Уже открытый файл не открывается второй раз: активируется его вкладка.
    await launchSecondInstance(a)
    await first.waitForTimeout(500)
    expect(await tabNames(first)).toEqual(['первый.pdf'])
    expect(await tabNames(second)).toEqual(['второй.pdf'])
    expect(await tabNames(third)).toEqual(['третий.pdf'])
    expect(ctx.app?.windows()).toHaveLength(3)
  })

  it('после выхода и запуска без файла открывает те же вкладки', async () => {
    const a = await fixture('первый.pdf')
    const b = await fixture('второй.pdf')
    const first = await launch(a)
    await launchSecondInstance(b)
    await expect.poll(() => tabNames(first)).toEqual(['первый.pdf', 'второй.pdf'])
    await first.getByRole('tab', { name: 'первый.pdf' }).click()
    await quitApp()

    const settings = JSON.parse(
      await readFile(join(ctx.work, 'userData', 'settings.json'), 'utf8')
    ) as { session: { windows: { tabs: string[]; active: number }[] } }
    expect(settings.session.windows).toEqual([expect.objectContaining({ tabs: [a, b], active: 0 })])

    const restored = await launchWithoutFile()
    await expect.poll(() => tabNames(restored)).toEqual(['первый.pdf', 'второй.pdf'])
    await expect
      .poll(() => restored.getByRole('tab', { name: 'первый.pdf' }).getAttribute('aria-selected'))
      .toBe('true')
    await restored.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })

    // Пропавший файл пропускается, окно сообщает о нём.
    await quitApp()
    await rm(b)
    const again = await launchWithoutFile()
    await again.getByText('Файлы прошлого сеанса не найдены: второй.pdf').waitFor()
    await expect.poll(() => tabNames(again)).toEqual(['первый.pdf'])
  })

  it('без переключателя «Открывать вкладки прошлого сеанса» запуск начинается с пустого окна', async () => {
    const a = await fixture('первый.pdf')
    const first = await launch(a)
    await first.getByRole('button', { name: 'Параметры', exact: true }).click()
    await first.getByText('Открывать вкладки прошлого сеанса').waitFor()
    // Резервная копия по умолчанию выключена: включён только переключатель сеанса.
    await first.getByRole('switch').filter({ hasText: 'Вкл.' }).click()
    await expect.poll(() => first.getByRole('switch').filter({ hasText: 'Вкл.' }).count()).toBe(0)
    await quitApp()

    const page = await launchWithoutFile()
    await page.waitForTimeout(1000)
    expect(await tabNames(page)).toEqual([])
  })
})
