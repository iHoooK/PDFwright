import type { Font, Image, PDFDocument as MuDocument, PDFObject, PDFPage as MuPage } from 'mupdf'
import { blankRanges, findXObjectCalls, type XObjectCall } from './content-stream'
import {
  boxToRect,
  concat,
  fitContain,
  invert,
  isValidRect,
  normalizeVector,
  pdfNumber,
  rectDistance,
  rectToBox,
  rectToRectMatrix,
  transformBox,
  transformPoint,
  transformVector,
  type BoxRect,
  type Matrix
} from './geometry'
import { loadMupdf, type Mupdf } from './mupdf'
import {
  PdfContentError,
  type EraseOptions,
  type ImageRef,
  type PageImage,
  type PageObjects,
  type PageTextLine,
  type PdfSpaceRect,
  type ReplaceTextOptions,
  type RgbColor,
  type TextLineRef
} from './types'

/**
 * Правка существующего содержимого страниц на MuPDF. Все функции чистые:
 * принимают байты PDF и возвращают новые, исходный буфер не меняется (MuPDF
 * копирует его в память WASM), документ освобождается после каждой операции.
 * Страницы нумеруются с 0 (pageIndex), координаты — в пространстве PDF (см. types.ts).
 *
 * Внутри MuPDF работает в своём «пространстве страницы»: начало вверху слева,
 * Y вниз, поворот /Rotate уже применён. page.getTransform() переводит
 * пространство PDF в него, обратная матрица — обратно.
 */

const PRODUCER = 'PDFwright'
/** Допуск при поиске строки или картинки по рамке из listPageObjects, в пунктах. */
const MATCH_TOLERANCE = 2

interface RawLine {
  text: string
  /** Рамка в пространстве MuPDF. */
  box: BoxRect
  origin: [number, number]
  dir: [number, number]
  font: Font | null
  size: number
  color: RgbColor
}

interface RawImage {
  box: BoxRect
  /** Матрица картинки в пространстве MuPDF (единичный квадрат → страница). */
  transform: Matrix
  image: Image
}

interface Extracted {
  lines: RawLine[]
  images: RawImage[]
  dispose: () => void
}

interface PageContext {
  mupdf: Mupdf
  doc: MuDocument
  page: MuPage
  pageObj: PDFObject
  /** Пространство PDF → пространство MuPDF. */
  toMu: Matrix
  /** Пространство MuPDF → пространство PDF. */
  toPdf: Matrix
}

// ---------------------------------------------------------------------------
// Открытие, сохранение, обход страницы

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openDocument(mupdf: Mupdf, bytes: Uint8Array): MuDocument {
  let doc: MuDocument
  try {
    doc = new mupdf.PDFDocument(bytes)
  } catch (error) {
    throw new PdfContentError(`Не удалось разобрать PDF: ${errorText(error)}`)
  }
  if (doc.needsPassword()) {
    doc.destroy()
    throw new PdfContentError(
      'Документ зашифрован. Правка защищённых паролем файлов появится в следующих версиях.'
    )
  }
  return doc
}

function checkPageIndex(doc: MuDocument, pageIndex: number): void {
  const total = doc.countPages()
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= total) {
    throw new PdfContentError(`Страницы ${pageIndex + 1} нет в документе (всего ${total}).`)
  }
}

function pdfDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function saveDocument(doc: MuDocument): Uint8Array {
  doc.setMetaData('info:Producer', PRODUCER)
  doc.setMetaData('info:ModDate', pdfDate(new Date()))
  // garbage выбрасывает объекты, на которые больше никто не ссылается:
  // удалённые картинки и шрифты исчезают из файла, а не только со страницы.
  const buffer = doc.saveToBuffer('garbage,compress')
  try {
    return buffer.asUint8Array().slice()
  } finally {
    buffer.destroy()
  }
}

async function withPage<T>(
  bytes: Uint8Array,
  pageIndex: number,
  fn: (ctx: PageContext) => T,
  beforeLoad?: (doc: MuDocument) => void
): Promise<T> {
  const mupdf = await loadMupdf()
  const doc = openDocument(mupdf, bytes)
  try {
    checkPageIndex(doc, pageIndex)
    beforeLoad?.(doc)
    const page = doc.loadPage(pageIndex)
    try {
      const toMu = page.getTransform()
      return fn({ mupdf, doc, page, pageObj: page.getObject(), toMu, toPdf: invert(toMu) })
    } finally {
      page.destroy()
    }
  } finally {
    doc.destroy()
  }
}

