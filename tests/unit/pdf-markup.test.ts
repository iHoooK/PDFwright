import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { resolve } from 'node:path'
import * as mupdf from 'mupdf'
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString
} from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyMarkup, PdfOpsError } from '@shared/pdf-ops'
import type { MarkupObject, TextObject } from '@shared/markup/model'
import { fontMeasure, layoutTextObject } from '@shared/markup/text-layout'

const ROOT = resolve(import.meta.dirname, '../..')
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let fixture: Uint8Array
let font: Uint8Array

beforeAll(async () => {
  fixture = new Uint8Array(await readFile(resolve(ROOT, 'tests/fixtures/simple.pdf')))
  font = new Uint8Array(
    await readFile(resolve(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  )
})

const base = { color: '#c42b1c', opacity: 0.8 }

/** По объекту каждого вида: так проверяется, что всё записывается и читается обратно. */
function everyKind(page = 1): MarkupObject[] {
  return [
    {
      ...base,
      id: 'a1',
      page,
      kind: 'highlight',
      rects: [{ x: 72, y: 700, width: 200, height: 14 }]
    },
    {
      ...base,
      id: 'a2',
      page,
      kind: 'underline',
      rects: [{ x: 72, y: 680, width: 200, height: 14 }]
    },
    {
      ...base,
      id: 'a3',
      page,
      kind: 'strikeout',
      rects: [{ x: 72, y: 660, width: 200, height: 14 }]
    },
    {
      ...base,
      id: 'a4',
      page,
      kind: 'ink',
      width: 2,
      paths: [
        [
          { x: 100, y: 100 },
          { x: 140, y: 130 },
          { x: 180, y: 110 }
        ]
      ]
    },
    {
      ...base,
      id: 'a5',
      page,
      kind: 'rect',
      width: 2,
      rect: { x: 300, y: 300, width: 100, height: 50 }
    },
    {
      ...base,
      id: 'a6',
      page,
      kind: 'ellipse',
      width: 2,
      rect: { x: 300, y: 400, width: 100, height: 50 }
    },
    {
      ...base,
      id: 'a7',
      page,
      kind: 'line',
      width: 1,
      from: { x: 50, y: 500 },
      to: { x: 200, y: 520 }
    },
    {
      ...base,
      id: 'a8',
      page,
      kind: 'arrow',
      width: 3,
      from: { x: 50, y: 550 },
      to: { x: 200, y: 550 }
    },
    {
      ...base,
      id: 'a9',
      page,
      kind: 'text',
      rect: { x: 300, y: 200, width: 160, height: 40 },
      rotate: 0,
      text: 'Привет, мир!\nВторая строка',
      fontSize: 12
    },
    {
      ...base,
      id: 'a10',
      page,
      kind: 'image',
      rect: { x: 450, y: 100, width: 60, height: 30 },
      rotate: 0,
      src: PNG_1PX,
      signature: true
    }
  ]
}

function annotsOf(doc: PDFDocument, index: number): PDFDict[] {
  const annots = doc.getPage(index).node.Annots()
  if (!annots) return []
  return annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict))
}

function nameOf(dict: PDFDict, key: string): string | undefined {
  return dict.get(PDFName.of(key))?.toString()
}

function textOf(bytes: Uint8Array, page = 0): string {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  return doc.loadPage(page).toStructuredText('preserve-whitespace').asText()
}

