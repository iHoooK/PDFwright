import { m } from '../messages'
import type {
  Font,
  PDFAnnotation,
  PDFDocument as MuDocument,
  PDFObject,
  PDFPage as MuPage
} from 'mupdf'
import { layoutText, type MeasureText } from '../markup/text-layout'
import {
  boxToRect,
  invert,
  pdfNumber,
  rectToBox,
  rectToRectMatrix,
  transformBox,
  transformPoint,
  type BoxRect,
  type Matrix
} from './geometry'
import { loadMupdf, type Mupdf } from './mupdf'
import { openPdf } from './open'
import { PdfContentError, type PdfSpacePoint, type PdfSpaceRect, type RgbColor } from './types'

/**
 * Аннотации, которые уже есть в документе (пометки других программ и
 * сохранённая разметка PDFwright): чтение, перенос и изменение размера, цвет,
 * непрозрачность, текст FreeText и заметок, удаление — на MuPDF.js.
 *
 * Перенос и размер меняют /Rect и геометрию (QuadPoints, InkList, L,
 * Vertices, CL) одним аффинным отображением прежней рамки в новую, а внешний
 * вид (/AP) остаётся прежним: просмотрщики вписывают его в /Rect, поэтому
 * картинки штампов и шрифты чужих пометок не теряются. Цвет и непрозрачность
 * перерисовывает MuPDF (update) — у тех типов, которые он рисует сам. Вид
 * FreeText строится здесь же шрифтом с кириллицей (PT Sans): MuPDF рисует его
 * фоном цвета /C и без кириллицы. Координаты — пространство PDF (см. types.ts).
 */

/** Аннотация страницы. index — место в списке аннотаций страницы MuPDF (без полей форм). */
export interface PageAnnotation {
  readonly index: number
  /** /Subtype: Highlight, Ink, Square, FreeText, Text, Stamp… */
  readonly subtype: string
  /** /Rect в пространстве PDF. */
  readonly rect: PdfSpaceRect
  /** /C (у FreeText — цвет текста из /DA); null — без цвета. */
  readonly color: RgbColor | null
  readonly opacity: number
  readonly contents: string
  /** Кегль текста FreeText из /DA. */
  readonly fontSize: number | null
  readonly borderWidth: number
  /** Рамки строк пометок текста (QuadPoints). */
  readonly quads: readonly PdfSpaceRect[]
  readonly ink: readonly (readonly PdfSpacePoint[])[]
  readonly line: readonly [PdfSpacePoint, PdfSpacePoint] | null
  readonly vertices: readonly PdfSpacePoint[]
  readonly can: AnnotationCapabilities
}

export interface AnnotationCapabilities {
  readonly move: boolean
  readonly resize: boolean
  readonly color: boolean
  readonly opacity: boolean
  readonly text: boolean
}

/** Чем аннотацию находят повторно: место в списке, тип и рамка (из listAnnotations). */
export interface AnnotationRef {
  readonly index: number
  readonly subtype: string
  readonly rect: PdfSpaceRect
}

export interface AnnotationPatch {
  /** Новая рамка: перенос или изменение размера, геометрия пересчитывается. */
  readonly rect?: PdfSpaceRect
  readonly color?: RgbColor
  readonly opacity?: number
  /** Текст FreeText или заметки. */
  readonly contents?: string
}

export interface AnnotationTarget {
  /** Номер страницы с 0. */
  readonly pageIndex: number
  readonly annotation: AnnotationRef
}

export interface AnnotationEdit extends AnnotationTarget {
  readonly patch: AnnotationPatch
}

export interface EditAnnotationsOptions {
  /** TTF с кириллицей (PT Sans) для вида FreeText; нужен, если меняется FreeText. */
  readonly font?: Uint8Array | null
}