/**
 * Изменение одной страницы с сохранением документа. Чужие redaction-аннотации
 * (размеченные в другой программе, но не применённые) на время операции
 * убираются со страницы, чтобы applyRedactions не применил и их.
 */
async function modifyPage(
  bytes: Uint8Array,
  pageIndex: number,
  fn: (ctx: PageContext) => void
): Promise<Uint8Array> {
  let foreign: PDFObject[] = []
  return withPage(
    bytes,
    pageIndex,
    (ctx) => {
      fn(ctx)
      restoreAnnotations(ctx.doc, ctx.pageObj, foreign)
      return saveDocument(ctx.doc)
    },
    (doc) => {
      foreign = detachRedactAnnotations(doc, doc.findPage(pageIndex))
    }
  )
}

function detachRedactAnnotations(doc: MuDocument, pageObj: PDFObject): PDFObject[] {
  const annots = pageObj.get('Annots')
  if (!annots.isArray()) return []
  const keep = doc.newArray()
  const redacts: PDFObject[] = []
  annots.forEach((annot) => {
    const subtype = annot.get('Subtype')
    if (subtype.isName() && subtype.asName() === 'Redact') redacts.push(annot)
    else keep.push(annot)
  })
  if (redacts.length > 0) pageObj.put('Annots', keep)
  return redacts
}

function restoreAnnotations(doc: MuDocument, pageObj: PDFObject, annots: PDFObject[]): void {
  if (annots.length === 0) return
  let list = pageObj.get('Annots')
  if (!list.isArray()) list = pageObj.put('Annots', doc.newArray()) as PDFObject
  for (const annot of annots) list.push(annot)
}

function rgb(color: readonly number[]): RgbColor {
  const [a = 0, b = a, c = a] = color
  return color.length >= 3 ? [a, b, c] : [a, a, a]
}

function extract(page: MuPage): Extracted {
  const lines: RawLine[] = []
  const images: RawImage[] = []
  let current: RawLine | null = null
  const stext = page.toStructuredText('preserve-images')
  try {
    stext.walk({
      beginLine(bbox, _wmode, dir) {
        current = {
          text: '',
          box: bbox,
          origin: [bbox[0], bbox[3]],
          dir,
          font: null,
          size: 0,
          color: [0, 0, 0]
        }
      },
      onChar(c, origin, font, size, _quad, color) {
        if (current === null) {
          font.destroy()
          return
        }
        if (current.font === null) {
          current.font = font
          current.origin = origin
          current.size = size
          current.color = rgb(color)
        } else {
          font.destroy()
        }
        current.text += c
      },
      endLine() {
        if (current !== null) lines.push(current)
        current = null
      },
      onImageBlock(bbox, transform, image) {
        images.push({ box: bbox, transform, image })
      }
    })
  } finally {
    stext.destroy()
  }
  return {
    lines,
    images,
    dispose: () => {
      for (const line of lines) line.font?.destroy()
      for (const item of images) item.image.destroy()
    }
  }
}

function withExtracted<T>(page: MuPage, fn: (data: Extracted) => T): T {
  const data = extract(page)
  try {
    return fn(data)
  } finally {
    data.dispose()
  }
}

function hasText(line: RawLine): boolean {
  return line.text.trim() !== ''
}

// ---------------------------------------------------------------------------
// 10.2 Объекты страницы

function toTextLine(line: RawLine, index: number, toPdf: Matrix): PageTextLine {
  const [ox, oy] = transformPoint(toPdf, line.origin[0], line.origin[1])
  const [dx, dy] = transformVector(toPdf, line.dir[0], line.dir[1])
  return {
    kind: 'text',
    index,
    text: line.text,
    rect: boxToRect(transformBox(toPdf, line.box)),
    origin: { x: ox, y: oy },
    direction: normalizeVector(dx, dy),
    fontName: line.font?.getName() ?? '',
    fontSize: line.size,
    bold: line.font?.isBold() ?? false,
    italic: line.font?.isItalic() ?? false,
    color: line.color
  }
}

