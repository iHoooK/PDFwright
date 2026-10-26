import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as mupdf from 'mupdf'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFRef
} from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyMarkup } from '@shared/pdf-ops'
import type { MarkupObject, NoteObject } from '@shared/markup/model'
import { NOTE_SIZE } from '@shared/markup/note'
import {
  editAnnotations,
  listAnnotations,
  removeAnnotations,
  type PageAnnotation
} from '@shared/pdf-content/annotations'
import { PdfContentError } from '@shared/pdf-content/types'

const ROOT = resolve(import.meta.dirname, '../..')

let font: Uint8Array

beforeAll(async () => {
  font = new Uint8Array(
    await readFile(resolve(ROOT, 'src/renderer/public/fonts/PTSans-Regular.ttf'))
  )
})

const note: NoteObject = {
  id: 'n1',
  page: 1,
  kind: 'note',
  color: '#ffd86b',
  opacity: 1,
  rect: { x: 100, y: 700, width: NOTE_SIZE, height: NOTE_SIZE },
  text: 'Проверить сумму в п. 3'
}

/** Страница A4 с аннотациями, собранными pdf-lib: так выглядят пометки других программ. */
async function foreignFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  page.drawText('Annotations fixture', { x: 72, y: 780, size: 18 })
  const ctx = doc.context
  const add = (dict: Record<string, unknown>): PDFRef => {
    const ref = ctx.register(ctx.obj({ Type: 'Annot', ...dict } as never))
    page.node.addAnnot(ref)
    return ref
  }
  add({ Subtype: 'Square', Rect: [100, 500, 200, 560], C: [1, 0, 0], BS: { W: 2 } })
  add({
    Subtype: 'Ink',
    Rect: [300, 300, 400, 360],
    C: [0, 0, 1],
    InkList: [[300, 300, 350, 360, 400, 300]],
    BS: { W: 1 }
  })
  add({
    Subtype: 'Highlight',
    Rect: [72, 776, 260, 800],
    C: [1, 1, 0],
    QuadPoints: [72, 800, 260, 800, 72, 776, 260, 776]
  })
  add({
    Subtype: 'FreeText',
    Rect: [72, 600, 272, 640],
    Contents: PDFHexString.fromText('Old text'),
    DA: PDFString.of('/Helv 12 Tf 0 0 0 rg')
  })
  add({ Subtype: 'Link', Rect: [72, 100, 200, 120] })
  // Скрытая аннотация (флаг Hidden) в список не попадает.
  add({ Subtype: 'Square', Rect: [10, 10, 20, 20], F: 2 })
  return doc.save()
}

async function annotationsOf(bytes: Uint8Array, page = 0): Promise<PageAnnotation[]> {
  return listAnnotations(bytes, page)
}

function byType(list: readonly PageAnnotation[], subtype: string): PageAnnotation {
  const found = list.find((a) => a.subtype === subtype)
  if (!found) throw new Error(`нет аннотации ${subtype}`)
  return found
}

/** Все словари файла с заданным /Subtype (после сохранения MuPDF). */
async function countSubtype(bytes: Uint8Array, subtype: string): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  let count = 0
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of('Subtype')) === PDFName.of(subtype)) {
      count += 1
    }
  }
  return count
}

/** Текст, который видно во внешнем виде аннотаций страницы (а не в её содержимом). */
function annotationText(bytes: Uint8Array): string {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    return doc
      .loadPage(0)
      .getAnnotations()
      .map((a) => a.toDisplayList().toStructuredText('').asText())
      .join('\n')
  } finally {
    doc.destroy()
  }
}

