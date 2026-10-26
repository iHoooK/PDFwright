/// <reference lib="dom" />
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFStream, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { readFormFields, readMetadata } from '../../src/shared/pdf-ops'
import { ctx, launch, shot, statusText, tool, useElectronApp } from './helpers'

/** Фаза 5: заполнение форм на странице, запись значений и редактор метаданных. */
useElectronApp()

/** Анкета со всеми видами полей — как её делают конструкторы форм. */
async function formFile(name: string): Promise<string> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Form test', { x: 50, y: 800, size: 18, font })
  const form = doc.getForm()
  const field = form.createTextField('name')
  field.addToPage(page, { x: 50, y: 740, width: 300, height: 24, font })
  field.setFontSize(12)
  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(page, { x: 50, y: 640, width: 300, height: 80, font })
  notes.setFontSize(11)
  form.createCheckBox('agree').addToPage(page, { x: 50, y: 600, width: 18, height: 18 })
  const size = form.createRadioGroup('size')
  size.addOptionToPage('S', page, { x: 50, y: 560, width: 16, height: 16 })
  size.addOptionToPage('M', page, { x: 90, y: 560, width: 16, height: 16 })
  const city = form.createDropdown('city')
  city.addOptions(['Moscow', 'Kazan'])
  city.addToPage(page, { x: 50, y: 510, width: 200, height: 24, font })
  city.setFontSize(12)
  const colors = form.createOptionList('colors')
  colors.addOptions(['Red', 'Green', 'Blue'])
  colors.enableMultiselect()
  colors.addToPage(page, { x: 50, y: 400, width: 200, height: 80, font })
  colors.setFontSize(12)
  doc.setTitle('Анкета')
  const target = join(ctx.work, name)
  await writeFile(target, await doc.save())
  return target
}

/** Шрифт внешнего вида поля: без встроенного шрифта кириллица не видна в других программах. */
async function appearanceFont(bytes: Uint8Array, name: string): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const widget = doc.getForm().getField(name).acroField.getWidgets()[0]
  const normal = widget?.getAppearances()?.normal
  if (!(normal instanceof PDFStream)) return ''
  const resources = normal.dict.lookup(PDFName.of('Resources'), PDFDict)
  const fonts = resources.lookup(PDFName.of('Font'), PDFDict)
  const [key] = fonts.keys()
  return key ? String(fonts.lookup(key, PDFDict).get(PDFName.of('BaseFont'))) : ''
}

