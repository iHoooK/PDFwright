import { m } from '../messages'
import fontkit from '@pdf-lib/fontkit'
import {
  appendBezierCurve,
  beginText,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endText,
  fill,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFHexString,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type PDFRef
} from 'pdf-lib'
import {
  arrowHead,
  boxContentMatrix,
  boxContentSize,
  inflate,
  multiply,
  parseHexColor,
  textLineStroke,
  type Matrix,
  type Point,
  type Rect
} from '../markup/geometry'
import {
  decodeImageDataUrl,
  visualBounds,
  type ImageObject,
  type MarkupObject,
  type TextObject
} from '../markup/model'
import { fontMeasure, layoutTextObject, type MeasureText } from '../markup/text-layout'
import type { MarkupSaveMode } from '../settings-schema'
import { load, PdfOpsError, save } from './document'

/**
 * Запись разметки в PDF. Для каждого объекта строится форма (Form XObject)
 * в координатах страницы; дальше она становится либо внешним видом (/AP)
 * PDF-аннотации — пометку видно и можно удалить в других программах, — либо
 * рисуется прямо в содержимом страницы (flatten), и тогда объектов
 * аннотаций в файле нет. Непрозрачность и режим наложения маркера заданы
 * внутри формы, поэтому оба режима выглядят одинаково во всех просмотрщиках.
 */

export type { MarkupSaveMode } from '../settings-schema'

export interface ApplyMarkupOptions {
  mode: MarkupSaveMode
  /** TTF-шрифт с кириллицей для текстовых блоков (PT Sans); нужен, если есть текст. */
  font?: Uint8Array | null
}

interface Context {
  doc: PDFDocument
  font: PDFFont | null
  /** Ширины строк тем же fontkit, что и на экране: перенос в рамке совпадает. */
  measure: MeasureText | null
  images: Map<string, PDFImage>
}

interface Appearance {
  bbox: Rect
  ops: PDFOperator[]
  resources: Record<string, Record<string, unknown>>
}

const ANNOT_SUBTYPE: Record<MarkupObject['kind'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  ink: 'Ink',
  rect: 'Square',
  ellipse: 'Circle',
  line: 'Line',
  arrow: 'Line',
  text: 'FreeText',
  image: 'Stamp'
}
/** Флаг /F 4 — «печатать»: пометки выходят и на бумаге. */
const PRINT_FLAG = 4
/** Кривые Безье, приближающие четверть окружности. */
const KAPPA = 0.5522847498

const round = (value: number): number => Math.round(value * 1000) / 1000

function rectArray(r: Rect): number[] {
  return [round(r.x), round(r.y), round(r.x + r.width), round(r.y + r.height)]
}

function strokeColor(color: string): PDFOperator {
  const [r, g, b] = parseHexColor(color)
  return setStrokingRgbColor(r, g, b)
}

function fillColor(color: string): PDFOperator {
  const [r, g, b] = parseHexColor(color)
  return setFillingRgbColor(r, g, b)
}

function polyline(points: readonly Point[]): PDFOperator[] {
  const [first, ...rest] = points
  if (!first) return []
  const tail = rest.length > 0 ? rest : [first]
  return [moveTo(first.x, first.y), ...tail.map((p) => lineTo(p.x, p.y))]
}

function ellipsePath(r: Rect): PDFOperator[] {
  const rx = r.width / 2
  const ry = r.height / 2
  const cx = r.x + rx
  const cy = r.y + ry
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  return [
    moveTo(cx - rx, cy),
    appendBezierCurve(cx - rx, cy + oy, cx - ox, cy + ry, cx, cy + ry),
    appendBezierCurve(cx + ox, cy + ry, cx + rx, cy + oy, cx + rx, cy),
    appendBezierCurve(cx + rx, cy - oy, cx + ox, cy - ry, cx, cy - ry),
    appendBezierCurve(cx - ox, cy - ry, cx - rx, cy - oy, cx - rx, cy),
    closePath()
  ]
}

function cm(m: Matrix): PDFOperator {
  return concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5])
}

