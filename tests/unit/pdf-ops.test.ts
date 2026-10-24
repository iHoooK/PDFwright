import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  deletePages,
  duplicatePages,
  extractPages,
  insertBlankPage,
  insertPagesFrom,
  mergeDocuments,
  pageCount,
  PdfOpsError,
  reorderPages,
  rotatePages,
  splitByRanges,
  splitEveryN,
  splitToPages
} from '@shared/pdf-ops'
import {
  chunkEveryN,
  computeMoveOrder,
  formatPageList,
  isIdentityOrder,
  PageRangeError,
  parsePageRanges
} from '@shared/pdf-ops/ranges'

let fixture: Uint8Array

/** Текст первой строки каждой страницы — чтобы проверять порядок после операций. */
async function pageLabels(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((page) => {
    const custom = page.node.get(PDFName.of('PWLabel'))
    if (custom instanceof PDFString) return custom.decodeText()
    const contents = page.node.Contents()
    const text = contents ? String(doc.context.lookup(contents)) : ''
    const match = /\((PDFwright test page \d)\)/.exec(text)
    return match?.[1] ?? '?'
  })
}

/** Документ, где каждая страница помечена служебным ключом PWLabel в своём словаре. */
async function makeDoc(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const label of labels) {
    const page = doc.addPage([400, 500])
    page.node.set(PDFName.of('PWLabel'), PDFString.of(label))
  }
  doc.setTitle('made')
  return doc.save()
}

beforeAll(async () => {
  fixture = new Uint8Array(await readFile(resolve('tests/fixtures/simple.pdf')))
})

describe('ranges', () => {
  it('разбирает диапазоны с открытым концом', () => {
    expect(parsePageRanges('1-3, 5, 7-', 9)).toEqual([
      [1, 3],
      [5, 5],
      [7, 9]
    ])
    expect(parsePageRanges('-2', 5)).toEqual([[1, 2]])
  })
  it('сообщает о мусоре и выходе за пределы', () => {
    expect(() => parsePageRanges('', 3)).toThrow(PageRangeError)
    expect(() => parsePageRanges('a-b', 3)).toThrow(PageRangeError)
    expect(() => parsePageRanges('2-9', 3)).toThrow(/пределы/)
    expect(() => parsePageRanges('3-1', 3)).toThrow(/начало больше/)
  })
  it('режет на пакеты', () => {
    expect(chunkEveryN(7, 3)).toEqual([
      [1, 3],
      [4, 6],
      [7, 7]
    ])
    expect(() => chunkEveryN(7, 0)).toThrow(PageRangeError)
  })
  it('считает порядок после перетаскивания', () => {
    expect(computeMoveOrder(5, [2, 3], 5)).toEqual([1, 4, 2, 3, 5])
    expect(computeMoveOrder(5, [5], 1)).toEqual([5, 1, 2, 3, 4])
    expect(computeMoveOrder(5, [1], 6)).toEqual([2, 3, 4, 5, 1])
    expect(computeMoveOrder(5, [2], 2)).toEqual([1, 2, 3, 4, 5])
    expect(isIdentityOrder(computeMoveOrder(4, [], 2))).toBe(true)
  })
  it('форматирует список страниц', () => {
    expect(formatPageList([3, 1, 2, 5, 9, 8])).toBe('1-3, 5, 8-9')
    expect(formatPageList([])).toBe('')
  })
})

describe('pdf-ops', () => {
  it('поворачивает страницы и сохраняет остальные', async () => {
    const out = await rotatePages(fixture, [2], 90)
    // updateMetadata: false, иначе pdf-lib при загрузке сам перепишет Producer
    const doc = await PDFDocument.load(out, { updateMetadata: false })
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0])
    expect(doc.getProducer()).toBe('PDFwright')
  })

  it('удаляет страницы и не даёт удалить все', async () => {
    const out = await deletePages(fixture, [1, 3])
    expect(await pageLabels(out)).toEqual(['PDFwright test page 2'])
    await expect(deletePages(fixture, [1, 2, 3])).rejects.toThrow(PdfOpsError)
  })

  it('переставляет страницы и сохраняет закладки', async () => {
    const out = await reorderPages(fixture, [3, 1, 2])
    expect(await pageLabels(out)).toEqual([
      'PDFwright test page 3',
      'PDFwright test page 1',
      'PDFwright test page 2'
    ])
    const doc = await PDFDocument.load(out)
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(true)
    await expect(reorderPages(fixture, [1, 1, 2])).rejects.toThrow(PdfOpsError)
  })

  it('вставляет пустую страницу нужного размера', async () => {
    const out = await insertBlankPage(fixture, 1)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(4)
    expect(doc.getPage(1).getSize()).toEqual({ width: 595, height: 842 })
  })

  it('вставляет страницы из другого файла и извлекает выбранные', async () => {
    const other = await makeDoc(['label A', 'label B'])
    const merged = await insertPagesFrom(fixture, other, 1, [2])
    expect(await pageLabels(merged)).toEqual([
      'PDFwright test page 1',
      'label B',
      'PDFwright test page 2',
      'PDFwright test page 3'
    ])
    const extracted = await extractPages(merged, [2, 4])
    expect(await pageLabels(extracted)).toEqual(['label B', 'PDFwright test page 3'])
    expect((await PDFDocument.load(extracted)).getTitle()).toBe('PDFwright fixture')
  })

  it('дублирует страницы сразу после оригинала', async () => {
    const out = await duplicatePages(fixture, [1, 3])
    expect(await pageLabels(out)).toEqual([
      'PDFwright test page 1',
      'PDFwright test page 1',
      'PDFwright test page 2',
      'PDFwright test page 3',
      'PDFwright test page 3'
    ])
  })

  it('объединяет документы', async () => {
    const other = await makeDoc(['label A'])
    const out = await mergeDocuments([other, fixture])
    expect(await pageLabels(out)).toEqual([
      'label A',
      'PDFwright test page 1',
      'PDFwright test page 2',
      'PDFwright test page 3'
    ])
    expect(await pageCount(out)).toBe(4)
    await expect(mergeDocuments([])).rejects.toThrow(PdfOpsError)
  })

  it('разделяет по диапазонам, по N и на страницы', async () => {
    const byRanges = await splitByRanges(fixture, '1, 2-')
    expect(byRanges.map((p) => [p.from, p.to])).toEqual([
      [1, 1],
      [2, 3]
    ])
    expect(await pageLabels(byRanges[1]?.bytes ?? new Uint8Array())).toEqual([
      'PDFwright test page 2',
      'PDFwright test page 3'
    ])
    expect((await splitEveryN(fixture, 2)).map((p) => [p.from, p.to])).toEqual([
      [1, 2],
      [3, 3]
    ])
    expect(await splitToPages(fixture)).toHaveLength(3)
  })

  it('отвергает не-PDF', async () => {
    await expect(pageCount(new Uint8Array([1, 2, 3]))).rejects.toThrow(PdfOpsError)
  })
})
