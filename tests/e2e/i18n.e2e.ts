/// <reference lib="dom" />
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ctx, launch, ROOT, shot, useElectronApp } from './helpers'

/** Английский интерфейс: переключение в Параметрах, перезагрузка окна, вкладки на месте. */
useElectronApp()

describe('язык интерфейса', () => {
  it('переключается на английский и открывает документ снова', async () => {
    const target = join(ctx.work, 'документ.pdf')
    await copyFile(join(ROOT, 'tests/fixtures/simple.pdf'), target)
    const page = await launch(target)

    await page.keyboard.press('Control+,')
    await page.getByLabel('Язык интерфейса').selectOption('en')
    await page.waitForURL(/lang=en/, { timeout: 20_000 })
    await page.waitForSelector('[data-page="1"] canvas', { timeout: 60_000 })

    const toolbar = page.getByRole('toolbar', { name: 'Commands' })
    await toolbar.getByRole('button', { name: 'Save', exact: true }).waitFor()
    await toolbar.getByRole('button', { name: 'Edit', exact: true }).waitFor()
    expect(await page.locator('html').getAttribute('lang')).toBe('en')
    expect(await page.locator('footer').textContent()).toContain('Page 1 of 3')
    await shot(page, 'english')

    const settings = JSON.parse(
      await readFile(join(ctx.work, 'userData', 'settings.json'), 'utf8')
    ) as {
      general: { language: string }
    }
    expect(settings.general.language).toBe('en')
  })
})
