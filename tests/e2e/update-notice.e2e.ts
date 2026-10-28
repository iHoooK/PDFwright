/// <reference lib="dom" />
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { UPDATE_AVAILABLE_CHANNEL, type UpdateAvailable } from '../../src/shared/ipc-contract'
import { ctx, launch, shot, useElectronApp } from './helpers'

/** Предупреждение о новой версии от автоматической проверки обновлений. */
useElectronApp()

const update = (version: string, canInstall: boolean): UpdateAvailable => ({
  canInstall,
  info: {
    version,
    releaseDate: null,
    releaseNotes: null,
    size: 120_000_000,
    page: `https://github.com/iHoooK/PDFwright/releases/tag/v${version}`
  }
})

async function announce(found: UpdateAvailable): Promise<void> {
  if (!ctx.app) throw new Error('программа не запущена')
  await ctx.app.evaluate(
    ({ BrowserWindow }, [channel, payload]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
    },
    [UPDATE_AVAILABLE_CHANNEL, found] as const
  )
}

describe('обновления', () => {
  it('новая версия: предупреждение, «Позже», «Обновить» и страница релиза', async () => {
    const source = await PDFDocument.create()
    source.addPage([595, 842])
    const target = join(ctx.work, 'документ.pdf')
    await writeFile(target, await source.save())
    const page = await launch(target)
    if (!ctx.app) throw new Error('программа не запущена')
    await ctx.app.evaluate(({ shell }) => {
      const opened: string[] = []
      Object.assign(globalThis, { openedUrls: opened })
      shell.openExternal = (url: string) => {
        opened.push(url)
        return Promise.resolve()
      }
    })

    const notice = page.getByRole('alertdialog', { name: 'Доступна новая версия PDFwright' })
    await announce(update('1.0.1', true))
    await notice.waitFor()
    expect(await notice.textContent()).toContain('1.0.1')
    await shot(page, 'update-notice')
    await notice.getByRole('button', { name: 'Позже' }).click()
    await expect.poll(() => notice.count()).toBe(0)

    // Portable-версия: ссылка на страницу релиза.
    await announce(update('1.0.2', false))
    await notice.getByRole('button', { name: 'Открыть страницу релиза' }).click()
    await expect
      .poll(() => ctx.app?.evaluate(() => (globalThis as { openedUrls?: string[] }).openedUrls))
      .toEqual(['https://github.com/iHoooK/PDFwright/releases/tag/v1.0.2'])

    // Установленная: «Обновить» открывает раздел «Обновления» и начинает скачивание.
    await announce(update('1.0.3', true))
    await notice.getByRole('button', { name: 'Обновить' }).click()
    await page.getByRole('heading', { name: 'Обновления' }).waitFor()
    expect(await notice.count()).toBe(0)
    await shot(page, 'update-settings')
    await page.getByText('Проверять обновления автоматически').waitFor()
  })
})