function toPageImage(item: RawImage, index: number, toPdf: Matrix): PageImage {
  return {
    kind: 'image',
    index,
    rect: boxToRect(transformBox(toPdf, item.box)),
    pixelWidth: item.image.getWidth(),
    pixelHeight: item.image.getHeight()
  }
}

/** Строки текста и картинки страницы в пространстве PDF. */
export async function listPageObjects(bytes: Uint8Array, pageIndex: number): Promise<PageObjects> {
  return withPage(bytes, pageIndex, ({ page, toPdf }) =>
    withExtracted(page, ({ lines, images }) => ({
      pageIndex,
      pageBox: boxToRect(transformBox(toPdf, page.getBounds())),
      lines: lines.filter(hasText).map((line, i) => toTextLine(line, i, toPdf)),
      images: images.map((item, i) => toPageImage(item, i, toPdf))
    }))
  )
}

// ---------------------------------------------------------------------------
// Redaction

interface RedactMethods {
  text: boolean
  image: 'none' | 'pixels'
  lineArt: 'none' | 'covered'
}

function redact(ctx: PageContext, boxes: readonly BoxRect[], methods: RedactMethods): void {
  const { PDFPage } = ctx.mupdf
  for (const box of boxes) {
    // Без цвета заливки и с black_boxes = false: содержимое вырезается, на его месте пусто.
    ctx.page.createAnnotation('Redact').setRect(box)
  }
  ctx.page.applyRedactions(
    false,
    methods.image === 'pixels' ? PDFPage.REDACT_IMAGE_PIXELS : PDFPage.REDACT_IMAGE_NONE,
    methods.lineArt === 'covered'
      ? PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED
      : PDFPage.REDACT_LINE_ART_NONE,
    methods.text ? PDFPage.REDACT_TEXT_REMOVE : PDFPage.REDACT_TEXT_NONE
  )
}

function checkRect(rect: PdfSpaceRect, what: string): void {
  if (!isValidRect(rect)) throw new PdfContentError(`Некорректная область: ${what}.`)
}

/**
 * 10.3 Вырезает содержимое в областях: текст, задетый областью, удаляется из
 * файла (не находится поиском), картинки целиком внутри области удаляются,
 * задетые частично теряют пиксели в области, векторные контуры удаляются,
 * если целиком лежат в области. Ничего не закрашивается.
 */
export async function eraseRegions(
  bytes: Uint8Array,
  pageIndex: number,
  rects: readonly PdfSpaceRect[],
  options: EraseOptions = {}
): Promise<Uint8Array> {
  const { text = true, images = true, graphics = true } = options
  rects.forEach((rect, i) => {
    checkRect(rect, `область ${i + 1}`)
  })
  if (rects.length === 0 || (!text && !images && !graphics)) return bytes.slice()
  return modifyPage(bytes, pageIndex, (ctx) => {
    const boxes = rects.map((rect) => transformBox(ctx.toMu, rectToBox(rect)))
    redact(ctx, boxes, {
      text,
      image: images ? 'pixels' : 'none',
      lineArt: graphics ? 'covered' : 'none'
    })
  })
}

// ---------------------------------------------------------------------------
// Поток содержимого и ресурсы страницы

const encoder = new TextEncoder()