const PRODUCER = 'PDFwright'
/** Флаги /F: Hidden, NoView — не видны; Locked — не двигать. */
const FLAG_HIDDEN = 2
const FLAG_NO_VIEW = 32
const FLAG_LOCKED = 128
/** Не аннотации разметки: ссылки и окна заметок выбирать нечего. */
const SKIPPED = new Set(['Link', 'Popup', 'Widget'])
/** Пометки текста привязаны к строкам: их не двигают и не растягивают (как разметку). */
const TEXT_MARKS = new Set(['Highlight', 'Underline', 'StrikeOut', 'Squiggly'])
/** Эти типы MuPDF рисует сам: после смены цвета и непрозрачности вид строится заново. */
const REDRAWN = new Set([
  'Text',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Ink',
  'Square',
  'Circle',
  'Line',
  'Polygon',
  'PolyLine'
])
/** Допуск совпадения рамки при повторном поиске, пт. */
const RECT_TOLERANCE = 0.5
const ASCII_HEX = '0123456789abcdef'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pdfDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function openDocument(mupdf: Mupdf, bytes: Uint8Array): MuDocument {
  return openPdf(
    mupdf,
    bytes,
    m({
      ru: 'Документ зашифрован: аннотации защищённых паролем файлов пока не правятся.',
      en: 'The document is encrypted: annotations in password-protected files cannot be edited yet.'
    })
  )
}

function checkPageIndex(doc: MuDocument, pageIndex: number): void {
  const total = doc.countPages()
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= total) {
    throw new PdfContentError(
      m({
        ru: `Страницы ${pageIndex + 1} нет в документе (всего ${total}).`,
        en: `Page ${pageIndex + 1} is not in the document (${total} in total).`
      })
    )
  }
}

function saveDocument(doc: MuDocument): Uint8Array {
  doc.setMetaData('info:Producer', PRODUCER)
  doc.setMetaData('info:ModDate', pdfDate(new Date()))
  // garbage выбрасывает объекты без ссылок: удалённая аннотация уходит из файла.
  const buffer = doc.saveToBuffer('garbage,compress')
  try {
    return buffer.asUint8Array().slice()
  } finally {
    buffer.destroy()
  }
}

async function withDocument<T>(bytes: Uint8Array, fn: (doc: MuDocument, mupdf: Mupdf) => T) {
  const mupdf = await loadMupdf()
  const doc = openDocument(mupdf, bytes)
  try {
    return fn(doc, mupdf)
  } catch (error) {
    if (error instanceof PdfContentError) throw error
    throw new PdfContentError(
      m({
        ru: `Не удалось изменить аннотацию: ${errorText(error)}`,
        en: `Could not change the annotation: ${errorText(error)}`
      })
    )
  } finally {
    doc.destroy()
  }
}

function withPage<T>(doc: MuDocument, pageIndex: number, fn: (page: MuPage) => T): T {
  checkPageIndex(doc, pageIndex)
  const page = doc.loadPage(pageIndex)
  try {
    return fn(page)
  } finally {
    page.destroy()
  }
}

// Чтение словаря аннотации

/** Значение по цепочке ключей словарей или null: у null-объекта MuPDF нельзя спрашивать ключи. */
function lookup(obj: PDFObject | null, ...keys: string[]): PDFObject | null {
  let current = obj
  for (const key of keys) {
    if (!current?.isDictionary()) return null
    current = current.get(key)
  }
  return current && !current.isNull() ? current : null
}

function numbers(obj: PDFObject | null): number[] {
  if (!obj?.isArray()) return []
  const out: number[] = []
  for (let i = 0; i < obj.length; i += 1) {
    const item = obj.get(i)
    if (item.isNumber()) out.push(item.asNumber())
  }
  return out
}

function pairs(values: readonly number[]): PdfSpacePoint[] {
  const out: PdfSpacePoint[] = []
  for (let i = 0; i + 1 < values.length; i += 2) {
    out.push({ x: values[i] ?? 0, y: values[i + 1] ?? 0 })
  }
  return out
}

function normalizedBox(values: readonly number[]): BoxRect | null {
  if (values.length !== 4 || !values.every(Number.isFinite)) return null
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = values
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]
}

function bounds(points: readonly PdfSpacePoint[]): PdfSpaceRect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function toRgb(color: readonly number[]): RgbColor | null {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  if (color.length === 1) {
    const g = clamp(color[0] ?? 0)
    return [g, g, g]
  }
  if (color.length === 3) return [clamp(color[0] ?? 0), clamp(color[1] ?? 0), clamp(color[2] ?? 0)]
  if (color.length === 4) {
    const [c = 0, mm = 0, y = 0, k = 0] = color
    return [clamp((1 - c) * (1 - k)), clamp((1 - mm) * (1 - k)), clamp((1 - y) * (1 - k))]
  }
  return null
}

