import type { Font, Image, PDFDocument as MuDocument, PDFObject, PDFPage as MuPage } from 'mupdf'
import { groupBlocks } from './blocks'
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
  IDENTITY,
  transformBox,
  transformPoint,
  transformVector,
  type BoxRect,
  type Matrix
} from './geometry'
import {
  graphicOperators,
  listGraphics,
  pathBounds,
  toPageGraphic,
  type RawGraphic
} from './graphics'
import { loadMupdf, type Mupdf } from './mupdf'
import {
  collectDocumentFonts,
  FontPalette,
  styleHintsFromName,
  wrapText,
  type GlyphSource,
  type StyleHints
} from './text-writer'
import { fontFamily, sameFamily } from './to-unicode'
import {
  PdfContentError,
  type EraseOptions,
  type GraphicRef,
  type ImageRef,
  type InsertTextOptions,
  type PageImage,
  type PageObjects,
  type PageTextLine,
  type PdfSpacePoint,
  type PdfSpaceRect,
  type ReplaceTextOptions,
  type RgbColor,
  type TextBlockRef,
  type TextLineRef,
  type TextStyle,
  type TextStylePatch,
  type WriteTextOptions
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
  /** Семейство шрифта без префикса подмножества. */
  family: string
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

function sameColor(a: RgbColor, b: RgbColor): boolean {
  return a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.01)
}

function quadBox(quad: readonly number[]): BoxRect {
  const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0]
  const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function unionBox(a: BoxRect, b: BoxRect): BoxRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

/** Часть строки: шрифты считаются по буквам, шрифтом части становится преобладающий. */
interface Segment {
  line: RawLine
  fonts: Map<string, { font: Font; count: number }>
  bold: boolean
  italic: boolean
}

function closeSegment(segment: Segment): RawLine {
  let best: { family: string; font: Font; count: number } | null = null
  for (const [family, entry] of segment.fonts) {
    if (!best || entry.count > best.count) best = { family, ...entry }
  }
  for (const entry of segment.fonts.values()) {
    if (entry.font !== best?.font) entry.font.destroy()
  }
  segment.line.font = best?.font ?? null
  segment.line.family = best?.family ?? ''
  return segment.line
}

/**
 * Строки страницы. Строка MuPDF делится на части видимо разного стиля (кегль,
 * цвет, жирность, курсив): «почта — чёрным, пояснение — серым» становятся
 * двумя объектами, и каждый правится своим стилем. Смена шрифта без смены
 * начертания (подмножества одного шрифта, подставленные буквы) строку не делит.
 */