function streamBytes(obj: PDFObject): Uint8Array {
  const buffer = obj.readStream()
  try {
    return buffer.asUint8Array().slice()
  } finally {
    buffer.destroy()
  }
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Все потоки /Contents страницы, склеенные через перевод строки. */
function readContent(pageObj: PDFObject): Uint8Array {
  const contents = pageObj.get('Contents')
  const parts: Uint8Array[] = []
  if (contents.isArray()) {
    contents.forEach((item) => {
      if (item.isStream()) parts.push(streamBytes(item), encoder.encode('\n'))
    })
  } else if (contents.isStream()) {
    parts.push(streamBytes(contents))
  }
  return joinBytes(parts)
}

/**
 * Записывает содержимое страницы одним потоком. Исходное содержимое берётся в
 * q … Q, чтобы его незакрытые cm и настройки графики не сдвинули добавленное.
 */
function writeContent(ctx: PageContext, content: Uint8Array, appended: string): void {
  const data = joinBytes([encoder.encode('q\n'), content, encoder.encode(`\nQ\n${appended}\n`)])
  ctx.pageObj.put('Contents', ctx.doc.addStream(data, {}))
}

/** Копия словаря, чтобы правка не задела другие страницы с общими ресурсами. */
function copyDictionary(doc: MuDocument, source: PDFObject): PDFObject {
  const copy = doc.newDictionary()
  if (source.isDictionary()) {
    source.forEach((value, key) => {
      copy.put(String(key), value)
    })
  }
  return copy
}

/** Собственный (не общий и не унаследованный) словарь ресурсов страницы. */
function ownResources(ctx: PageContext): PDFObject {
  const own = ctx.pageObj.get('Resources')
  if (own.isDictionary() && !own.isIndirect()) return own
  return ctx.pageObj.put(
    'Resources',
    copyDictionary(ctx.doc, ctx.pageObj.getInheritable('Resources'))
  ) as PDFObject
}

function ownSubDictionary(ctx: PageContext, key: 'Font' | 'XObject'): PDFObject {
  const resources = ownResources(ctx)
  const sub = resources.get(key)
  if (sub.isDictionary() && !sub.isIndirect()) return sub
  return resources.put(key, copyDictionary(ctx.doc, sub)) as PDFObject
}

function addResource(
  ctx: PageContext,
  key: 'Font' | 'XObject',
  prefix: string,
  ref: PDFObject
): string {
  const dict = ownSubDictionary(ctx, key)
  let n = 1
  while (!dict.get(`${prefix}${n}`).isNull()) n += 1
  const name = `${prefix}${n}`
  dict.put(name, ref)
  return name
}

// ---------------------------------------------------------------------------
// 10.4 Замена текста

function findLine(lines: readonly RawLine[], ref: TextLineRef, toPdf: Matrix): number {
  let best = -1
  let bestDistance = Infinity
  lines.forEach((line, i) => {
    if (line.text !== ref.text) return
    const distance = rectDistance(boxToRect(transformBox(toPdf, line.box)), ref.rect)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  if (best < 0 || bestDistance > MATCH_TOLERANCE) {
    throw new PdfContentError('Строка не найдена на странице: документ изменился.')
  }
  return best
}

/**
 * Область вырезания строки. MuPDF удаляет каждый глиф, который хоть немного
 * пересекает область, а рамки соседних строк при обычном интерлиньяже
 * перекрываются. Поэтому рамка строки обрезается по рамкам соседей: сверху и
 * снизу — по строкам выше и ниже, слева и справа — по строкам того же ряда.
 */
function lineRedactionBox(lines: readonly RawLine[], target: number): BoxRect {
  const line = lines[target]
  if (!line) throw new PdfContentError('Строка не найдена на странице.')
  const box: BoxRect = [...line.box]
  const horizontal = Math.abs(line.dir[1]) < 1e-3
  if (horizontal) {
    lines.forEach((other, i) => {
      if (i === target || !hasText(other)) return
      const o = other.box
      const overlapX = Math.min(box[2], o[2]) - Math.max(box[0], o[0])
      const overlapY = Math.min(box[3], o[3]) - Math.max(box[1], o[1])
      if (overlapX <= 0 || overlapY <= 0) return
      const sameRow = overlapY > 0.5 * Math.min(box[3] - box[1], o[3] - o[1])
      if (sameRow) {
        if (o[0] + o[2] > box[0] + box[2]) box[2] = Math.min(box[2], o[0])
        else box[0] = Math.max(box[0], o[2])
      } else if (o[1] + o[3] > box[1] + box[3]) {
        box[3] = Math.min(box[3], o[1])
      } else {
        box[1] = Math.max(box[1], o[3])
      }
    })
  }
  if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) {
    throw new PdfContentError('Строку нельзя вырезать, не задев соседний текст.')
  }
  return box
}

function lineTexts(lines: readonly RawLine[], skip = -1): string[] {
  return lines
    .filter((line, i) => i !== skip && hasText(line))
    .map((line) => line.text.trim())
    .sort()
}

function sameTexts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((text, i) => text === b[i])
}

function missingGlyphs(font: Font, text: string): string[] {
  const missing = new Set<string>()
  for (const ch of text) {
    if (font.encodeCharacter(ch.codePointAt(0) ?? 0) <= 0) missing.add(ch)
  }
  return [...missing]
}

/** Встроенный в MuPDF шрифт (Nimbus, с кириллицей) того же начертания, что исходный. */
function builtinFontName(font: Font | null): string {
  const bold = font?.isBold() ?? false
  const italic = font?.isItalic() ?? false
  if (font?.isMono()) {
    return `Courier${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`
  }
  if (font?.isSerif()) {
    if (bold && italic) return 'Times-BoldItalic'
    if (bold) return 'Times-Bold'
    return italic ? 'Times-Italic' : 'Times-Roman'
  }
  return `Helvetica${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`
}

interface ChosenFont {
  font: Font
  ref: PDFObject
  owned: boolean
}

/**
 * Тот же шрифт, если в нём есть все глифы нового текста и его можно встроить
 * заново (у Type3 и шрифтов без программы глифов нельзя), иначе запасной.
 */
function chooseFont(
  ctx: PageContext,
  original: Font | null,
  text: string,
  options: ReplaceTextOptions
): ChosenFont {
  if (original && missingGlyphs(original, text).length === 0) {
    try {
      return { font: original, ref: ctx.doc.addFont(original), owned: false }
    } catch {
      // Шрифт нельзя встроить повторно — пишем запасным.
    }
  }
  let fallback: Font
  try {
    fallback = options.fallbackFont
      ? new ctx.mupdf.Font('PDFwrightFallback', options.fallbackFont)
      : new ctx.mupdf.Font(builtinFontName(original))
  } catch (error) {
    throw new PdfContentError(`Не удалось загрузить запасной шрифт: ${errorText(error)}`)
  }
  const missing = missingGlyphs(fallback, text)
  if (missing.length > 0) {
    fallback.destroy()
    throw new PdfContentError(`В шрифтах нет символов: ${missing.join(' ')}`)
  }
  return { font: fallback, ref: ctx.doc.addFont(fallback), owned: true }
}

/** Шрифт добавлен как Type0 с Identity-H, поэтому код символа — номер глифа. */
function glyphHex(font: Font, text: string): string {
  let hex = ''
  for (const ch of text) {
    hex += font
      .encodeCharacter(ch.codePointAt(0) ?? 0)
      .toString(16)
      .padStart(4, '0')
  }
  return hex
}

function textOperators(
  fontName: string,
  size: number,
  color: RgbColor,
  tm: Matrix,
  hex: string
): string {
  return [
    'q BT',
    `/${fontName} ${pdfNumber(size)} Tf`,
    `${color.map(pdfNumber).join(' ')} rg`,
    `${tm.map(pdfNumber).join(' ')} Tm`,
    `<${hex}> Tj`,
    'ET Q'
  ].join('\n')
}

function cutLine(ctx: PageContext, lines: readonly RawLine[], target: number): void {
  const before = lineTexts(lines, target)
  redact(ctx, [lineRedactionBox(lines, target)], { text: true, image: 'none', lineArt: 'none' })
  const after = withExtracted(ctx.page, (data) => lineTexts(data.lines))
  if (!sameTexts(before, after)) {
    throw new PdfContentError('Строку нельзя вырезать, не задев соседний текст.')
  }
}

/** Удаляет строку текста целиком (вырезает из файла). */
export async function removeTextLine(
  bytes: Uint8Array,
  pageIndex: number,
  line: TextLineRef
): Promise<Uint8Array> {
  return replaceText(bytes, pageIndex, line, '')
}

/**
 * 10.4 Заменяет строку: вырезает её и пишет новый текст с той же базовой
 * линии, тем же кеглем и цветом. Шрифт тот же, если в нём есть все глифы,
 * иначе запасной с кириллицей (см. ReplaceTextOptions). Переноса нет: длинный
 * текст выйдет за прежнюю рамку. Пустой текст удаляет строку.
 */
export async function replaceText(
  bytes: Uint8Array,
  pageIndex: number,
  line: TextLineRef,
  newText: string,
  options: ReplaceTextOptions = {}
): Promise<Uint8Array> {
  const text = newText.replace(/[\r\n\t]+/g, ' ')
  return modifyPage(bytes, pageIndex, (ctx) => {
    withExtracted(ctx.page, ({ lines }) => {
      const target = findLine(lines, line, ctx.toPdf)
      const raw = lines[target]
      if (!raw) return
      cutLine(ctx, lines, target)
      if (text.trim() === '') return

      const chosen = chooseFont(ctx, raw.font, text, options)
      try {
        const fontName = addResource(ctx, 'Font', 'PWF', chosen.ref)
        const [ox, oy] = transformPoint(ctx.toPdf, raw.origin[0], raw.origin[1])
        const [dx, dy] = transformVector(ctx.toPdf, raw.dir[0], raw.dir[1])
        const dir = normalizeVector(dx, dy)
        const tm: Matrix = [dir.x, dir.y, -dir.y, dir.x, ox, oy]
        const ops = textOperators(fontName, raw.size, raw.color, tm, glyphHex(chosen.font, text))
        writeContent(ctx, readContent(ctx.pageObj), ops)
      } finally {
        if (chosen.owned) chosen.font.destroy()
      }
    })
  })
}

// ---------------------------------------------------------------------------
// 10.5 Картинки

function findImage(images: readonly RawImage[], ref: ImageRef, toPdf: Matrix): RawImage {
  let best: RawImage | null = null
  let bestDistance = Infinity
  for (const item of images) {
    if (item.image.getWidth() !== ref.pixelWidth || item.image.getHeight() !== ref.pixelHeight) {
      continue
    }
    const distance = rectDistance(boxToRect(transformBox(toPdf, item.box)), ref.rect)
    // При равенстве берётся более поздняя, то есть верхняя картинка.
    if (distance <= bestDistance) {
      best = item
      bestDistance = distance
    }
  }
  if (!best || bestDistance > MATCH_TOLERANCE) {
    throw new PdfContentError('Картинка не найдена на странице: документ изменился.')
  }
  return best
}

function closeMatrices(a: Matrix, b: Matrix): boolean {
  return a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 0.01 + 1e-4 * Math.abs(v))
}