describe('заметка-стикер в applyMarkup', () => {
  it('режим «Аннотацию»: /Text с текстом в UTF-16 и окном /Popup', async () => {
    const base = await (await PDFDocument.create()).save()
    const blank = await PDFDocument.load(base)
    blank.addPage([595, 842])
    const bytes = await applyMarkup(await blank.save(), [note], { mode: 'annotation' })
    const doc = await PDFDocument.load(bytes)
    const annots = doc.getPage(0).node.Annots()
    expect(annots?.size()).toBe(2)
    const text = doc.context.lookup(annots?.get(0), PDFDict)
    const popup = doc.context.lookup(annots?.get(1), PDFDict)
    expect(text.get(PDFName.of('Subtype'))).toBe(PDFName.of('Text'))
    expect(text.get(PDFName.of('Name'))).toBe(PDFName.of('Note'))
    const contents = text.get(PDFName.of('Contents'))
    expect(contents).toBeInstanceOf(PDFHexString)
    // UTF-16BE с BOM: FEFF, затем «П» = 041F.
    expect((contents as PDFHexString).asString().toUpperCase().startsWith('FEFF041F')).toBe(true)
    expect((contents as PDFHexString).decodeText()).toBe(note.text)
    expect(text.get(PDFName.of('Popup'))).toBe(annots?.get(1))
    expect(text.get(PDFName.of('AP'))).toBeInstanceOf(PDFDict)
    expect(popup.get(PDFName.of('Subtype'))).toBe(PDFName.of('Popup'))
    expect(popup.get(PDFName.of('Parent'))).toBe(annots?.get(0))

    // Другие программы видят заметку с текстом (MuPDF — как пример).
    const list = await annotationsOf(bytes)
    expect(list).toHaveLength(1)
    expect(list[0]?.subtype).toBe('Text')
    expect(list[0]?.contents).toBe(note.text)
    expect(list[0]?.rect.x).toBeCloseTo(100, 0)
  })

  it('режим «Часть содержимого»: только значок, аннотаций нет', async () => {
    const blank = await PDFDocument.create()
    blank.addPage([595, 842])
    const bytes = await applyMarkup(await blank.save(), [note], { mode: 'content' })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
    expect(await countSubtype(bytes, 'Text')).toBe(0)
    // Значок нарисован: в растре есть жёлтые пиксели там, где он стоит.
    const mu = new mupdf.PDFDocument(bytes)
    const pix = mu.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
    const x = 103
    const y = 842 - 710
    const offset = (y * pix.getWidth() + x) * 3
    const pixels = pix.getPixels()
    expect([pixels[offset], pixels[offset + 1], pixels[offset + 2]]).toEqual([255, 216, 107])
    mu.destroy()
  })
})