describe('Формы и метаданные (собранное приложение)', () => {
  it('заполняет поля по-русски, отменяет и повторяет правки, сохраняет значения', async () => {
    const target = await formFile('анкета.pdf')
    const page = await launch(target)
    const layer = page.locator('[data-page="1"] [data-forms-layer]')
    const nameInput = layer.locator('input[name="name"]')
    await nameInput.waitFor({ timeout: 20_000 })
    await expect.poll(() => page.locator('[data-forms-panel]').textContent()).toContain('6')

    await nameInput.click()
    await page.keyboard.type('Иван Петров')
    await layer.locator('textarea[name="notes"]').fill('Первая строка\nВторая строка')
    await layer.locator('input[name="agree"]').check({ force: true })
    await layer.locator('input[name="size"]').nth(1).check({ force: true })
    const city = layer.locator('select[name="city"]')
    await city.selectOption('Kazan')
    await layer.locator('select[name="colors"]').selectOption(['Red', 'Blue'])
    await expect.poll(() => statusText(page)).toContain('Не сохранено')
    await shot(page, 'forms-filled')

    // Ctrl+Z в поле отменяет шаг документа, Ctrl+Y возвращает его.
    await city.focus()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect.poll(() => city.inputValue()).not.toBe('Kazan')
    await page.keyboard.press('Control+y')
    await page.keyboard.press('Control+y')
    await expect.poll(() => city.inputValue()).toBe('Kazan')
    await expect.poll(() => nameInput.inputValue()).toBe('Иван Петров')

    // Набор текста в поле — один шаг: шесть отмен убирают все шесть правок.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Control+z')
    await expect.poll(() => nameInput.inputValue()).toBe('')
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Control+y')
    await expect.poll(() => nameInput.inputValue()).toBe('Иван Петров')
    await expect.poll(() => city.inputValue()).toBe('Kazan')
    // После перерисовки слоя флажок по-прежнему показывает свой вид (холсты pdf.js).
    const agree = layer.locator('input[name="agree"]')
    expect(await agree.isChecked()).toBe(true)
    expect(await agree.evaluate((e) => e.parentElement?.querySelectorAll('canvas').length)).toBe(2)

    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')

    const bytes = new Uint8Array(await readFile(target))
    const values = Object.fromEntries((await readFormFields(bytes)).map((f) => [f.name, f.value]))
    expect(values).toEqual({
      name: 'Иван Петров',
      notes: 'Первая строка\nВторая строка',
      agree: 'Yes',
      size: 'M',
      city: ['Kazan'],
      colors: ['Red', 'Blue']
    })
    expect(await appearanceFont(bytes, 'name')).toMatch(/PTSans/)

    // После сохранения поля показывают записанные значения из файла.
    await expect.poll(() => nameInput.inputValue(), { timeout: 15_000 }).toBe('Иван Петров')
    expect(await layer.locator('input[name="agree"]').isChecked()).toBe(true)
  })

  it('поля не мешают другим инструментам и вплавляются в страницу', async () => {
    const target = await formFile('flatten.pdf')
    const page = await launch(target)
    const layer = page.locator('[data-page="1"] [data-forms-layer]')
    await layer.locator('input[name="name"]').waitFor({ timeout: 20_000 })
    await layer.locator('input[name="name"]').fill('Мария')

    await tool(page, 'Перо').click()
    await expect.poll(() => layer.getAttribute('class')).toMatch(/disabled/)
    await tool(page, 'Выделение').click()
    await expect.poll(() => layer.getAttribute('class')).not.toMatch(/disabled/)

    await page.locator('[data-forms-panel]').getByRole('button', { name: 'Вплавить поля' }).click()
    await expect.poll(() => layer.locator('input').count(), { timeout: 15_000 }).toBe(0)
    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')
    expect(await readFormFields(new Uint8Array(await readFile(target)))).toEqual([])
    await expect
      .poll(() => page.locator('[data-page="1"] .textLayer').textContent())
      .toContain('Мария')
  })

  it('меняет и очищает метаданные документа', async () => {
    const target = await formFile('метаданные.pdf')
    const page = await launch(target)
    const openDialog = async (): Promise<void> => {
      await page.getByRole('button', { name: 'Свойства документа' }).first().click()
      await expect
        .poll(() => page.locator('#meta-title').inputValue(), { timeout: 10_000 })
        .toBe('Анкета')
    }
    await openDialog()
    await page.locator('#meta-title').fill('Договор аренды')
    await page.locator('#meta-author').fill('Иван Петров')
    await page.locator('#meta-subject').fill('Аренда квартиры')
    await page.locator('#meta-keywords').fill('договор, аренда')
    await page.locator('#meta-creator').fill('Редактор')
    await shot(page, 'forms-metadata')
    await page.getByRole('button', { name: 'Записать' }).click()
    await expect.poll(() => page.locator('#meta-title').count()).toBe(0)
    await expect.poll(() => statusText(page)).toContain('Не сохранено')
    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')
    expect(await readMetadata(new Uint8Array(await readFile(target)))).toEqual({
      title: 'Договор аренды',
      author: 'Иван Петров',
      subject: 'Аренда квартиры',
      keywords: 'договор, аренда',
      creator: 'Редактор'
    })

    // Отмена возвращает прежние метаданные, «Очистить» удаляет все.
    await page.getByRole('button', { name: 'Свойства документа' }).first().click()
    await expect
      .poll(() => page.locator('#meta-title').inputValue(), { timeout: 10_000 })
      .toBe('Договор аренды')
    await page.getByRole('button', { name: 'Очистить метаданные' }).click()
    await expect.poll(() => page.locator('#meta-title').inputValue(), { timeout: 10_000 }).toBe('')
    await page.keyboard.press('Escape')
    await tool(page, 'Сохранить').click()
    await expect.poll(() => statusText(page), { timeout: 15_000 }).toContain('Сохранено')
    const cleared = await PDFDocument.load(await readFile(target), { updateMetadata: false })
    expect(cleared.getTitle()).toBeUndefined()
    expect(cleared.getAuthor()).toBeUndefined()
    expect(cleared.catalog.has(PDFName.of('Metadata'))).toBe(false)
  })
})
