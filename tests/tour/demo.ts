import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { loadMupdf } from '../../src/shared/pdf-content/mupdf'

/**
 * Демо-документы для снимков инструкции по ручной проверке: договор из трёх
 * страниц (шапка с логотипом, абзацы, список, линия; анкета с полями формы;
 * скан без текста) и его вторая редакция для сравнения. Личных данных нет.
 */

const ROOT = resolve(import.meta.dirname, '../..')

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function paragraph(page: PDFPage, font: PDFFont, text: string, x: number, y: number): number {
  const size = 11
  for (const line of wrap(text, font, size, 450)) {
    page.drawText(line, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) })
    y -= size * 1.45
  }
  return y
}

/** Картинка «скана»: текст, отрисованный в растр. */
async function scanPng(font: Uint8Array, lines: readonly string[]): Promise<Uint8Array> {
  const mupdf = await loadMupdf()
  const draft = await PDFDocument.create()
  draft.registerFontkit(fontkit)
  const sans = await draft.embedFont(font)
  const sheet = draft.addPage([595, 420])
  lines.forEach((line, i) => {
    sheet.drawText(line, { x: 50, y: 360 - i * 34, size: 18, font: sans })
  })
  const pdf = new mupdf.PDFDocument(await draft.save())
  try {
    const pix = pdf
      .loadPage(0)
      .toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false)
    return pix.asPNG().slice()
  } finally {
    pdf.destroy()
  }
}

async function contract(version: 1 | 2): Promise<Uint8Array> {
  const fontBytes = new Uint8Array(
    await readFile(join(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  )
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle('Договор оказания услуг')
  doc.setAuthor('ООО «Пример»')
  const font = await doc.embedFont(fontBytes, { subset: true })
  const logo = await doc.embedPng(await readFile(join(ROOT, 'resources/icon-256.png')))
  const grey = rgb(0.4, 0.4, 0.4)

  const p1 = doc.addPage([595, 842])
  p1.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.9, 0.92, 0.95) })
  p1.drawImage(logo, { x: 520, y: 800, width: 34, height: 34 })
  p1.drawText('ООО «Пример» · Москва, ул. Образцовая, 1', {
    x: 50,
    y: 812,
    size: 10,
    font,
    color: grey
  })
  p1.drawText('Договор оказания услуг № 17', { x: 50, y: 740, size: 22, font })
  p1.drawText('г. Москва', { x: 50, y: 712, size: 10, font, color: grey })
  p1.drawText('1 октября 2026 г.', { x: 460, y: 712, size: 10, font, color: grey })
  let y = paragraph(
    p1,
    font,
    'Общество с ограниченной ответственностью «Пример», именуемое в дальнейшем «Исполнитель», и Иванов Иван Иванович, именуемый в дальнейшем «Заказчик», заключили настоящий договор о нижеследующем.',
    50,
    680
  )
  y -= 10
  p1.drawText('1. Предмет договора', { x: 50, y, size: 14, font })
  y -= 22
  y = paragraph(
    p1,
    font,
    `Исполнитель обязуется оказать услуги по разработке сайта, а Заказчик обязуется принять и оплатить их в срок до ${version === 1 ? '30' : '31'} декабря 2026 года. Состав работ указан в приложении к договору.`,
    50,
    y
  )
  y -= 10
  for (const item of [
    '• подготовка макета главной страницы;',
    '• вёрстка и наполнение пяти разделов;',
    '• подключение формы обратной связи.'
  ]) {
    p1.drawText(item, { x: 64, y, size: 11, font })
    y -= 16
  }
  y -= 12
  p1.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.8, 0.8, 0.82) })
  y -= 28
  p1.drawText('2. Стоимость и порядок оплаты', { x: 50, y, size: 14, font })
  y -= 22
  paragraph(
    p1,
    font,
    'Стоимость услуг составляет 120 000 рублей. Оплата производится в два этапа: предоплата 50 % при подписании договора и окончательный расчёт после приёмки работ.',
    50,
    y
  )
  p1.drawText('Исполнитель ____________________', { x: 50, y: 120, size: 11, font })
  p1.drawText('Заказчик ____________________', { x: 330, y: 120, size: 11, font })

  const p2 = doc.addPage([595, 842])
  p2.drawText('Анкета заказчика', { x: 50, y: 760, size: 18, font })
  const form = doc.getForm()
  for (const [label, ly] of [
    ['ФИО', 700],
    ['Телефон', 650],
    ['Город', 600],
    ['Согласие', 550]
  ] as const) {
    p2.drawText(label, { x: 50, y: ly + 6, size: 11, font })
  }
  form.createTextField('fio').addToPage(p2, { x: 160, y: 694, width: 280, height: 24 })
  form.createTextField('phone').addToPage(p2, { x: 160, y: 644, width: 180, height: 24 })
  const city = form.createDropdown('city')
  city.addOptions(['Moscow', 'Saint Petersburg', 'Kazan'])
  city.addToPage(p2, { x: 160, y: 594, width: 180, height: 24 })
  form.createCheckBox('agree').addToPage(p2, { x: 160, y: 550, width: 18, height: 18 })
  p2.drawText(
    version === 1
      ? 'Заполните анкету и сохраните файл.'
      : 'Заполните анкету, проверьте данные и сохраните файл.',
    { x: 50, y: 480, size: 11, font }
  )
  form.updateFieldAppearances(font)

  const p3 = doc.addPage([595, 420])
  const scan = await scanPng(fontBytes, [
    'Акт приёма-передачи',
    'Работы выполнены в полном объёме.',
    'Претензий к качеству нет.'
  ])
  p3.drawImage(await doc.embedPng(scan), { x: 0, y: 0, width: 595, height: 420 })
  return doc.save()
}

/** Пишет «Договор.pdf» и «Договор_v2.pdf» в папку dir и возвращает их пути. */
export async function writeDemoDocuments(dir: string): Promise<{ first: string; second: string }> {
  const first = join(dir, 'Договор.pdf')
  const second = join(dir, 'Договор_v2.pdf')
  await writeFile(first, await contract(1))
  await writeFile(second, await contract(2))
  return { first, second }
}