describe('аннотации документа', () => {
  it('listAnnotations: типы, рамки, цвет, без ссылок и скрытых', async () => {
    const list = await annotationsOf(await foreignFixture())
    expect(list.map((a) => a.subtype)).toEqual(['Square', 'Ink', 'Highlight', 'FreeText'])
    const square = byType(list, 'Square')
    expect(square.rect).toEqual({ x: 100, y: 500, width: 100, height: 60 })
    expect(square.color).toEqual([1, 0, 0])
    expect(square.can).toEqual({
      move: true,
      resize: true,
      color: true,
      opacity: true,
      text: false
    })
    expect(byType(list, 'Highlight').can.move).toBe(false)
    expect(byType(list, 'Highlight').quads).toEqual([{ x: 72, y: 776, width: 188, height: 24 }])
    const free = byType(list, 'FreeText')
    expect(free.contents).toBe('Old text')
    expect(free.fontSize).toBe(12)
    expect(free.can.text).toBe(true)
  })

  it('перенос и размер: рамка и геометрия пересчитаны, остальное на месте', async () => {
    const bytes = await foreignFixture()
    const list = await annotationsOf(bytes)
    const square = byType(list, 'Square')
    const ink = byType(list, 'Ink')
    const edited = await editAnnotations(bytes, [
      { pageIndex: 0, annotation: square, patch: { rect: { ...square.rect, x: 150, y: 450 } } },
      // Рамка Ink вдвое шире: точки растягиваются по x от левого края.
      {
        pageIndex: 0,
        annotation: ink,
        patch: { rect: { ...ink.rect, width: ink.rect.width * 2 } }
      }
    ])
    const after = await annotationsOf(edited)
    expect(after).toHaveLength(4)
    expect(byType(after, 'Square').rect).toEqual({ x: 150, y: 450, width: 100, height: 60 })
    const movedInk = byType(after, 'Ink')
    expect(movedInk.rect.width).toBeCloseTo(200, 3)
    expect(movedInk.ink[0]?.map((p) => Math.round(p.x))).toEqual([300, 400, 500])
    expect(byType(after, 'FreeText').rect).toEqual(byType(list, 'FreeText').rect)
  })

  it('пометка текста не двигается, заметка не растягивается', async () => {
    const blank = await PDFDocument.create()
    blank.addPage([595, 842])
    const bytes = await applyMarkup(await blank.save(), [note], { mode: 'annotation' })
    const [text] = await annotationsOf(bytes)
    if (!text) throw new Error('нет заметки')
    expect(text.can).toMatchObject({ move: true, resize: false, text: true })
    const moved = await editAnnotations(bytes, [
      { pageIndex: 0, annotation: text, patch: { rect: { x: 300, y: 300, width: 80, height: 80 } } }
    ])
    const [after] = await annotationsOf(moved)
    expect(after?.rect).toEqual({ x: 300, y: 300, width: NOTE_SIZE, height: NOTE_SIZE })
    // Окно /Popup переехало вместе со значком.
    const doc = await PDFDocument.load(moved)
    const annots = doc.getPage(0).node.Annots()
    const popupRef = doc.context.lookup(annots?.get(0), PDFDict).get(PDFName.of('Popup'))
    const popupRect = doc.context
      .lookup(popupRef, PDFDict)
      .lookup(PDFName.of('Rect'), PDFArray)
      .asRectangle()
    expect(popupRect.x).toBeCloseTo(300 + NOTE_SIZE + 4, 3)
  })

  it('цвет и непрозрачность перерисовывает MuPDF', async () => {
    const bytes = await foreignFixture()
    const highlight = byType(await annotationsOf(bytes), 'Highlight')
    const edited = await editAnnotations(bytes, [
      { pageIndex: 0, annotation: highlight, patch: { color: [0, 1, 0], opacity: 0.5 } }
    ])
    const after = byType(await annotationsOf(edited), 'Highlight')
    expect(after.color).toEqual([0, 1, 0])
    expect(after.opacity).toBeCloseTo(0.5, 2)
  })

  it('текст FreeText с кириллицей: вид строится заново, текст читается', async () => {
    const bytes = await foreignFixture()
    const free = byType(await annotationsOf(bytes), 'FreeText')
    const edited = await editAnnotations(
      bytes,
      [
        {
          pageIndex: 0,
          annotation: free,
          patch: {
            contents:
              'Новый текст аннотации, который не помещается в одну строку рамки и переносится на третью строку'
          }
        }
      ],
      { font }
    )
    const after = byType(await annotationsOf(edited), 'FreeText')
    expect(after.contents).toBe(
      'Новый текст аннотации, который не помещается в одну строку рамки и переносится на третью строку'
    )
    // Рамка выросла вниз под перенесённый текст, верх и ширина прежние.
    expect(after.rect.width).toBeCloseTo(free.rect.width, 3)
    expect(after.rect.y + after.rect.height).toBeCloseTo(free.rect.y + free.rect.height, 3)
    expect(after.rect.height).toBeGreaterThan(free.rect.height)
    expect(annotationText(edited)).toContain('Новый текст')
    await expect(
      editAnnotations(bytes, [{ pageIndex: 0, annotation: free, patch: { contents: 'x' } }])
    ).rejects.toBeInstanceOf(PdfContentError)
  })

  it('текст заметки меняется без перерисовки значка', async () => {
    const blank = await PDFDocument.create()
    blank.addPage([595, 842])
    const bytes = await applyMarkup(await blank.save(), [note], { mode: 'annotation' })
    const [text] = await annotationsOf(bytes)
    if (!text) throw new Error('нет заметки')
    const edited = await editAnnotations(bytes, [
      { pageIndex: 0, annotation: text, patch: { contents: 'Готово' } }
    ])
    expect((await annotationsOf(edited))[0]?.contents).toBe('Готово')
  })

  it('удаление убирает аннотацию и её окно из файла, остальные остаются', async () => {
    const blank = await PDFDocument.create()
    blank.addPage([595, 842])
    const markup: MarkupObject[] = [
      note,
      {
        id: 'r1',
        page: 1,
        kind: 'rect',
        color: '#c42b1c',
        opacity: 1,
        width: 2,
        rect: { x: 300, y: 300, width: 50, height: 40 }
      }
    ]
    const bytes = await applyMarkup(await blank.save(), markup, { mode: 'annotation' })
    expect(await countSubtype(bytes, 'Text')).toBe(1)
    expect(await countSubtype(bytes, 'Popup')).toBe(1)
    const list = await annotationsOf(bytes)
    const text = byType(list, 'Text')
    const removed = await removeAnnotations(bytes, [{ pageIndex: 0, annotation: text }])
    expect((await annotationsOf(removed)).map((a) => a.subtype)).toEqual(['Square'])
    expect(await countSubtype(removed, 'Text')).toBe(0)
    expect(await countSubtype(removed, 'Popup')).toBe(0)
    const doc = await PDFDocument.load(removed)
    expect(doc.getPage(0).node.Annots()?.size()).toBe(1)
  })

  it('устаревшая ссылка на аннотацию — понятная ошибка', async () => {
    const bytes = await foreignFixture()
    const square = byType(await annotationsOf(bytes), 'Square')
    const stale = { ...square, rect: { ...square.rect, x: square.rect.x + 30 } }
    await expect(
      removeAnnotations(bytes, [{ pageIndex: 0, annotation: stale }])
    ).rejects.toBeInstanceOf(PdfContentError)
  })
})