/** Непрозрачность: /CA словаря или, если её нет, /CA из ExtGState внешнего вида. */
function opacityOf(annot: PDFAnnotation): number {
  const dict = annot.getObject()
  const ca = lookup(dict, 'CA')
  if (ca?.isNumber()) return ca.asNumber()
  const states = lookup(dict, 'AP', 'N', 'Resources', 'ExtGState')
  const found: number[] = []
  if (states?.isDictionary()) {
    states.forEach((state) => {
      const value = lookup(state, 'CA')
      if (value?.isNumber()) found.push(value.asNumber())
    })
  }
  return found[0] ?? 1
}

function defaultAppearance(annot: PDFAnnotation): { size: number; color: RgbColor } | null {
  try {
    const da = annot.getDefaultAppearance()
    return { size: da.size, color: toRgb(da.color) ?? [0, 0, 0] }
  } catch {
    return null
  }
}

function capabilities(subtype: string, flags: number): AnnotationCapabilities {
  const locked = (flags & FLAG_LOCKED) !== 0
  const mark = TEXT_MARKS.has(subtype)
  const styled = REDRAWN.has(subtype) || subtype === 'FreeText'
  return {
    move: !locked && !mark,
    resize: !locked && !mark && subtype !== 'Text',
    color: styled,
    opacity: styled,
    text: subtype === 'FreeText' || subtype === 'Text'
  }
}

function readAnnotation(annot: PDFAnnotation, index: number, toPdf: Matrix): PageAnnotation | null {
  const dict = annot.getObject()
  const name = lookup(dict, 'Subtype')
  const subtype = name?.isName() ? name.asName() : annot.getType()
  const flags = annot.getFlags()
  if (SKIPPED.has(subtype) || (flags & (FLAG_HIDDEN | FLAG_NO_VIEW)) !== 0) return null
  const box = normalizedBox(numbers(dict.get('Rect'))) ?? transformBox(toPdf, annot.getBounds())
  const rect = boxToRect(box)
  if (!(rect.width >= 0 && rect.height >= 0)) return null
  const quads: PdfSpaceRect[] = []
  const quadValues = numbers(dict.get('QuadPoints'))
  for (let i = 0; i + 7 < quadValues.length; i += 8) {
    quads.push(bounds(pairs(quadValues.slice(i, i + 8))))
  }
  const inkList = lookup(dict, 'InkList')
  const ink: PdfSpacePoint[][] = []
  if (inkList?.isArray()) {
    for (let i = 0; i < inkList.length; i += 1) ink.push(pairs(numbers(inkList.get(i))))
  }
  const lineValues = pairs(numbers(dict.get('L')))
  const [from, to] = lineValues
  const da = subtype === 'FreeText' ? defaultAppearance(annot) : null
  const border = lookup(dict, 'BS', 'W')
  return {
    index,
    subtype,
    rect,
    color: da ? da.color : toRgb(annot.getColor()),
    opacity: opacityOf(annot),
    contents: annot.getContents(),
    fontSize: da?.size ?? null,
    borderWidth: border?.isNumber() ? border.asNumber() : 1,
    quads,
    ink,
    line: from && to ? [from, to] : null,
    vertices: pairs(numbers(dict.get('Vertices'))),
    can: capabilities(subtype, flags)
  }
}

function readPage(page: MuPage): PageAnnotation[] {
  const toPdf = invert(page.getTransform())
  const out: PageAnnotation[] = []
  page.getAnnotations().forEach((annot, index) => {
    const item = readAnnotation(annot, index, toPdf)
    if (item) out.push(item)
  })
  return out
}

/** Аннотации страницы (номер с 0), которые можно выбрать: без ссылок, окон заметок и скрытых. */
export async function listAnnotations(
  bytes: Uint8Array,
  pageIndex: number
): Promise<PageAnnotation[]> {
  return withDocument(bytes, (doc) => withPage(doc, pageIndex, readPage))
}

function sameRect(a: PdfSpaceRect, b: PdfSpaceRect): boolean {
  return (
    Math.abs(a.x - b.x) <= RECT_TOLERANCE &&
    Math.abs(a.y - b.y) <= RECT_TOLERANCE &&
    Math.abs(a.width - b.width) <= RECT_TOLERANCE &&
    Math.abs(a.height - b.height) <= RECT_TOLERANCE
  )
}

/** Находит аннотацию заново: на том же месте списка тот же тип и та же рамка. */
function findAnnotation(page: MuPage, ref: AnnotationRef): PDFAnnotation {
  const annot = page.getAnnotations()[ref.index]
  const current = annot ? readPage(page).find((a) => a.index === ref.index) : undefined
  if (!annot || current?.subtype !== ref.subtype || !sameRect(current.rect, ref.rect)) {
    throw new PdfContentError(
      m({
        ru: 'Аннотация изменилась или удалена. Выберите её заново.',
        en: 'The annotation has changed or was removed. Select it again.'
      })
    )
  }
  return annot
}

