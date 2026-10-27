import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as mupdf from 'mupdf'
import fontkit from '@pdf-lib/fontkit'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts
} from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { descenderSafe } from '@shared/pdf-ops/forms'
import {
  applyFormValues,
  clearMetadata,
  FORM_OFF,
  PdfOpsError,
  readFormFields,
  readMetadata,
  writeMetadata
} from '@shared/pdf-ops'

const ROOT = resolve(import.meta.dirname, '../..')

let font: Uint8Array

beforeAll(async () => {
  font = new Uint8Array(
    await readFile(resolve(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  )
})

/** Форма со всеми видами полей: так её рисуют конструкторы форм. */
async function formFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()
  const name = form.createTextField('name')
  name.addToPage(page, { x: 50, y: 760, width: 300, height: 24, font: helvetica })
  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(page, { x: 50, y: 640, width: 300, height: 90, font: helvetica })
  // addToPage подбирает кегль по высоте поля: для многострочного это 78 пт.
  notes.setFontSize(12)
  const short = form.createTextField('short')
  short.setMaxLength(4)
  short.addToPage(page, { x: 380, y: 760, width: 80, height: 24, font: helvetica })
  form.createCheckBox('agree').addToPage(page, { x: 50, y: 600, width: 18, height: 18 })
  const size = form.createRadioGroup('size')
  size.addOptionToPage('S', page, { x: 50, y: 560, width: 16, height: 16 })
  size.addOptionToPage('M', page, { x: 90, y: 560, width: 16, height: 16 })
  const city = form.createDropdown('city')
  city.addOptions(['Moscow', 'Kazan'])
  city.addToPage(page, { x: 50, y: 510, width: 200, height: 24, font: helvetica })
  const colors = form.createOptionList('colors')
  colors.addOptions(['Red', 'Green', 'Blue'])
  colors.enableMultiselect()
  colors.addToPage(page, { x: 50, y: 400, width: 200, height: 80, font: helvetica })
  return doc.save()
}

function byName(fields: Awaited<ReturnType<typeof readFormFields>>): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.name, f.value]))
}

/** Текст страницы глазами другого просмотрщика (MuPDF рисует вид полей). */
function pageText(bytes: Uint8Array): string {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  const page = doc.loadPage(0)
  const text = page.toStructuredText('preserve-whitespace').asText()
  page.destroy()
  doc.destroy()
  return text
}

/** Шрифт внешнего вида первого виджета поля (BaseFont из ресурсов /AP /N). */
async function appearanceFont(bytes: Uint8Array, name: string): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const widget = doc.getForm().getField(name).acroField.getWidgets()[0]
  const normal = widget?.getAppearances()?.normal
  if (!(normal instanceof PDFStream)) return ''
  const fonts = normal.dict
    .lookup(PDFName.of('Resources'), PDFDict)
    .lookup(PDFName.of('Font'), PDFDict)
  const [key] = fonts.keys()
  if (!key) return ''
  return String(fonts.lookup(key, PDFDict).get(PDFName.of('BaseFont')))
}

/** Вплавление виджетов средствами MuPDF — рисует именно записанный нами вид. */
function mupdfFlatten(bytes: Uint8Array): Uint8Array {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()
  if (!doc) throw new Error('не PDF')
  doc.bake()
  const out = doc.saveToBuffer('').asUint8Array().slice()
  doc.destroy()
  return out
}

