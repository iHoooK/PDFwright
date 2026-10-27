import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument, rgb } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  insertText,
  listPageObjects,
  moveGraphic,
  removeGraphic,
  replaceBlock,
  replaceText,
  type PageObjects
} from '@shared/pdf-content'
import { groupBlocks } from '@shared/pdf-content/blocks'
import { wrapText } from '@shared/pdf-content/text-writer'
import { displayFontName, parseToUnicode, sameFamily } from '@shared/pdf-content/to-unicode'
import type { PageTextLine } from '@shared/pdf-content/types'

const FONT = readFileSync(
  resolve(import.meta.dirname, '../../src/renderer/public/fonts/PTSans-Regular.ttf')
)

/**
 * Страница с текстом урезанным PT Sans (Type0, Identity-H, ToUnicode — как у
 * Cairo и Word): в подмножестве есть только буквы исходного текста.
 */
async function subsetFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(FONT, { subset: true })
  const page = doc.addPage([400, 400])
  page.drawText('Привет мир', { x: 40, y: 340, size: 14, font })
  page.drawText('Строка номер два', { x: 40, y: 320, size: 14, font })
  page.drawText('Строка номер три', { x: 40, y: 300, size: 14, font })
  page.drawText('Отдельно', { x: 40, y: 200, size: 14, font, color: rgb(0.5, 0.5, 0.5) })
  page.drawRectangle({ x: 0, y: 360, width: 400, height: 40, color: rgb(0.9, 0.9, 0.9) })
  page.drawLine({
    start: { x: 40, y: 260 },
    end: { x: 360, y: 260 },
    thickness: 1,
    color: rgb(0, 0, 0)
  })
  return doc.save()
}

function fontObjects(bytes: Uint8Array): Set<number> {
  const doc = new mupdf.PDFDocument(bytes)
  const numbers = new Set<number>()
  doc
    .findPage(0)
    .getInheritable('Resources')
    .get('Font')
    .forEach((font) => {
      numbers.add(font.asIndirect())
    })
  doc.destroy()
  return numbers
}

function texts(objects: PageObjects): string[] {
  return objects.lines.map((line) => line.text.trim())
}

describe('ToUnicode', () => {
  it('разбирает bfchar и оба вида bfrange в таблицу «буква → код»', () => {
    const codes = parseToUnicode(`
      2 beginbfchar
      <0001> <041f>
      <0002> <0438>
      endbfchar
      2 beginbfrange
      <0010> <0012> <0430>
      <0020> <0021> [<0041> <0042>]
      endbfrange`)
    expect(codes.get('П')).toBe('0001')
    expect(codes.get('и')).toBe('0002')
    expect(codes.get('а')).toBe('0010')
    expect(codes.get('в')).toBe('0012')
    expect(codes.get('B')).toBe('0021')
  })

  it('сравнивает семейства без префикса подмножества и с обрезанным именем MuPDF', () => {
    expect(sameFamily('ABCDEF+GoNotoCurrent-Regular', 'XYZQWE+GoNotoCurrent-Regular')).toBe(true)
    expect(sameFamily('DQNOFE+GoNotoCurrentBold-Regula', 'GoNotoCurrentBold-Regular')).toBe(true)
    expect(sameFamily('GoNotoCurrent-Regular', 'GoNotoCurrentBold-Regular')).toBe(false)
    // pdf-lib дописывает к имени число: это то же семейство.
    expect(sameFamily('ABCDEF+PTSans-Regular-4824', 'PTSans-Regular-17')).toBe(true)
  })

  it('показывает понятные имена шрифтов', () => {
    expect(displayFontName('PTSans-Regular-4824')).toBe('PT Sans Regular')
    expect(displayFontName('ArialMT-9668')).toBe('Arial')
    expect(displayFontName('Arial-BoldMT-250')).toBe('Arial Bold')
    expect(displayFontName('ABCDEF+TimesNewRomanPS-BoldMT')).toBe('Times New Roman PS Bold')
  })
})

describe('перенос по словам', () => {
  const measure = (text: string): number => Array.from(text).length * 10

  it('переносит по ширине, сохраняет явные разрывы и режет слишком длинное слово', () => {
    expect(wrapText('раз два три', 70, measure)).toEqual(['раз два', 'три'])
    expect(wrapText('раз\nдва', 1000, measure)).toEqual(['раз', 'два'])
    expect(wrapText('оченьдлинное', 50, measure)).toEqual(['очень', 'длинн', 'ое'])
  })
})

describe('абзацы', () => {
  const line = (
    index: number,
    text: string,
    y: number,
    x = 40,
    extra: Partial<PageTextLine> = {}
  ): PageTextLine => ({
    kind: 'text',
    index,
    text,
    rect: { x, y: y - 3, width: text.length * 6, height: 14 },
    origin: { x, y },
    direction: { x: 1, y: 0 },
    fontName: 'ABCDEF+Font-Regular',
    fontSize: 10,
    bold: false,
    italic: false,
    color: [0, 0, 0],
    ...extra
  })

  it('собирает строки с общим краем и шагом, пункты списка — с разрывом', () => {
    const blocks = groupBlocks([
      line(0, 'Первая строка абзаца, довольно длинная', 700),
      line(1, 'вторая строка абзаца.', 687),
      line(2, '- пункт списка', 674),
      line(3, 'Другой цвет', 661, 40, { color: [0.5, 0.5, 0.5] }),
      line(4, 'Далеко внизу', 600)
    ])
    // Строка другого цвета того же кегля — часть абзаца, но с явным разрывом.
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.text).toBe(
      'Первая строка абзаца, довольно длинная вторая строка абзаца.\n- пункт списка\nДругой цвет'
    )
    expect(blocks[0]?.lineHeight).toBeCloseTo(13)
    expect(blocks[0]?.lines).toEqual([0, 1, 2, 3])
  })
})