// Правка

function mapNumbers(values: readonly number[], matrix: Matrix): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < values.length; i += 2) {
    const [x, y] = transformPoint(matrix, values[i] ?? 0, values[i + 1] ?? 0)
    out.push(x, y)
  }
  return out
}

/** Пересчитывает геометрию словаря: /Rect — в новую рамку, точки — тем же отображением. */
function moveGeometry(dict: PDFObject, from: BoxRect, to: BoxRect): void {
  const matrix = rectToRectMatrix(from, to)
  dict.put('Rect', [...to])
  for (const key of ['QuadPoints', 'L', 'Vertices', 'CL']) {
    const values = numbers(dict.get(key))
    if (values.length > 0) dict.put(key, mapNumbers(values, matrix))
  }
  const inkList = lookup(dict, 'InkList')
  if (inkList?.isArray()) {
    const strokes: number[][] = []
    for (let i = 0; i < inkList.length; i += 1) {
      strokes.push(mapNumbers(numbers(inkList.get(i)), matrix))
    }
    dict.put('InkList', strokes)
  }
  // Окно заметки едет вместе с её левым верхним углом, размер окна прежний.
  const popup = lookup(dict, 'Popup')
  const popupBox = normalizedBox(numbers(lookup(popup, 'Rect')))
  if (popup && popupBox) {
    const dx = to[0] - from[0]
    const dy = to[3] - from[3]
    popup.put('Rect', [popupBox[0] + dx, popupBox[1] + dy, popupBox[2] + dx, popupBox[3] + dy])
  }
}

function hex4(code: number): string {
  let out = ''
  for (let shift = 12; shift >= 0; shift -= 4) out += ASCII_HEX[(code >> shift) & 15] ?? '0'
  return out
}

interface FreeTextStyle {
  readonly size: number
  readonly color: RgbColor
  readonly opacity: number
}

/**
 * Вид FreeText: текст шрифтом с кириллицей, перенос по ширине рамки, рамка
 * растёт вниз под текст. Шрифт встраивается целиком (CID, Identity-H) —
 * так же, как пишет новый текст движок правки содержимого.
 */
function writeFreeText(
  mupdf: Mupdf,
  doc: MuDocument,
  annot: PDFAnnotation,
  fontBytes: Uint8Array,
  text: string,
  style: FreeTextStyle
): void {
  const dict = annot.getObject()
  const box = normalizedBox(numbers(dict.get('Rect')))
  if (!box) return
  const font: Font = new mupdf.Font('PTSans', fontBytes)
  const glyphs = (line: string): number[] => {
    const out: number[] = []
    for (const ch of line) out.push(font.encodeCharacter(ch.codePointAt(0) ?? 32))
    return out
  }
  const measure: MeasureText = (line, size) =>
    glyphs(line).reduce((sum, gid) => sum + font.advanceGlyph(gid) * size, 0)
  const width = box[2] - box[0]
  const layout = layoutText(text, style.size, measure, width)
  const height = Math.max(box[3] - box[1], layout.height)
  const rect: BoxRect = [box[0], box[3] - height, box[2], box[3]]
  const fontRef = doc.addFont(font)
  const [r, g, b] = style.color.map(pdfNumber)
  const ops = [`q /GS0 gs ${r} ${g} ${b} rg BT /F1 ${pdfNumber(style.size)} Tf`]
  for (const line of layout.lines) {
    if (line.text.length === 0) continue
    const codes = glyphs(line.text).map(hex4).join('')
    ops.push(`1 0 0 1 ${pdfNumber(line.x)} ${pdfNumber(height - line.baseline)} Tm <${codes}> Tj`)
  }
  ops.push('ET Q')
  const form = doc.addStream(ops.join('\n'), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, width, height],
    Resources: {
      Font: { F1: fontRef },
      ExtGState: { GS0: { Type: 'ExtGState', CA: style.opacity, ca: style.opacity } }
    }
  })
  dict.put('Rect', [...rect])
  dict.put('AP', { N: form })
  dict.put('Contents', doc.newString(text))
  dict.put('DA', `(/Helv ${pdfNumber(style.size)} Tf ${r} ${g} ${b} rg)`)
  // Непрозрачность уже во внешнем виде; /CA поверх неё затемнила бы текст дважды.
  dict.delete('CA')
  dict.delete('RC')
}