function extract(page: MuPage): Extracted {
  const lines: RawLine[] = []
  const images: RawImage[] = []
  let segments: RawLine[] = []
  let current: Segment | null = null
  let lineBox: BoxRect = [0, 0, 0, 0]
  let lineDir: [number, number] = [1, 0]
  const stext = page.toStructuredText('preserve-images')
  try {
    stext.walk({
      beginLine(bbox, _wmode, dir) {
        segments = []
        current = null
        lineBox = bbox
        lineDir = dir
      },
      onChar(c, origin, font, size, quad, color) {
        const col = rgb(color)
        const family = fontFamily(font.getName())
        const bold = font.isBold()
        const italic = font.isItalic()
        const open: Segment | null = current
        if (
          open !== null &&
          (open.bold !== bold ||
            open.italic !== italic ||
            Math.abs(open.line.size - size) > 0.01 ||
            !sameColor(open.line.color, col))
        ) {
          segments.push(closeSegment(open))
          current = null
        }
        const segment: Segment = current ?? {
          line: {
            text: '',
            box: quadBox(quad),
            origin,
            dir: lineDir,
            font: null,
            family,
            size,
            color: col
          },
          fonts: new Map(),
          bold,
          italic
        }
        current = segment
        segment.line.box = unionBox(segment.line.box, quadBox(quad))
        segment.line.text += c
        const entry = segment.fonts.get(family)
        if (entry) {
          entry.count += 1
          font.destroy()
        } else {
          segment.fonts.set(family, { font, count: 1 })
        }
      },
      endLine() {
        if (current !== null) segments.push(closeSegment(current))
        current = null
        // Строка одного стиля сохраняет рамку строки MuPDF целиком.
        const only = segments.length === 1 ? segments[0] : undefined
        if (only) only.box = lineBox
        lines.push(...segments)
        segments = []
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

/** Фон во всю страницу не выбирается: щелчок по пустому месту не должен его хватать. */
function isBackground(rect: PdfSpaceRect, page: PdfSpaceRect): boolean {
  return rect.width * rect.height >= 0.9 * page.width * page.height
}

/** Строки, абзацы, картинки и векторные контуры страницы в пространстве PDF. */
export async function listPageObjects(bytes: Uint8Array, pageIndex: number): Promise<PageObjects> {
  return withPage(bytes, pageIndex, ({ mupdf, doc, page, toPdf }) =>
    withExtracted(page, ({ lines, images }) => {
      const pageBox = boxToRect(transformBox(toPdf, page.getBounds()))
      const textLines = lines.filter(hasText).map((line, i) => toTextLine(line, i, toPdf))
      const graphics = listGraphics(mupdf, page, toPdf)
        .map((raw, i) => toPageGraphic(raw, i, toPdf))
        .filter((g) => !isBackground(g.rect, pageBox))
      const fonts = [...new Set(collectDocumentFonts(doc).map((font) => font.family))].sort()
      return {
        pageIndex,
        pageBox,
        lines: textLines,
        blocks: groupBlocks(textLines),
        images: images.map((item, i) => toPageImage(item, i, toPdf)),
        graphics,
        fonts
      }
    })
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

type ResourceKind = 'Font' | 'XObject' | 'ExtGState'

function ownSubDictionary(ctx: PageContext, key: ResourceKind): PDFObject {
  const resources = ownResources(ctx)
  const sub = resources.get(key)
  if (sub.isDictionary() && !sub.isIndirect()) return sub
  return resources.put(key, copyDictionary(ctx.doc, sub)) as PDFObject
}

function addResource(ctx: PageContext, key: ResourceKind, prefix: string, ref: PDFObject): string {
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

function lineTexts(lines: readonly RawLine[], skip: ReadonlySet<number> = new Set()): string[] {
  return lines
    .filter((line, i) => !skip.has(i) && hasText(line))
    .map((line) => line.text.trim())
    .sort()
}

function sameTexts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((text, i) => text === b[i])
}

/** Вырезает строки и проверяет, что весь остальной текст страницы на месте. */
function cutLines(ctx: PageContext, lines: readonly RawLine[], targets: readonly number[]): void {
  const before = lineTexts(lines, new Set(targets))
  redact(
    ctx,
    targets.map((target) => lineRedactionBox(lines, target)),
    { text: true, image: 'none', lineArt: 'none' }
  )
  const after = withExtracted(ctx.page, (data) => lineTexts(data.lines))
  if (!sameTexts(before, after)) {
    throw new PdfContentError('Текст нельзя вырезать, не задев соседний.')
  }
}

function hintsOf(name: string, font: Font | null, patch: TextStylePatch | undefined): StyleHints {
  return styleHintsFromName(
    name,
    patch?.bold ?? font?.isBold() ?? false,
    patch?.italic ?? font?.isItalic() ?? false
  )
}

interface Styled {
  palette: FontPalette
  size: number
  color: RgbColor
}

/** Шрифты для текста в стиле строки raw с изменениями patch. */
function styledFrom(
  ctx: PageContext,
  raw: RawLine,
  patch: TextStylePatch | undefined,
  options: ReplaceTextOptions
): Styled {
  const original = raw.font?.getName() ?? raw.family
  const family = patch?.fontName ?? original
  const keepsFamily = sameFamily(family, original)
  return {
    palette: new FontPalette(
      ctx.mupdf,
      collectDocumentFonts(ctx.doc),
      family,
      hintsOf(family, keepsFamily ? raw.font : null, patch),
      keepsFamily ? raw.font : null,
      options.fallbackFont
    ),
    size: patch?.fontSize ?? raw.size,
    color: patch?.color ?? raw.color
  }
}

interface TextPlacement {
  rows: readonly string[]
  /** Начало базовой линии первой строки в пространстве PDF. */
  origin: PdfSpacePoint
  direction: PdfSpacePoint
  lineHeight: number
  size: number
  color: RgbColor
}

/**
 * Дописывает текст на страницу. Каждый отрезок одного шрифта ставится своей
 * матрицей Tm по нашим же ширинам глифов, поэтому подстановка другого шрифта
 * для пары букв и отсутствующий в шрифте пробел не сбивают строку.
 */
function writeText(ctx: PageContext, palette: FontPalette, placement: TextPlacement): void {
  const { origin, direction: d, lineHeight, size, color } = placement
  const normal = { x: -d.y, y: d.x }
  const names = new Map<object, string>()
  const nameOf = (source: GlyphSource): string => {
    let name = names.get(source.font)
    if (name === undefined) {
      const ref = source.kind === 'doc' ? source.font.ref : ctx.doc.addFont(source.font)
      name = addResource(ctx, 'Font', 'PWF', ref)
      names.set(source.font, name)
    }
    return name
  }
  const ops: string[] = ['q BT', `${color.map(pdfNumber).join(' ')} rg`]
  const state: { font: string; run: { name: string; hex: string; at: number } | null } = {
    font: '',
    run: null
  }
  placement.rows.forEach((row, index) => {
    const base = {
      x: origin.x - normal.x * lineHeight * index,
      y: origin.y - normal.y * lineHeight * index
    }
    const flush = (): void => {
      const run = state.run
      if (!run) return
      if (run.name !== state.font) {
        ops.push(`/${run.name} ${pdfNumber(size)} Tf`)
        state.font = run.name
      }
      const tm: Matrix = [d.x, d.y, -d.y, d.x, base.x + d.x * run.at, base.y + d.y * run.at]
      ops.push(`${tm.map(pdfNumber).join(' ')} Tm`, `<${run.hex}> Tj`)
      state.run = null
    }
    let advance = 0
    for (const glyph of palette.glyphs(row)) {
      if (glyph.source === null) {
        flush()
      } else {
        const name = nameOf(glyph.source)
        if (state.run && state.run.name !== name) flush()
        state.run ??= { name, hex: '', at: advance }
        state.run.hex += glyph.code
      }
      advance += (glyph.width * size) / 1000
    }
    flush()
  })
  ops.push('ET Q')
  writeContent(ctx, readContent(ctx.pageObj), ops.join('\n'))
}

function lineOrigin(ctx: PageContext, raw: RawLine): { origin: PdfSpacePoint; dir: PdfSpacePoint } {
  const [ox, oy] = transformPoint(ctx.toPdf, raw.origin[0], raw.origin[1])
  const [dx, dy] = transformVector(ctx.toPdf, raw.dir[0], raw.dir[1])
  return { origin: { x: ox, y: oy }, dir: normalizeVector(dx, dy) }
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
 * линии тем же шрифтом документа (буквы берутся из всех подмножеств этого
 * шрифта в файле), кеглем и цветом; недостающие буквы — встроенным шрифтом
 * того же начертания. Переноса нет. Пустой текст удаляет строку.
 */
export async function replaceText(
  bytes: Uint8Array,
  pageIndex: number,
  line: TextLineRef,
  newText: string,
  options: ReplaceTextOptions & { readonly style?: TextStylePatch } = {}
): Promise<Uint8Array> {
  const text = newText.replace(/[\r\n\t]+/g, ' ')
  return modifyPage(bytes, pageIndex, (ctx) => {
    withExtracted(ctx.page, ({ lines }) => {
      const target = findLine(lines, line, ctx.toPdf)
      const raw = lines[target]
      if (!raw) return
      cutLines(ctx, lines, [target])
      if (text.trim() === '') return
      const styled = styledFrom(ctx, raw, options.style, options)
      try {
        const { origin, dir } = lineOrigin(ctx, raw)
        writeText(ctx, styled.palette, {
          rows: [text],
          origin,
          direction: dir,
          lineHeight: 0,
          size: styled.size,
          color: styled.color
        })
      } finally {
        styled.palette.dispose()
      }
    })
  })
}

/**
 * Переписывает абзац: вырезает все его строки и раскладывает новый текст по
 * словам в ширину колонки (по умолчанию прежнюю) с прежним интерлиньяжем,
 * тем же шрифтом, кеглем и цветом (или изменёнными в options.style).
 * Переводы строки в тексте — явные разрывы. Пустой текст удаляет абзац.
 */
export async function replaceBlock(
  bytes: Uint8Array,
  pageIndex: number,
  block: TextBlockRef,
  newText: string,
  options: WriteTextOptions = {}
): Promise<Uint8Array> {
  if (options.width !== undefined && !(options.width > 0)) {
    throw new PdfContentError('Некорректная ширина абзаца.')
  }
  return modifyPage(bytes, pageIndex, (ctx) => {
    withExtracted(ctx.page, ({ lines }) => {
      const targets = block.lines.map((ref) => findLine(lines, ref, ctx.toPdf))
      const first = targets[0] === undefined ? undefined : lines[targets[0]]
      if (!first) throw new PdfContentError('Абзац не найден на странице: документ изменился.')
      const members = targets.flatMap((t) => {
        const raw = lines[t]
        return raw ? [toTextLine(raw, t, ctx.toPdf)] : []
      })
      const geometry = groupBlocks(members)
      const head = geometry[0]
      if (!head) throw new PdfContentError('Абзац не найден на странице.')
      // У абзаца из одной строки колонки нет: удлинённый текст продолжается в строку,
      // пока ширину не задали ручкой. Многострочный переносится по прежней ширине.
      const width =
        options.width ??
        (targets.length === 1 ? Infinity : Math.max(...geometry.map((b) => b.width)))
      cutLines(ctx, lines, targets)
      if (newText.trim() === '') return
      const styled = styledFrom(ctx, first, options.style, options)
      try {
        const rows = wrapText(newText.replace(/\t/g, ' '), width + 0.5, (t) =>
          styled.palette.measure(t, styled.size)
        )
        writeText(ctx, styled.palette, {
          rows,
          origin: options.origin ?? head.origin,
          direction: head.direction,
          lineHeight: head.lineHeight * (styled.size / first.size),
          size: styled.size,
          color: styled.color
        })
      } finally {
        styled.palette.dispose()
      }
    })
  })
}

/**
 * Новый текст на странице шрифтом документа: style.fontName — семейство из
 * PageObjects.fonts (или имя шрифта строки, на которую равняемся). Перевод
 * строки — новая строка, с options.width — перенос по словам.
 */
export async function insertText(
  bytes: Uint8Array,
  pageIndex: number,
  origin: PdfSpacePoint,
  text: string,
  style: TextStyle,
  options: InsertTextOptions = {}
): Promise<Uint8Array> {
  if (text.trim() === '') return bytes.slice()
  if (!(style.fontSize > 0)) throw new PdfContentError('Некорректный кегль.')
  return modifyPage(bytes, pageIndex, (ctx) => {
    const palette = new FontPalette(
      ctx.mupdf,
      collectDocumentFonts(ctx.doc),
      style.fontName,
      styleHintsFromName(style.fontName, style.bold, style.italic),
      null,
      options.fallbackFont
    )
    try {
      const rows = wrapText(text.replace(/\t/g, ' '), options.width ?? Infinity, (t) =>
        palette.measure(t, style.fontSize)
      )
      writeText(ctx, palette, {
        rows,
        origin,
        direction: normalizeVector(options.direction?.x ?? 1, options.direction?.y ?? 0),
        lineHeight: options.lineHeight ?? style.fontSize * 1.4,
        size: style.fontSize,
        color: style.color
      })
    } finally {
      palette.dispose()
    }
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

// ---------------------------------------------------------------------------
// Векторные контуры

function sameKind(
  a: { fill: unknown; stroke: unknown },
  b: { fill: unknown; stroke: unknown }
): boolean {
  return (a.fill === null) === (b.fill === null) && (a.stroke === null) === (b.stroke === null)
}

function findGraphic(graphics: readonly RawGraphic[], ref: GraphicRef, toPdf: Matrix): number {
  let best = -1
  let bestDistance = Infinity
  graphics.forEach((raw, i) => {
    if (!sameKind(raw, ref)) return
    const distance = rectDistance(boxToRect(transformBox(toPdf, raw.box)), ref.rect)
    // При равенстве берётся более поздний, то есть верхний контур.
    if (distance <= bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  if (best < 0 || bestDistance > MATCH_TOLERANCE) {
    throw new PdfContentError('Контур не найден на странице: документ изменился.')
  }
  return best
}

function sameGraphic(a: RawGraphic, b: RawGraphic): boolean {
  return sameKind(a, b) && a.box.every((v, i) => Math.abs(v - (b.box[i] ?? 0)) < 0.5)
}

/** Ресурс ExtGState с прозрачностью или null для непрозрачного контура. */
function alphaState(ctx: PageContext, alpha: number): string | null {
  if (alpha >= 0.999) return null
  const dict = ctx.doc.newDictionary()
  dict.put('Type', ctx.doc.newName('ExtGState'))
  dict.put('ca', ctx.doc.newReal(alpha))
  dict.put('CA', ctx.doc.newReal(alpha))
  return addResource(ctx, 'ExtGState', 'PWGs', ctx.doc.addObject(dict))
}

/**
 * Вырезает контур. Redaction удаляет все контуры, целиком лежащие в рамке,
 * поэтому соседи, попавшие внутрь неё, рисуются заново (операторы возвращаются).
 */
function cutGraphic(ctx: PageContext, graphics: readonly RawGraphic[], target: number): string[] {
  const raw = graphics[target]
  if (!raw) throw new PdfContentError('Контур не найден на странице.')
  const [x0, y0, x1, y1] = raw.box
  redact(ctx, [[x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5]], {
    text: false,
    image: 'none',
    lineArt: 'covered'
  })
  const after = listGraphics(ctx.mupdf, ctx.page, ctx.toPdf)
  return graphics
    .filter((g, i) => i !== target && !after.some((a) => sameGraphic(a, g)))
    .map((g) => graphicOperators(g, IDENTITY, alphaState(ctx, g.alpha)))
}

/** Удаляет векторный контур (плашку, фон шапки, линейку) со страницы. */
export async function removeGraphic(
  bytes: Uint8Array,
  pageIndex: number,
  graphic: GraphicRef
): Promise<Uint8Array> {
  return modifyPage(bytes, pageIndex, (ctx) => {
    const graphics = listGraphics(ctx.mupdf, ctx.page, ctx.toPdf)
    const restore = cutGraphic(ctx, graphics, findGraphic(graphics, graphic, ctx.toPdf))
    writeContent(ctx, readContent(ctx.pageObj), restore.join('\n'))
  })
}

/**
 * Переносит и растягивает контур в новую рамку (пространство PDF). Толщина
 * линии не меняется; контур рисуется поверх остального содержимого.
 */
export async function moveGraphic(
  bytes: Uint8Array,
  pageIndex: number,
  graphic: GraphicRef,
  rect: PdfSpaceRect
): Promise<Uint8Array> {
  if (!(rect.width >= 0 && rect.height >= 0) || !Number.isFinite(rect.x + rect.y)) {
    throw new PdfContentError('Некорректная область: новая рамка контура.')
  }
  return modifyPage(bytes, pageIndex, (ctx) => {
    const graphics = listGraphics(ctx.mupdf, ctx.page, ctx.toPdf)
    const target = findGraphic(graphics, graphic, ctx.toPdf)
    const raw = graphics[target]
    if (!raw) throw new PdfContentError('Контур не найден на странице.')
    const restore = cutGraphic(ctx, graphics, target)
    // Рамка с толщиной линии переводится в рамку самого пути: толщина не масштабируется.
    const visual = boxToRect(transformBox(ctx.toPdf, raw.box))
    const path = pathBounds(raw)
    const left = path.x - visual.x
    const bottom = path.y - visual.y
    const right = visual.x + visual.width - (path.x + path.width)
    const top = visual.y + visual.height - (path.y + path.height)
    const sx = path.width > 1e-3 ? Math.max(rect.width - left - right, 0) / path.width : 1
    const sy = path.height > 1e-3 ? Math.max(rect.height - bottom - top, 0) / path.height : 1
    const m: Matrix = [sx, 0, 0, sy, rect.x + left - path.x * sx, rect.y + bottom - path.y * sy]
    const ops = graphicOperators(raw, m, alphaState(ctx, raw.alpha))
    writeContent(ctx, readContent(ctx.pageObj), [...restore, ops].join('\n'))
  })
}