describe('applyFormValues', () => {
  it('читает поля всех видов', async () => {
    const fields = await readFormFields(await formFixture())
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ['name', 'text'],
      ['notes', 'text'],
      ['short', 'text'],
      ['agree', 'checkbox'],
      ['size', 'radio'],
      ['city', 'dropdown'],
      ['colors', 'list']
    ])
    expect(fields.find((f) => f.name === 'size')?.options).toEqual(['S', 'M'])
    expect(byName(fields).agree).toBe(FORM_OFF)
  })

  it('записывает значения на кириллице и обновляет вид полей шрифтом PT Sans', async () => {
    const bytes = await applyFormValues(
      await formFixture(),
      {
        name: 'Иван Петров',
        notes: 'Первая строка\nВторая строка',
        short: 'абвгдеж',
        agree: 'Yes',
        size: 'M',
        city: 'Kazan',
        colors: ['Red', 'Blue']
      },
      { font }
    )
    expect(byName(await readFormFields(bytes))).toEqual({
      name: 'Иван Петров',
      notes: 'Первая строка\nВторая строка',
      // Длина ограничена полем: лишнее обрезается, а не роняет запись.
      short: 'абвг',
      agree: 'Yes',
      size: 'M',
      city: ['Kazan'],
      colors: ['Red', 'Blue']
    })
    expect(await appearanceFont(bytes, 'name')).toMatch(/PTSans/)
    // Вид поля читается другим движком: MuPDF вплавляет виджеты и находит текст.
    const text = pageText(mupdfFlatten(bytes))
    expect(text).toContain('Иван Петров')
    expect(text).toContain('Вторая строка')
  })

  it('пустые значения снимают отметки и очищают поля', async () => {
    const filled = await applyFormValues(
      await formFixture(),
      { name: 'Анна', agree: 'Yes', size: 'S', colors: ['Green'] },
      { font }
    )
    const cleared = await applyFormValues(
      filled,
      { name: '', agree: FORM_OFF, size: FORM_OFF, colors: [] },
      { font }
    )
    expect(byName(await readFormFields(cleared))).toMatchObject({
      name: '',
      agree: FORM_OFF,
      size: FORM_OFF,
      colors: []
    })
  })

  it('свой вариант выпадающего списка делает его редактируемым', async () => {
    const bytes = await applyFormValues(await formFixture(), { city: 'Самара' }, { font })
    expect(byName(await readFormFields(bytes)).city).toEqual(['Самара'])
  })

  it('flatten вплавляет поля: полей нет, значения видны на странице', async () => {
    const bytes = await applyFormValues(
      await formFixture(),
      { name: 'Мария', agree: 'Yes' },
      { font, flatten: true }
    )
    expect(await readFormFields(bytes)).toEqual([])
    expect(pageText(bytes)).toContain('Мария')
  })

  it('неизвестное поле и вариант дают понятную ошибку', async () => {
    const fixture = await formFixture()
    await expect(applyFormValues(fixture, { nope: 'x' }, { font })).rejects.toBeInstanceOf(
      PdfOpsError
    )
    await expect(applyFormValues(fixture, { size: 'XL' }, { font })).rejects.toThrow(/XL/)
  })

  it('flatten убирает виджеты из /Annots: ссылок на удалённые объекты нет', async () => {
    const bytes = await applyFormValues(
      await formFixture(),
      { name: 'Мария', agree: 'Yes', city: 'Kazan' },
      { font, flatten: true }
    )
    const doc = await PDFDocument.load(bytes)
    const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    const refs = annots ? annots.asArray() : []
    expect(refs.filter((ref) => ref instanceof PDFRef && !doc.context.lookup(ref))).toEqual([])
    expect(refs).toEqual([])
    // MuPDF открывает страницу без «cannot find object in xref».
    const mu = new mupdf.PDFDocument(bytes)
    const page = mu.loadPage(0)
    expect(page.getAnnotations()).toEqual([])
    expect(page.getWidgets()).toEqual([])
    page.destroy()
    mu.destroy()
  })

  it('вид однострочного поля не обрезает нижние выносные элементы', async () => {
    // Как в демо-договоре: поле высотой 25 пт, кегль 18 пт, рамка 1 пт.
    const source = await PDFDocument.create()
    const page = source.addPage([595, 842])
    const helvetica = await source.embedFont(StandardFonts.Helvetica)
    const form = source.getForm()
    const fio = form.createTextField('fio')
    fio.addToPage(page, { x: 160, y: 693, width: 281, height: 25, font: helvetica })
    fio.setFontSize(18)
    const city = form.createDropdown('city')
    city.addOptions(['Saint Petersburg'])
    city.addToPage(page, { x: 160, y: 593, width: 181, height: 25, font: helvetica })
    city.setFontSize(18)
    const bytes = await applyFormValues(
      await source.save(),
      { fio: 'Иванов Дмитрий', city: 'Saint Petersburg' },
      { font }
    )

    const probe = await PDFDocument.create()
    probe.registerFontkit(fontkit)
    const pt = await probe.embedFont(font)
    const descent = pt.heightAtSize(18) - pt.heightAtSize(18, { descender: false })
    const doc = await PDFDocument.load(bytes)
    for (const name of ['fio', 'city']) {
      const normal = doc
        .getForm()
        .getField(name)
        .acroField.getWidgets()[0]
        ?.getAppearances()?.normal
      if (!(normal instanceof PDFRawStream) && !(normal instanceof PDFStream)) throw new Error(name)
      const content =
        normal instanceof PDFRawStream
          ? new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode())
          : normal.getContentsString()
      const match = /([\d.]+) Tm/.exec(content)
      // Низ области текста — рамка 1 пт и отступ 1 пт; базовая линия выше на вынос.
      expect(Number(match?.[1])).toBeGreaterThanOrEqual(2 + descent - 0.01)
    }
  })

  it('шрифт раскладки меняет только высоту без выноса', async () => {
    const probe = await PDFDocument.create()
    probe.registerFontkit(fontkit)
    const pt = await probe.embedFont(font)
    const safe = descenderSafe(pt, 21)
    expect(safe.name).toBe(pt.name)
    expect(safe.widthOfTextAtSize('Абв', 18)).toBe(pt.widthOfTextAtSize('Абв', 18))
    expect(safe.heightAtSize(18)).toBe(pt.heightAtSize(18))
    const descent = pt.heightAtSize(18) - pt.heightAtSize(18, { descender: false })
    expect(safe.heightAtSize(18, { descender: false })).toBeCloseTo(21 - 2 * descent)
    // Мелкий кегль помещается и так: обычное центрирование.
    expect(descenderSafe(pt, 40).heightAtSize(10, { descender: false })).toBe(
      pt.heightAtSize(10, { descender: false })
    )
  })
})