function patchAnnotation(
  mupdf: Mupdf,
  doc: MuDocument,
  annot: PDFAnnotation,
  current: PageAnnotation,
  patch: AnnotationPatch,
  font: Uint8Array | null
): void {
  const dict = annot.getObject()
  const { can } = current
  if (patch.rect && (can.move || can.resize)) {
    const from = rectToBox(current.rect)
    const target = rectToBox(patch.rect)
    // Без права менять размер рамка только сдвигается.
    const to: BoxRect = can.resize
      ? target
      : [target[0], target[1], target[0] + (from[2] - from[0]), target[1] + (from[3] - from[1])]
    moveGeometry(dict, from, to)
  }
  const restyle = patch.color !== undefined || patch.opacity !== undefined
  if (current.subtype === 'FreeText' && (restyle || patch.contents !== undefined)) {
    if (!font) {
      throw new PdfContentError(
        m({ ru: 'Нет шрифта для текста аннотации.', en: 'No font for the annotation text.' })
      )
    }
    writeFreeText(mupdf, doc, annot, font, patch.contents ?? current.contents, {
      size: current.fontSize ?? 12,
      color: patch.color ?? current.color ?? [0, 0, 0],
      opacity: patch.opacity ?? current.opacity
    })
  } else {
    if (patch.contents !== undefined && can.text) annot.setContents(patch.contents)
    if (restyle && can.color) {
      annot.setColor([...(patch.color ?? current.color ?? [0, 0, 0])])
      annot.setOpacity(patch.opacity ?? current.opacity)
      annot.update()
    }
  }
  dict.put('M', doc.newString(pdfDate(new Date())))
}

function byPage<T extends AnnotationTarget>(items: readonly T[]): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const list = map.get(item.pageIndex) ?? []
    list.push(item)
    map.set(item.pageIndex, list)
  }
  return map
}

/**
 * Правка аннотаций (перенос, размер, цвет, непрозрачность, текст) одним
 * сохранением: так перенос группы — один шаг отмены. Остальные аннотации
 * страницы не меняются.
 */
export async function editAnnotations(
  bytes: Uint8Array,
  edits: readonly AnnotationEdit[],
  options: EditAnnotationsOptions = {}
): Promise<Uint8Array> {
  if (edits.length === 0) return bytes
  return withDocument(bytes, (doc, mupdf) => {
    for (const [pageIndex, list] of byPage(edits)) {
      withPage(doc, pageIndex, (page) => {
        // Сначала находим все: правка одной не должна сбить поиск следующей.
        const found = list.map((edit) => ({ edit, annot: findAnnotation(page, edit.annotation) }))
        const current = readPage(page)
        for (const { edit, annot } of found) {
          const read = current.find((a) => a.index === edit.annotation.index)
          if (read) patchAnnotation(mupdf, doc, annot, read, edit.patch, options.font ?? null)
        }
      })
    }
    return saveDocument(doc)
  })
}

/** Удаляет аннотации вместе с их окнами /Popup; после сохранения их нет и в файле. */
export async function removeAnnotations(
  bytes: Uint8Array,
  targets: readonly AnnotationTarget[]
): Promise<Uint8Array> {
  if (targets.length === 0) return bytes
  return withDocument(bytes, (doc) => {
    for (const [pageIndex, list] of byPage(targets)) {
      withPage(doc, pageIndex, (page) => {
        const found = list.map((target) => findAnnotation(page, target.annotation))
        for (const annot of found) {
          const popup = lookup(annot.getObject(), 'Popup')
          page.deleteAnnotation(annot)
          if (popup?.isIndirect()) removeFromAnnots(doc, page, popup.asIndirect())
        }
      })
    }
    return saveDocument(doc)
  })
}

/** Убирает объект из /Annots страницы, если MuPDF оставил его там (окно заметки). */
function removeFromAnnots(doc: MuDocument, page: MuPage, target: number): void {
  const pageObj = page.getObject()
  const annots = lookup(pageObj, 'Annots')
  if (!annots?.isArray()) return
  const keep = doc.newArray()
  const before = annots.length
  annots.forEach((item) => {
    if (!item.isIndirect() || item.asIndirect() !== target) keep.push(item)
  })
  if (keep.length !== before) pageObj.put('Annots', keep)
}