/** Матрица содержимого коробки с осью Y вверх и началом в левом нижнем углу. */
function boxMatrixYUp(o: TextObject | ImageObject): {
  matrix: Matrix
  width: number
  height: number
} {
  const size = boxContentSize(o.rect, o.rotate)
  const flip: Matrix = [1, 0, 0, -1, 0, size.height]
  return { matrix: multiply(flip, boxContentMatrix(o.rect, o.rotate)), ...size }
}

async function embedImage(ctx: Context, src: string): Promise<PDFImage> {
  const cached = ctx.images.get(src)
  if (cached) return cached
  const { format, bytes } = decodeImageDataUrl(src)
  const image = format === 'png' ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes)
  ctx.images.set(src, image)
  return image
}

async function buildAppearance(ctx: Context, o: MarkupObject): Promise<Appearance> {
  const gstate: Record<string, unknown> = { Type: 'ExtGState', CA: o.opacity, ca: o.opacity }
  if (o.kind === 'highlight') gstate.BM = 'Multiply'
  const resources: Appearance['resources'] = { ExtGState: { GS0: gstate } }
  const body: PDFOperator[] = []
  switch (o.kind) {
    case 'highlight':
      body.push(fillColor(o.color))
      for (const r of o.rects) body.push(rectangle(r.x, r.y, r.width, r.height))
      body.push(fill())
      break
    case 'underline':
    case 'strikeout':
      body.push(strokeColor(o.color))
      for (const r of o.rects) {
        const line = textLineStroke(r, o.kind)
        body.push(setLineWidth(line.width), ...polyline([line.from, line.to]), stroke())
      }
      break
    case 'ink':
      body.push(
        strokeColor(o.color),
        setLineWidth(o.width),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round)
      )
      for (const path of o.paths) body.push(...polyline(path))
      body.push(stroke())
      break
    case 'rect':
      body.push(
        strokeColor(o.color),
        setLineWidth(o.width),
        rectangle(o.rect.x, o.rect.y, o.rect.width, o.rect.height),
        stroke()
      )
      break
    case 'ellipse':
      body.push(strokeColor(o.color), setLineWidth(o.width), ...ellipsePath(o.rect), stroke())
      break
    case 'line':
    case 'arrow':
      body.push(
        strokeColor(o.color),
        setLineWidth(o.width),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
        ...polyline([o.from, o.to])
      )
      if (o.kind === 'arrow') {
        const [left, right] = arrowHead(o.from, o.to, o.width)
        body.push(...polyline([left, o.to, right]))
      }
      body.push(stroke())
      break
    case 'text': {
      const { font, measure } = ctx
      if (!font || !measure)
        throw new PdfOpsError(
          m({ ru: 'Нет шрифта для текстовых блоков.', en: 'No font for text boxes.' })
        )
      const box = boxMatrixYUp(o)
      const layout = layoutTextObject(o, measure)
      resources.Font = { F1: font.ref }
      body.push(cm(box.matrix), fillColor(o.color), beginText(), setFontAndSize('F1', o.fontSize))
      for (const line of layout.lines) {
        if (line.text.length === 0) continue
        body.push(
          setTextMatrix(1, 0, 0, 1, round(line.x), round(box.height - line.baseline)),
          showText(font.encodeText(line.text))
        )
      }
      body.push(endText())
      break
    }
    case 'image': {
      const image = await embedImage(ctx, o.src)
      const box = boxMatrixYUp(o)
      resources.XObject = { Im1: image.ref }
      body.push(cm(box.matrix), cm([box.width, 0, 0, box.height, 0, 0]), drawObject('Im1'))
      break
    }
  }
  return {
    bbox: inflate(visualBounds(o), 1),
    ops: [pushGraphicsState(), setGraphicsState('GS0'), ...body, popGraphicsState()],
    resources
  }
}