interface LocatedCall {
  content: Uint8Array
  call: XObjectCall
}

/**
 * Ищет в потоке страницы вызов «/Имя Do», который рисует эту картинку: тот же
 * размер в пикселях и та же матрица. Не находит картинки внутри форм и
 * встроенные (BI … EI) — для них остаётся redaction.
 */
function locateImageCall(ctx: PageContext, userCtm: Matrix, item: RawImage): LocatedCall | null {
  const content = readContent(ctx.pageObj)
  const xobjects = ctx.pageObj.getInheritable('Resources').get('XObject')
  if (!xobjects.isDictionary()) return null
  const calls = findXObjectCalls(content)
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i]
    if (!call || !closeMatrices(call.ctm, userCtm)) continue
    const xobject = xobjects.get(call.name)
    const subtype = xobject.get('Subtype')
    if (
      subtype.isName() &&
      subtype.asName() === 'Image' &&
      xobject.get('Width').asNumber() === item.image.getWidth() &&
      xobject.get('Height').asNumber() === item.image.getHeight()
    ) {
      return { content, call }
    }
  }
  return null
}

/**
 * В PDF первая строка пикселей лежит вверху единичного квадрата, и MuPDF
 * отдаёт матрицу картинки уже с этим переворотом. Чтобы получить матрицу
 * вызова Do из потока, переворот снимаем (матрица обратна сама себе).
 */