describe('метаданные', () => {
  async function withXmp(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.addPage()
    doc.setTitle('Old title')
    doc.setAuthor('Old author')
    const xmp = doc.context.stream('<x:xmpmeta>old</x:xmpmeta>', {
      Type: 'Metadata',
      Subtype: 'XML'
    })
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp))
    return doc.save()
  }

  it('записывает поля на кириллице и удаляет пустые', async () => {
    const bytes = await writeMetadata(await withXmp(), {
      title: 'Договор № 5',
      author: '',
      subject: 'Аренда',
      keywords: 'договор, аренда',
      creator: 'Редактор'
    })
    expect(await readMetadata(bytes)).toEqual({
      title: 'Договор № 5',
      author: '',
      subject: 'Аренда',
      keywords: 'договор, аренда',
      creator: 'Редактор'
    })
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getProducer()).toBe('PDFwright')
    // Старый XMP заменён новым с теми же значениями.
    const stream = doc.context.lookup(doc.catalog.get(PDFName.of('Metadata')))
    if (!(stream instanceof PDFRawStream)) throw new Error('нет XMP')
    const xml = new TextDecoder().decode(stream.contents)
    expect(xml).toContain('Договор № 5')
    expect(xml).not.toContain('old')
    expect(xml).not.toContain('Old author')
  })

  it('без XMP в исходнике новый не появляется', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const bytes = await writeMetadata(await doc.save(), { title: 'Отчёт' })
    const out = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(out.getTitle()).toBe('Отчёт')
    expect(out.catalog.has(PDFName.of('Metadata'))).toBe(false)
  })

  it('«Очистить метаданные» убирает Info и XMP', async () => {
    const bytes = await clearMetadata(await withXmp())
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getTitle()).toBeUndefined()
    expect(doc.getAuthor()).toBeUndefined()
    expect(doc.getProducer()).toBeUndefined()
    expect(doc.catalog.has(PDFName.of('Metadata'))).toBe(false)
    expect(doc.getPageCount()).toBe(1)
  })
})