describe('запись текста шрифтом документа', () => {
  let bytes: Uint8Array
  beforeAll(async () => {
    bytes = await subsetFixture()
  })

  it('заменяет строку буквами из подмножества шрифта документа, не встраивая новый шрифт', async () => {
    const objects = await listPageObjects(bytes, 0)
    const line = objects.lines.find((l) => l.text === 'Привет мир')
    if (!line) throw new Error('нет строки')
    const before = fontObjects(bytes)
    // Все буквы новой строки есть в подмножестве (из исходного текста).
    const next = await replaceText(bytes, 0, line, 'Привет номер')
    const after = await listPageObjects(next, 0)
    expect(texts(after)).toContain('Привет номер')
    expect(texts(after)).not.toContain('Привет мир')
    expect([...fontObjects(next)].every((n) => before.has(n))).toBe(true)
  })

  it('буквы, которых нет в подмножестве, пишет встроенным шрифтом, а не падает', async () => {
    const objects = await listPageObjects(bytes, 0)
    const line = objects.lines.find((l) => l.text === 'Привет мир')
    if (!line) throw new Error('нет строки')
    const next = await replaceText(bytes, 0, line, 'Здравствуй, Жёлудь!')
    expect(texts(await listPageObjects(next, 0))).toContain('Здравствуй, Жёлудь!')
  })

  it('недостающие буквы документа в PT Sans берёт из PT Sans программы, а не из Helvetica', async () => {
    const objects = await listPageObjects(bytes, 0)
    const line = objects.lines.find((l) => l.text === 'Привет мир')
    if (!line) throw new Error('нет строки')
    const next = await replaceText(bytes, 0, line, 'Привет, Ёжик и Щука', {
      fallbackFont: new Uint8Array(FONT)
    })
    const written = (await listPageObjects(next, 0)).lines.filter((l) => /Ёжик|Щука/.test(l.text))
    expect(written.length).toBeGreaterThan(0)
    expect(written.every((l) => !/helvetica|nimbus/i.test(l.fontName))).toBe(true)
  })

  it('переписывает абзац с новой шириной: строки переносятся, кегль и цвет прежние', async () => {
    const objects = await listPageObjects(bytes, 0)
    const block = objects.blocks.find((b) => b.text.startsWith('Привет'))
    if (!block) throw new Error('нет абзаца')
    expect(block.lines).toHaveLength(3)
    const ref = { lines: block.lines.map((i) => objects.lines[i]).filter((l) => l !== undefined) }
    const next = await replaceBlock(bytes, 0, ref, 'Строка номер два Строка номер три Привет мир', {
      width: 120
    })
    const after = await listPageObjects(next, 0)
    const rewritten = after.lines.filter(
      (l) => l.text.startsWith('Строка') || l.text.startsWith('Привет')
    )
    expect(rewritten.length).toBeGreaterThanOrEqual(3)
    for (const l of rewritten) {
      expect(l.fontSize).toBeCloseTo(14, 0)
      expect(l.rect.width).toBeLessThanOrEqual(121)
    }
    expect(after.lines.some((l) => l.text === 'Отдельно')).toBe(true)
  })

  it('вставляет новый текст стилем существующей строки', async () => {
    const objects = await listPageObjects(bytes, 0)
    const ref = objects.lines.find((l) => l.text === 'Отдельно')
    if (!ref) throw new Error('нет строки')
    const next = await insertText(bytes, 0, { x: 40, y: 150 }, 'Новая строка\nи ещё одна', {
      fontName: ref.fontName,
      fontSize: ref.fontSize,
      color: ref.color,
      bold: ref.bold,
      italic: ref.italic
    })
    const after = await listPageObjects(next, 0)
    const added = after.lines.find((l) => l.text === 'Новая строка')
    expect(added?.fontSize).toBeCloseTo(14, 0)
    expect(added?.color[0]).toBeCloseTo(0.5, 1)
    expect(after.lines.some((l) => l.text === 'и ещё одна')).toBe(true)
  })
})

describe('векторные контуры', () => {
  let bytes: Uint8Array
  beforeAll(async () => {
    bytes = await subsetFixture()
  })

  it('видит плашку и линию, удаляет плашку, не трогая текст и линию', async () => {
    const objects = await listPageObjects(bytes, 0)
    const band = objects.graphics.find((g) => g.fill !== null)
    const rule = objects.graphics.find((g) => g.stroke !== null)
    expect(Math.abs((band?.rect.y ?? 0) - 360)).toBeLessThan(1)
    expect(rule?.rect.width).toBeGreaterThan(300)
    if (!band) throw new Error('нет плашки')
    const next = await removeGraphic(bytes, 0, band)
    const after = await listPageObjects(next, 0)
    expect(after.graphics.some((g) => g.fill !== null)).toBe(false)
    expect(after.graphics.some((g) => g.stroke !== null)).toBe(true)
    expect(texts(after)).toEqual(texts(objects))
  })

  it('растягивает линию по ширине без изменения толщины', async () => {
    const objects = await listPageObjects(bytes, 0)
    const rule = objects.graphics.find((g) => g.stroke !== null)
    if (!rule) throw new Error('нет линии')
    const next = await moveGraphic(bytes, 0, rule, { ...rule.rect, width: rule.rect.width / 2 })
    const moved = (await listPageObjects(next, 0)).graphics.find((g) => g.stroke !== null)
    expect(moved?.rect.width).toBeCloseTo(rule.rect.width / 2, 0)
    expect(moved?.rect.height).toBeCloseTo(rule.rect.height, 0)
  })
})
