import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { loadMupdf } from '../../src/shared/pdf-content/mupdf'

/**
 * Документ для рекламных снимков: годовой отчёт вымышленной студии с шапкой,
 * показателями, диаграммой, картинкой и жирными словами в тексте. Шрифт —
 * Calibri из Windows (как у документов из Word), без него — PT Sans программы.
 */

const ROOT = resolve(import.meta.dirname, '../..')
const NAVY = rgb(0.09, 0.22, 0.4)
const ACCENT = rgb(0.0, 0.47, 0.83)
const INK = rgb(0.13, 0.13, 0.15)
const GREY = rgb(0.42, 0.44, 0.48)
const PALE = rgb(0.93, 0.96, 0.99)

async function fonts(doc: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont }> {
  doc.registerFontkit(fontkit)
  const windows = 'C:/Windows/Fonts'
  if (existsSync(join(windows, 'calibri.ttf')) && existsSync(join(windows, 'calibrib.ttf'))) {
    return {
      regular: await doc.embedFont(await readFile(join(windows, 'calibri.ttf')), { subset: true }),
      bold: await doc.embedFont(await readFile(join(windows, 'calibrib.ttf')), { subset: true })
    }
  }
  const pt = await readFile(join(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  const regular = await doc.embedFont(pt, { subset: true })
  return { regular, bold: regular }
}

/** Строки абзаца с жирными отрывками в **звёздочках**, перенос по словам. */
function richParagraph(
  page: PDFPage,
  text: string,
  font: { regular: PDFFont; bold: PDFFont },
  x: number,
  y: number,
  width: number,
  size = 11.5
): number {
  const words: { text: string; bold: boolean }[] = []
  let open = false
  for (const raw of text.split(' ')) {
    const starts = raw.startsWith('**')
    const ends = (starts ? raw.slice(2) : raw).includes('**')
    words.push({ text: raw.replaceAll('**', ''), bold: open || starts })
    if (starts && !ends) open = true
    if (ends) open = false
  }
  const space = font.regular.widthOfTextAtSize(' ', size)
  const lead = size * 1.45
  let line: typeof words = []
  let lineWidth = 0
  const flush = (): void => {
    let cx = x
    for (const word of line) {
      const f = word.bold ? font.bold : font.regular
      page.drawText(word.text, { x: cx, y, size, font: f, color: INK })
      cx += f.widthOfTextAtSize(word.text, size) + space
    }
    y -= lead
    line = []
    lineWidth = 0
  }
  for (const word of words) {
    const w = (word.bold ? font.bold : font.regular).widthOfTextAtSize(word.text, size)
    if (line.length > 0 && lineWidth + space + w > width) flush()
    lineWidth += (line.length > 0 ? space : 0) + w
    line.push(word)
  }
  if (line.length > 0) flush()
  return y
}

/** Картинка-«фотография»: горы на закате, нарисованные и переведённые в растр. */
async function photo(): Promise<Uint8Array> {
  const mupdf = await loadMupdf()
  const draft = await PDFDocument.create()
  const sheet = draft.addPage([300, 190])
  const sky: [number, RGB][] = [
    [0, rgb(0.99, 0.78, 0.55)],
    [40, rgb(0.98, 0.66, 0.5)],
    [80, rgb(0.84, 0.55, 0.62)],
    [120, rgb(0.55, 0.5, 0.72)],
    [160, rgb(0.3, 0.38, 0.66)]
  ]
  for (const [i, [from, color]] of sky.entries()) {
    sheet.drawRectangle({
      x: 0,
      y: from,
      width: 300,
      height: (sky[i + 1]?.[0] ?? 190) - from,
      color
    })
  }
  sheet.drawCircle({ x: 205, y: 118, size: 22, color: rgb(1, 0.9, 0.62) })
  // Путь SVG идёт вниз от точки (x, y), поэтому горы — с отрицательными координатами от низа.
  sheet.drawSvgPath('M0 0 L0 -60 L60 -110 L105 -70 L160 -125 L215 -62 L260 -92 L300 -58 L300 0 Z', {
    x: 0,
    y: 0,
    color: rgb(0.2, 0.25, 0.42)
  })
  sheet.drawSvgPath('M0 0 L0 -30 L70 -70 L130 -38 L190 -80 L250 -40 L300 -55 L300 0 Z', {
    x: 0,
    y: 0,
    color: rgb(0.11, 0.15, 0.28)
  })
  const pdf = new mupdf.PDFDocument(await draft.save())
  try {
    const pix = pdf
      .loadPage(0)
      .toPixmap(mupdf.Matrix.scale(7, 7), mupdf.ColorSpace.DeviceRGB, false)
    // Лёгкое «зерно», как у настоящей фотографии: такую картинку есть смысл сжимать.
    const pixels = pix.getPixels()
    let seed = 7
    for (let i = 0; i < pixels.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      pixels[i] = (pixels[i] ?? 0) + ((seed >> 16) % 13) - 6
    }
    return pix.asPNG().slice()
  } finally {
    pdf.destroy()
  }
}

async function report(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Итоги 2026 года — студия «Северный ветер»')
  doc.setAuthor('Студия «Северный ветер»')
  const font = await fonts(doc)
  const W = 595
  const H = 842

  // Страница 1: шапка, вступление, показатели, диаграмма, проекты и картинка.
  const p = doc.addPage([W, H])
  p.drawRectangle({ x: 0, y: H - 130, width: W, height: 130, color: NAVY })
  p.drawCircle({ x: 520, y: H - 62, size: 30, color: ACCENT })
  p.drawSvgPath('M-14 8 L0 -14 L14 8 Z', { x: 520, y: H - 60, color: rgb(1, 1, 1) })
  p.drawText('СТУДИЯ «СЕВЕРНЫЙ ВЕТЕР»', {
    x: 50,
    y: H - 52,
    size: 11,
    font: font.bold,
    color: rgb(0.65, 0.8, 0.95)
  })
  p.drawText('Итоги 2026 года', {
    x: 50,
    y: H - 90,
    size: 30,
    font: font.bold,
    color: rgb(1, 1, 1)
  })
  p.drawText('Отчёт для команды и партнёров', {
    x: 50,
    y: H - 112,
    size: 12,
    font: font.regular,
    color: rgb(0.8, 0.87, 0.95)
  })
  let y = richParagraph(
    p,
    'В этом году студия выпустила **12 проектов** для клиентов из пяти городов. Выручка выросла на **38 %**, а средний срок разработки сократился с девяти до **шести недель** благодаря новому процессу проверки макетов.',
    font,
    50,
    H - 168,
    495
  )
  y -= 14
  const cards: [string, string][] = [
    ['12', 'проектов сдано'],
    ['+38 %', 'рост выручки'],
    ['4,9', 'средняя оценка клиентов']
  ]
  cards.forEach(([value, caption], i) => {
    const cx = 50 + i * 168
    p.drawRectangle({ x: cx, y: y - 62, width: 159, height: 66, color: PALE })
    p.drawRectangle({ x: cx, y: y - 62, width: 4, height: 66, color: ACCENT })
    p.drawText(value, { x: cx + 16, y: y - 28, size: 24, font: font.bold, color: NAVY })
    p.drawText(caption, { x: cx + 16, y: y - 48, size: 10.5, font: font.regular, color: GREY })
  })
  y -= 100
  p.drawText('Выручка по кварталам, млн руб.', { x: 50, y, size: 15, font: font.bold, color: INK })
  const chartTop = y - 20
  const base = chartTop - 150
  const bars: [string, number][] = [
    ['I кв.', 4.2],
    ['II кв.', 5.1],
    ['III кв.', 6.4],
    ['IV кв.', 7.9]
  ]
  p.drawLine({ start: { x: 50, y: base }, end: { x: 300, y: base }, thickness: 1, color: GREY })
  bars.forEach(([label, value], i) => {
    const bx = 64 + i * 58
    const h = value * 16
    p.drawRectangle({ x: bx, y: base, width: 38, height: h, color: i === 3 ? ACCENT : NAVY })
    p.drawText(String(value).replace('.', ','), {
      x: bx + 8,
      y: base + h + 6,
      size: 10,
      font: font.bold,
      color: INK
    })
    p.drawText(label, { x: bx + 4, y: base - 16, size: 10, font: font.regular, color: GREY })
  })
  p.drawImage(await doc.embedPng(await photo()), { x: 330, y: base - 16, width: 215, height: 136 })
  p.drawText('Выезд команды на Алтай, август', {
    x: 330,
    y: base - 32,
    size: 9.5,
    font: font.regular,
    color: GREY
  })
  y = base - 64
  p.drawText('Главные проекты', { x: 50, y, size: 15, font: font.bold, color: INK })
  y -= 24
  for (const item of [
    '• интернет-магазин керамики с примеркой посуды в интерьере;',
    '• мобильная игра-головоломка для детского музея;',
    '• сайт фестиваля уличной музыки и билетная система.'
  ]) {
    p.drawText(item, { x: 62, y, size: 11.5, font: font.regular, color: INK })
    y -= 18
  }
  y -= 10
  richParagraph(
    p,
    'В следующем году планируем открыть **направление обучения** — короткие курсы по созданию сайтов для начинающих и открытые разборы проектов.',
    font,
    50,
    y,
    495
  )
  p.drawLine({ start: { x: 50, y: 52 }, end: { x: 545, y: 52 }, thickness: 0.6, color: PALE })
  p.drawText('Студия «Северный ветер» · 2026', {
    x: 50,
    y: 36,
    size: 9,
    font: font.regular,
    color: GREY
  })
  p.drawText('1', { x: 540, y: 36, size: 9, font: font.regular, color: GREY })

  // Страница 2: план на следующий год.
  const q = doc.addPage([W, H])
  q.drawText('План на 2027 год', { x: 50, y: H - 80, size: 22, font: font.bold, color: NAVY })
  let qy = richParagraph(
    q,
    'Главная цель — вырасти без потери качества. Команда остаётся небольшой, а каждый проект по-прежнему ведёт **один ответственный разработчик** от первой встречи до запуска.',
    font,
    50,
    H - 116,
    495
  )
  qy -= 16
  const rows: [string, string, string][] = [
    ['Квартал', 'Задача', 'Ответственный'],
    ['I', 'Курсы для начинающих', 'Ольга'],
    ['II', 'Новый сайт студии', 'Максим'],
    ['III', 'Игра для фестиваля', 'Ирина'],
    ['IV', 'Открытые разборы', 'Вся команда']
  ]
  rows.forEach(([a, b, c], i) => {
    const ry = qy - i * 28
    if (i === 0) q.drawRectangle({ x: 50, y: ry - 9, width: 495, height: 26, color: PALE })
    const f = i === 0 ? font.bold : font.regular
    q.drawText(a, { x: 62, y: ry, size: 11.5, font: f, color: INK })
    q.drawText(b, { x: 150, y: ry, size: 11.5, font: f, color: INK })
    q.drawText(c, { x: 400, y: ry, size: 11.5, font: f, color: INK })
    q.drawLine({
      start: { x: 50, y: ry - 9 },
      end: { x: 545, y: ry - 9 },
      thickness: 0.6,
      color: rgb(0.85, 0.87, 0.9)
    })
  })
  q.drawText('2', { x: 540, y: 36, size: 9, font: font.regular, color: GREY })
  return doc.save()
}

/** Пишет «Отчёт 2026.pdf» в папку dir и возвращает путь. */
export async function writeShowcaseReport(dir: string): Promise<string> {
  const path = join(dir, 'Отчёт 2026.pdf')
  await writeFile(path, await report())
  return path
}

/**
 * Подпись «как от руки» для снимков: фамилия шрифтом Segoe Script из Windows
 * и росчерк, прозрачный PNG. Без шрифта — null (подпись рисуется мышью).
 */
export async function writeSignaturePng(dir: string): Promise<string | null> {
  const fontPath = 'C:/Windows/Fonts/segoesc.ttf'
  if (!existsSync(fontPath)) return null
  const draft = await PDFDocument.create()
  draft.registerFontkit(fontkit)
  const font = await draft.embedFont(await readFile(fontPath), { subset: true })
  const ink = rgb(0.1, 0.2, 0.55)
  const sheet = draft.addPage([260, 90])
  sheet.drawText('Петров', { x: 18, y: 34, size: 40, font, color: ink })
  sheet.drawSvgPath('M0 0 C40 10 120 12 230 -6 C200 4 160 10 120 12', {
    x: 14,
    y: 26,
    borderColor: ink,
    borderWidth: 2.2
  })
  const mupdf = await loadMupdf()
  const pdf = new mupdf.PDFDocument(await draft.save())
  try {
    const pix = pdf.loadPage(0).toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, true)
    const path = join(dir, 'подпись.png')
    await writeFile(path, pix.asPNG())
    return path
  } finally {
    pdf.destroy()
  }
}
