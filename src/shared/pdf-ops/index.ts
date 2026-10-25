import { degrees, PDFDocument, type PDFPage } from 'pdf-lib'
import { load, PdfOpsError, PRODUCER, save } from './document'
import { chunkEveryN, expandRange, parsePageRanges } from './ranges'

export { PdfOpsError, PRODUCER } from './document'
export { applyMarkup, type ApplyMarkupOptions, type MarkupSaveMode } from './markup'

/**
 * Операции над PDF на pdf-lib. Все функции чистые: принимают байты, возвращают
 * новые байты и не зависят от Electron, поэтому тестируются в Node.
 * Нумерация страниц везде с 1, как в интерфейсе.
 */

function indices(doc: PDFDocument, pages: readonly number[]): number[] {
  const total = doc.getPageCount()
  const unique = [...new Set(pages)].sort((a, b) => a - b)
  for (const p of unique) {
    if (!Number.isInteger(p) || p < 1 || p > total)
      throw new PdfOpsError(`Страницы ${p} нет в документе (всего ${total}).`)
  }
  return unique.map((p) => p - 1)
}

/** Поворот выбранных страниц на delta градусов по часовой стрелке (в самом документе, не вида). */
export async function rotatePages(
  bytes: Uint8Array,
  pages: readonly number[],
  delta: 90 | 180 | 270
): Promise<Uint8Array> {
  const doc = await load(bytes)
  for (const index of indices(doc, pages)) {
    const page = doc.getPage(index)
    page.setRotation(degrees((page.getRotation().angle + delta) % 360))
  }
  return save(doc)
}

export async function deletePages(
  bytes: Uint8Array,
  pages: readonly number[]
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const toRemove = indices(doc, pages)
  if (toRemove.length >= doc.getPageCount())
    throw new PdfOpsError('Нельзя удалить все страницы: в документе должна остаться хотя бы одна.')
  for (const index of [...toRemove].reverse()) doc.removePage(index)
  return save(doc)
}

/**
 * Перестановка страниц по полной перестановке номеров. Страницы переставляются
 * внутри того же документа, поэтому закладки, формы и метаданные сохраняются.
 */
export async function reorderPages(
  bytes: Uint8Array,
  order: readonly number[]
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const total = doc.getPageCount()
  const sorted = [...order].sort((a, b) => a - b)
  if (sorted.length !== total || sorted.some((p, i) => p !== i + 1)) {
    throw new PdfOpsError('Порядок должен содержать каждую страницу ровно один раз.')
  }
  const pages: PDFPage[] = doc.getPages()
  for (let i = total - 1; i >= 0; i -= 1) doc.removePage(i)
  for (const p of order) {
    const page = pages[p - 1]
    if (page) doc.addPage(page)
  }
  return save(doc)
}

export async function insertBlankPage(bytes: Uint8Array, afterPage: number): Promise<Uint8Array> {
  const doc = await load(bytes)
  const total = doc.getPageCount()
  const reference = doc.getPage(Math.min(Math.max(afterPage, 1), total) - 1)
  const { width, height } = reference.getSize()
  const index = Math.min(Math.max(afterPage, 0), total)
  doc.insertPage(index, [width, height])
  return save(doc)
}

/** Копирует страницы другого документа (все или указанные) после страницы afterPage (0 — в начало). */
export async function insertPagesFrom(
  bytes: Uint8Array,
  source: Uint8Array,
  afterPage: number,
  pages?: readonly number[]
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const src = await load(source)
  const srcIndices = pages ? indices(src, pages) : src.getPageIndices()
  const copied = await doc.copyPages(src, srcIndices)
  let index = Math.min(Math.max(afterPage, 0), doc.getPageCount())
  for (const page of copied) {
    doc.insertPage(index, page)
    index += 1
  }
  return save(doc)
}

/** Новый документ из выбранных страниц в порядке их следования в исходнике. */
export async function extractPages(
  bytes: Uint8Array,
  pages: readonly number[]
): Promise<Uint8Array> {
  const src = await load(bytes)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, indices(src, pages))
  for (const page of copied) out.addPage(page)
  copyInfo(src, out)
  return save(out)
}

/** Дублирует выбранные страницы: копия вставляется сразу после оригинала. */
export async function duplicatePages(
  bytes: Uint8Array,
  pages: readonly number[]
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const targets = indices(doc, pages)
  const copies = await doc.copyPages(doc, targets)
  // Вставляем с конца, чтобы индексы предыдущих целей не сдвигались.
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const copy = copies[i]
    const at = targets[i]
    if (copy && at !== undefined) doc.insertPage(at + 1, copy)
  }
  return save(doc)
}

export async function mergeDocuments(documents: readonly Uint8Array[]): Promise<Uint8Array> {
  if (documents.length === 0) throw new PdfOpsError('Добавьте хотя бы один файл.')
  const out = await PDFDocument.create()
  let first: PDFDocument | null = null
  for (const bytes of documents) {
    const src = await load(bytes)
    first ??= src
    const copied = await out.copyPages(src, src.getPageIndices())
    for (const page of copied) out.addPage(page)
  }
  if (first) copyInfo(first, out)
  return save(out)
}

export interface SplitPart {
  from: number
  to: number
  bytes: Uint8Array
}

export async function splitByRanges(bytes: Uint8Array, spec: string): Promise<SplitPart[]> {
  const src = await load(bytes)
  const ranges = parsePageRanges(spec, src.getPageCount())
  return splitParts(src, ranges)
}

export async function splitEveryN(bytes: Uint8Array, n: number): Promise<SplitPart[]> {
  const src = await load(bytes)
  return splitParts(src, chunkEveryN(src.getPageCount(), n))
}

export async function splitToPages(bytes: Uint8Array): Promise<SplitPart[]> {
  const src = await load(bytes)
  return splitParts(src, chunkEveryN(src.getPageCount(), 1))
}

async function splitParts(
  src: PDFDocument,
  ranges: readonly [number, number][]
): Promise<SplitPart[]> {
  const parts: SplitPart[] = []
  for (const range of ranges) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(
      src,
      expandRange(range).map((p) => p - 1)
    )
    for (const page of copied) out.addPage(page)
    copyInfo(src, out)
    parts.push({ from: range[0], to: range[1], bytes: await save(out) })
  }
  return parts
}

function copyInfo(src: PDFDocument, out: PDFDocument): void {
  const title = src.getTitle()
  const author = src.getAuthor()
  const subject = src.getSubject()
  const keywords = src.getKeywords()
  if (title !== undefined) out.setTitle(title)
  if (author !== undefined) out.setAuthor(author)
  if (subject !== undefined) out.setSubject(subject)
  if (keywords !== undefined) out.setKeywords(keywords.split(/[,;]\s*/))
  out.setCreator(PRODUCER)
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount()
}

export {
  computeMoveOrder,
  formatPageList,
  isIdentityOrder,
  PageRangeError,
  parsePageRanges
} from './ranges'