const IMAGE_FLIP: Matrix = [1, 0, 0, -1, 0, 1]

interface DetachedImage {
  /** Содержимое страницы без картинки. */
  content: Uint8Array
  /** Матрица картинки в пространстве PDF. */
  userCtm: Matrix
  /** Имя ресурса XObject, если картинка была вызовом «/Имя Do». */
  name: string | null
}

/**
 * Убирает картинку со страницы. Если это вызов «/Имя Do», убирается ровно он.
 * Иначе картинка вырезается redaction: заодно стираются пиксели других
 * картинок под ней.
 */
function detachImage(ctx: PageContext, item: RawImage): DetachedImage {
  const userCtm = concat(concat(IMAGE_FLIP, item.transform), ctx.toPdf)
  const located = locateImageCall(ctx, userCtm, item)
  if (located) {
    const { call } = located
    return { content: blankRanges(located.content, [call]), userCtm, name: call.name }
  }
  redact(ctx, [item.box], { text: false, image: 'pixels', lineArt: 'none' })
  return { content: readContent(ctx.pageObj), userCtm, name: null }
}

/** Убирает имя из ресурсов страницы, если поток его больше не вызывает. */
function dropUnusedXObject(ctx: PageContext, detached: DetachedImage): void {
  const { name, content } = detached
  if (name !== null && !findXObjectCalls(content).some((call) => call.name === name)) {
    ownSubDictionary(ctx, 'XObject').delete(name)
  }
}