describe('applyMarkup', () => {
  it('без объектов возвращает исходные байты', async () => {
    expect(await applyMarkup(fixture, [], { mode: 'annotation' })).toBe(fixture)
  })

  it('записывает каждый вид разметки PDF-аннотацией с внешним видом', async () => {
    const out = await applyMarkup(fixture, everyKind(), { mode: 'annotation', font })
    const doc = await PDFDocument.load(out)
    const annots = annotsOf(doc, 0)
    expect(annots.map((a) => nameOf(a, 'Subtype'))).toEqual([
      '/Highlight',
      '/Underline',
      '/StrikeOut',
      '/Ink',
      '/Square',
      '/Circle',
      '/Line',
      '/Line',
      '/FreeText',
      '/Stamp'
    ])
    for (const annot of annots) {
      const ap = annot.lookup(PDFName.of('AP'), PDFDict)
      expect(ap.lookup(PDFName.of('N'))).toBeInstanceOf(PDFRawStream)
      expect(annot.lookup(PDFName.of('Rect'), PDFArray).size()).toBe(4)
    }
    const highlight = annots[0]
    expect(highlight?.lookup(PDFName.of('QuadPoints'), PDFArray).size()).toBe(8)
    const arrow = annots[7]
    expect(arrow?.lookup(PDFName.of('LE'), PDFArray).get(1).toString()).toBe('/OpenArrow')
    const freeText = annots[8]
    const contents = freeText?.lookup(PDFName.of('Contents'))
    expect(contents instanceof PDFHexString || contents instanceof PDFString).toBe(true)
    expect((contents as PDFHexString).decodeText()).toBe('Привет, мир!\nВторая строка')
    expect(doc.getPage(1).node.Annots()).toBeUndefined()
  })

  it('аннотации читаются MuPDF, текст блока извлекается с кириллицей', async () => {
    const out = await applyMarkup(fixture, everyKind(), { mode: 'annotation', font })
    const doc = mupdf.Document.openDocument(out, 'application/pdf') as mupdf.PDFDocument
    const page = doc.loadPage(0)
    expect(page.getAnnotations().map((a) => a.getType())).toEqual([
      'Highlight',
      'Underline',
      'StrikeOut',
      'Ink',
      'Square',
      'Circle',
      'Line',
      'Line',
      'FreeText',
      'Stamp'
    ])
    expect(page.getAnnotations()[8]?.getContents()).toBe('Привет, мир!\nВторая строка')
  })

  it('flatten впечатывает разметку в содержимое: аннотаций нет, текст находится', async () => {
    const out = await applyMarkup(fixture, everyKind(2), { mode: 'content', font })
    const doc = await PDFDocument.load(out)
    expect(annotsOf(doc, 1)).toHaveLength(0)
    const text = textOf(out, 1)
    expect(text).toContain('Привет, мир!')
    expect(text).toContain('Вторая строка')
    expect(text).toContain('PDFwright test page 2')
  })

  it('кладёт текст в прямоугольник блока и на повёрнутой странице', async () => {
    const rotated = await PDFDocument.load(fixture)
    rotated.getPage(0).setRotation(degrees(90))
    const bytes = await rotated.save()
    const text: MarkupObject = {
      ...base,
      id: 't',
      page: 1,
      kind: 'text',
      rect: { x: 100, y: 300, width: 40, height: 200 },
      rotate: 90,
      text: 'Поворот',
      fontSize: 20
    }
    const out = await applyMarkup(bytes, [text], { mode: 'content', font })
    const doc = mupdf.Document.openDocument(out, 'application/pdf')
    const origins: { c: string; x: number; y: number }[] = []
    doc
      .loadPage(0)
      .toStructuredText('preserve-whitespace')
      .walk({
        onChar: (c, origin) => {
          origins.push({ c, x: origin[0], y: origin[1] })
        }
      })
    const word = origins.filter((o) => 'Поворот'.includes(o.c))
    expect(word.map((o) => o.c).join('')).toBe('Поворот')
    // MuPDF отдаёт координаты повёрнутого вида: блок 100..140 × 300..500 стоит
    // в нём в полосе x 300..500, y 100..140, и текст идёт слева направо.
    for (const o of word) {
      expect(o.x).toBeGreaterThanOrEqual(300)
      expect(o.x).toBeLessThanOrEqual(500)
      expect(o.y).toBeGreaterThanOrEqual(100)
      expect(o.y).toBeLessThanOrEqual(140)
    }
    expect((word.at(-1)?.x ?? 0) > (word[0]?.x ?? 0)).toBe(true)
  })

  it.each(['annotation', 'content'] as const)(
    'рамка заданной ширины: строки перенесены как на экране, кегль прежний (%s)',
    async (mode) => {
      const block: TextObject = {
        ...base,
        id: 'w',
        page: 1,
        kind: 'text',
        rect: { x: 300, y: 300, width: 110, height: 120 },
        rotate: 0,
        text: 'Перенос по словам внутри рамки',
        fontSize: 14,
        fixedWidth: true
      }
      const expected = layoutTextObject(block, fontMeasure(fontkit.create(font)))
        .lines.map((l) => l.text)
        .filter((l) => l.length > 0)
      expect(expected.length).toBeGreaterThanOrEqual(2)
      const out = await applyMarkup(fixture, [block], { mode, font })
      const doc = mupdf.Document.openDocument(out, 'application/pdf')
      const page = doc.loadPage(0)
      const top = page.getBounds()[3]
      const lines: { text: string; y: number }[] = []
      const chars: { x: number; y: number; size: number }[] = []
      // Список отображения с аннотациями: текст FreeText виден так же, как впечатанный.
      page
        .toDisplayList(true)
        .toStructuredText('preserve-whitespace')
        .walk({
          onChar: (c, origin, _font, size) => {
            // Только символы внутри рамки (в координатах MuPDF ось Y вниз).
            const [x, y] = origin
            if (x < 295 || x > 415 || y < top - 425 || y > top - 295) return
            chars.push({ x, y, size })
            const line = lines.find((l) => Math.abs(l.y - y) < 1)
            if (line) line.text += c
            else lines.push({ text: c, y })
          }
        })
      expect(lines.map((l) => l.text.trim())).toEqual(expected)
      for (const c of chars) {
        expect(c.x).toBeGreaterThanOrEqual(300)
        expect(c.x).toBeLessThanOrEqual(410)
        expect(c.size).toBeCloseTo(14, 1)
      }
    }
  )

  it('без шрифта текстовый блок не записывается', async () => {
    await expect(
      applyMarkup(fixture, everyKind().slice(8, 9), { mode: 'annotation' })
    ).rejects.toBeInstanceOf(PdfOpsError)
  })

  it('отклоняет объекты на несуществующей странице', async () => {
    await expect(
      applyMarkup(fixture, everyKind(7).slice(0, 1), { mode: 'annotation' })
    ).rejects.toBeInstanceOf(PdfOpsError)
  })

  it('непрозрачность задана во внешнем виде, маркер накладывается умножением', async () => {
    const out = await applyMarkup(fixture, everyKind().slice(0, 1), { mode: 'annotation' })
    const doc = await PDFDocument.load(out)
    const ap = annotsOf(doc, 0)[0]?.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as
      PDFRawStream | undefined
    const gs = ap?.dict
      .lookup(PDFName.of('Resources'), PDFDict)
      .lookup(PDFName.of('ExtGState'), PDFDict)
      .lookup(PDFName.of('GS0'), PDFDict)
    expect(gs?.lookup(PDFName.of('ca'), PDFNumber)?.asNumber()).toBeCloseTo(0.8)
    expect(gs?.get(PDFName.of('BM'))?.toString()).toBe('/Multiply')
  })

  it('непрозрачность и в словаре аннотации /CA, у непрозрачных её нет (M10)', async () => {
    const opaque: MarkupObject = {
      ...base,
      id: 'o',
      page: 1,
      opacity: 1,
      kind: 'rect',
      width: 2,
      rect: { x: 100, y: 300, width: 50, height: 50 }
    }
    const out = await applyMarkup(fixture, [...everyKind().slice(3, 5), opaque], {
      mode: 'annotation'
    })
    const annots = annotsOf(await PDFDocument.load(out), 0)
    expect(annots[0]?.lookup(PDFName.of('CA'), PDFNumber).asNumber()).toBeCloseTo(0.8)
    expect(annots[1]?.lookup(PDFName.of('CA'), PDFNumber).asNumber()).toBeCloseTo(0.8)
    expect(annots[2]?.get(PDFName.of('CA'))).toBeUndefined()
    // MuPDF читает ту же непрозрачность.
    const mu = mupdf.Document.openDocument(out, 'application/pdf') as mupdf.PDFDocument
    expect(mu.loadPage(0).getAnnotations()[0]?.getOpacity()).toBeCloseTo(0.8)
  })

  it('пустой текстовый блок в файл не пишется (M8)', async () => {
    const empty: TextObject = {
      ...base,
      id: 'empty',
      page: 1,
      kind: 'text',
      rect: { x: 300, y: 200, width: 160, height: 40 },
      rotate: 0,
      text: '  \n',
      fontSize: 12
    }
    const out = await applyMarkup(fixture, [empty], { mode: 'annotation', font })
    expect(out).toBe(fixture)
    const withInk = await applyMarkup(fixture, [...everyKind().slice(3, 4), empty], {
      mode: 'annotation',
      font
    })
    expect(annotsOf(await PDFDocument.load(withInk), 0).map((a) => nameOf(a, 'Subtype'))).toEqual([
      '/Ink'
    ])
  })
})