/** /Rect совпадает с BBox формы: тогда просмотрщики рисуют внешний вид без масштабирования. */
function annotationDict(
  page: PDFPage,
  o: MarkupObject,
  appearance: PDFRef,
  bbox: Rect
): Record<string, unknown> {
  const [r, g, b] = parseHexColor(o.color)
  const now = PDFString.fromDate(new Date())
  const dict: Record<string, unknown> = {
    Type: 'Annot',
    Subtype: ANNOT_SUBTYPE[o.kind],
    Rect: rectArray(bbox),
    C: [round(r), round(g), round(b)],
    F: PRINT_FLAG,
    NM: PDFString.of(o.id),
    M: now,
    CreationDate: now,
    P: page.ref,
    AP: { N: appearance }
  }
  switch (o.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      // Порядок вершин как у Acrobat: верх-лево, верх-право, низ-лево, низ-право.
      dict.QuadPoints = o.rects.flatMap((q) =>
        [q.x, q.y + q.height, q.x + q.width, q.y + q.height, q.x, q.y, q.x + q.width, q.y].map(
          round
        )
      )
      break
    case 'ink':
      dict.InkList = o.paths.map((path) => path.flatMap((p) => [round(p.x), round(p.y)]))
      dict.BS = { W: o.width }
      break
    case 'rect':
    case 'ellipse':
      dict.BS = { W: o.width }
      break
    case 'line':
    case 'arrow':
      dict.L = [o.from.x, o.from.y, o.to.x, o.to.y].map(round)
      dict.BS = { W: o.width }
      if (o.kind === 'arrow') dict.LE = ['None', 'OpenArrow']
      break
    case 'text':
      dict.Contents = PDFHexString.fromText(o.text)
      dict.DA = PDFString.of(`/Helv ${round(o.fontSize)} Tf ${round(r)} ${round(g)} ${round(b)} rg`)
      dict.BS = { W: 0 }
      break
    case 'image':
      dict.Contents = PDFHexString.fromText(
        m({ ru: o.signature ? 'Подпись' : 'Изображение', en: o.signature ? 'Signature' : 'Image' })
      )
      break
  }
  return dict
}

/**
 * Записывает объекты разметки в документ и возвращает новые байты.
 * Пустой список возвращает исходные байты без пересохранения.
 */
export async function applyMarkup(
  bytes: Uint8Array,
  objects: readonly MarkupObject[],
  options: ApplyMarkupOptions
): Promise<Uint8Array> {
  if (objects.length === 0) return bytes
  const doc = await load(bytes)
  const total = doc.getPageCount()
  for (const o of objects) {
    if (!Number.isInteger(o.page) || o.page < 1 || o.page > total) {
      throw new PdfOpsError(
        m({
          ru: `Страницы ${o.page} нет в документе (всего ${total}).`,
          en: `Page ${o.page} is not in the document (${total} in total).`
        })
      )
    }
  }
  let font: PDFFont | null = null
  let measure: MeasureText | null = null
  if (objects.some((o) => o.kind === 'text')) {
    if (!options.font)
      throw new PdfOpsError(
        m({ ru: 'Нет шрифта для текстовых блоков.', en: 'No font for text boxes.' })
      )
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(options.font, { subset: true })
    measure = fontMeasure(fontkit.create(options.font))
  }
  const ctx: Context = { doc, font, measure, images: new Map() }

  const pages = [...new Set(objects.map((o) => o.page))].sort((a, b) => a - b)
  for (const pageNumber of pages) {
    const page = doc.getPage(pageNumber - 1)
    const forms: PDFRef[] = []
    for (const o of objects.filter((item) => item.page === pageNumber)) {
      const ap = await buildAppearance(ctx, o)
      const form = doc.context.formXObject(ap.ops, {
        BBox: rectArray(ap.bbox),
        // Типы словарей pdf-lib (LiteralObject) не экспортируются; context.obj разбирает их сам.
        Resources: ap.resources as never
      })
      const formRef = doc.context.register(form)
      if (options.mode === 'annotation') {
        const annot = doc.context.obj(annotationDict(page, o, formRef, ap.bbox) as never)
        page.node.addAnnot(doc.context.register(annot))
      } else {
        forms.push(formRef)
      }
    }
    if (forms.length > 0) {
      // Исходное содержимое оборачивается в q … Q, чтобы его матрица и цвета
      // не влияли на впечатанную разметку.
      page.node.normalize()
      const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]))
      const end = doc.context.register(doc.context.contentStream([popGraphicsState()]))
      page.node.wrapContentStreams(start, end)
      for (const formRef of forms) {
        const name = page.node.newXObject('PWMarkup', formRef)
        page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState())
      }
    }
  }
  return save(doc)
}