function imageOperators(name: string, ctm: Matrix): string {
  return `q ${ctm.map(pdfNumber).join(' ')} cm /${name} Do Q`
}

function withImage(
  bytes: Uint8Array,
  pageIndex: number,
  image: ImageRef,
  fn: (ctx: PageContext, item: RawImage) => void
): Promise<Uint8Array> {
  return modifyPage(bytes, pageIndex, (ctx) => {
    withExtracted(ctx.page, ({ images }) => {
      fn(ctx, findImage(images, image, ctx.toPdf))
    })
  })
}

/** 10.5 Удаляет картинку со страницы; неиспользуемые данные картинки уходят из файла. */
export async function removeImage(
  bytes: Uint8Array,
  pageIndex: number,
  image: ImageRef
): Promise<Uint8Array> {
  return withImage(bytes, pageIndex, image, (ctx, item) => {
    const detached = detachImage(ctx, item)
    dropUnusedXObject(ctx, detached)
    writeContent(ctx, detached.content, '')
  })
}

/**
 * 10.5 Заменяет картинку новой (PNG или JPEG): новая вписывается в прежнюю
 * рамку с сохранением своих пропорций и рисуется поверх остального содержимого.
 */
export async function replaceImage(
  bytes: Uint8Array,
  pageIndex: number,
  image: ImageRef,
  pngOrJpeg: Uint8Array
): Promise<Uint8Array> {
  return withImage(bytes, pageIndex, image, (ctx, item) => {
    let replacement: Image
    try {
      replacement = new ctx.mupdf.Image(pngOrJpeg)
    } catch (error) {
      throw new PdfContentError(`Не удалось прочитать картинку: ${errorText(error)}`)
    }
    try {
      const detached = detachImage(ctx, item)
      dropUnusedXObject(ctx, detached)
      const name = addResource(ctx, 'XObject', 'PWIm', ctx.doc.addImage(replacement))
      const box = transformBox(detached.userCtm, [0, 0, 1, 1])
      const [x0, y0, x1, y1] = fitContain(box, replacement.getWidth(), replacement.getHeight())
      writeContent(ctx, detached.content, imageOperators(name, [x1 - x0, 0, 0, y1 - y0, x0, y0]))
    } finally {
      replacement.destroy()
    }
  })
}

/**
 * 10.5 Переносит картинку в новую рамку (в пространстве PDF). Поворот и
 * отражение картинки сохраняются, рисуется она поверх остального содержимого.
 */
export async function moveImage(
  bytes: Uint8Array,
  pageIndex: number,
  image: ImageRef,
  rect: PdfSpaceRect
): Promise<Uint8Array> {
  checkRect(rect, 'новая рамка картинки')
  return withImage(bytes, pageIndex, image, (ctx, item) => {
    const detached = detachImage(ctx, item)
    const name = detached.name ?? addResource(ctx, 'XObject', 'PWIm', ctx.doc.addImage(item.image))
    const from = transformBox(detached.userCtm, [0, 0, 1, 1])
    const ctm = concat(detached.userCtm, rectToRectMatrix(from, rectToBox(rect)))
    writeContent(ctx, detached.content, imageOperators(name, ctm))
  })
}
