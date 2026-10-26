import type { Matrix as MuMatrix, Path, PDFPage as MuPage, StrokeState } from 'mupdf'
import { boxToRect, concat, pdfNumber, transformBox, transformPoint, type Matrix } from './geometry'
import type { Mupdf } from './mupdf'
import type { PageGraphic, PdfSpaceRect, RgbColor } from './types'

/**
 * Векторные контуры страницы (плашки, фон шапки, линейки) через устройство
 * MuPDF: для каждого контура — рамка, цвет и сам путь в пространстве PDF,
 * чтобы контур можно было нарисовать заново в другом месте и размере.
 */

type Segment =
  | { op: 'm' | 'l'; pts: [number, number] }
  | { op: 'c'; pts: [number, number, number, number, number, number] }
  | { op: 'h' }

export interface RawGraphic {
  /** Рамка в пространстве MuPDF (с толщиной линии). */
  box: [number, number, number, number]
  /** Путь в пространстве PDF. */
  path: Segment[]
  fill: RgbColor | null
  stroke: RgbColor | null
  evenOdd: boolean
  alpha: number
  /** Толщина линии в пространстве PDF. */
  lineWidth: number
  lineCap: number
  lineJoin: number
  miterLimit: number
  dashes: number[] | null
  dashPhase: number
}

function toRgb(color: readonly number[]): RgbColor {
  if (color.length === 1) {
    const g = color[0] ?? 0
    return [g, g, g]
  }
  if (color.length === 4) {
    const [c = 0, m = 0, y = 0, k = 0] = color
    return [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)]
  }
  const [r = 0, g = 0, b = 0] = color
  return [r, g, b]
}

/** Контуры страницы по порядку рисования. toPdf — пространство MuPDF → PDF. */
export function listGraphics(mupdf: Mupdf, page: MuPage, toPdf: Matrix): RawGraphic[] {
  const result: RawGraphic[] = []
  const hairline = new mupdf.StrokeState({
    lineCap: 'Butt',
    lineJoin: 'Miter',
    lineWidth: 0,
    miterLimit: 10
  })
  const record = (
    path: Path,
    ctm: MuMatrix,
    stroke: StrokeState | null,
    color: number[],
    alpha: number,
    evenOdd: boolean
  ): void => {
    const toUser = concat(ctm, toPdf)
    const segments: Segment[] = []
    const p = (x: number, y: number): [number, number] => transformPoint(toUser, x, y)
    path.walk({
      moveTo: (x, y) => segments.push({ op: 'm', pts: p(x, y) }),
      lineTo: (x, y) => segments.push({ op: 'l', pts: p(x, y) }),
      curveTo: (x1, y1, x2, y2, x3, y3) =>
        segments.push({ op: 'c', pts: [...p(x1, y1), ...p(x2, y2), ...p(x3, y3)] }),
      closePath: () => segments.push({ op: 'h' })
    })
    if (segments.length === 0) return
    const scale = Math.sqrt(Math.abs(toUser[0] * toUser[3] - toUser[1] * toUser[2]))
    const bounds = path.getBounds(stroke ?? hairline, ctm)
    result.push({
      box: [bounds[0], bounds[1], bounds[2], bounds[3]],
      path: segments,
      fill: stroke ? null : toRgb(color),
      stroke: stroke ? toRgb(color) : null,
      evenOdd,
      alpha,
      lineWidth: stroke ? stroke.getLineWidth() * scale : 0,
      lineCap: stroke?.getLineCap() ?? 0,
      lineJoin: stroke?.getLineJoin() ?? 0,
      miterLimit: stroke?.getMiterLimit() ?? 10,
      dashes: stroke?.getDashes()?.map((v) => v * scale) ?? null,
      dashPhase: (stroke?.getDashPhase() ?? 0) * scale
    })
  }
  const device = new mupdf.Device({
    fillPath(path, evenOdd, ctm, _colorspace, color, alpha) {
      record(path, ctm, null, color, alpha, evenOdd)
    },
    strokePath(path, stroke, ctm, _colorspace, color, alpha) {
      record(path, ctm, stroke, color, alpha, false)
    }
  })
  try {
    page.runPageContents(device, mupdf.Matrix.identity)
    device.close()
  } finally {
    device.destroy()
    hairline.destroy()
  }
  return result
}

export function toPageGraphic(raw: RawGraphic, index: number, toPdf: Matrix): PageGraphic {
  return {
    kind: 'graphic',
    index,
    rect: boxToRect(transformBox(toPdf, raw.box)),
    fill: raw.fill,
    stroke: raw.stroke
  }
}

/**
 * Операторы PDF, рисующие контур заново с матрицей m (в пространстве PDF).
 * gsName — ресурс ExtGState с прозрачностью, если она нужна.
 */
export function graphicOperators(raw: RawGraphic, m: Matrix, gsName: string | null): string {
  const n = pdfNumber
  const pt = (x: number, y: number): string => transformPoint(m, x, y).map(n).join(' ')
  const ops: string[] = ['q']
  if (gsName) ops.push(`/${gsName} gs`)
  // Толщина линии и штрих не масштабируются: растягивание меняет только геометрию.
  if (raw.stroke) {
    ops.push(`${raw.stroke.map(n).join(' ')} RG`)
    ops.push(
      `${n(raw.lineWidth)} w ${Math.min(raw.lineCap, 2)} J ${Math.min(raw.lineJoin, 2)} j ${n(raw.miterLimit)} M`
    )
    if (raw.dashes && raw.dashes.length > 0) {
      ops.push(`[${raw.dashes.map(n).join(' ')}] ${n(raw.dashPhase)} d`)
    }
  }
  if (raw.fill) ops.push(`${raw.fill.map(n).join(' ')} rg`)
  for (const s of raw.path) {
    if (s.op === 'h') ops.push('h')
    else if (s.op === 'c') {
      const [a, b, c, d, e, f] = s.pts
      ops.push(`${pt(a, b)} ${pt(c, d)} ${pt(e, f)} c`)
    } else ops.push(`${pt(s.pts[0], s.pts[1])} ${s.op}`)
  }
  ops.push(raw.stroke ? 'S' : raw.evenOdd ? 'f*' : 'f')
  ops.push('Q')
  return ops.join('\n')
}

/** Рамка контура в пространстве PDF без толщины линии — для переноса пути. */
export function pathBounds(raw: RawGraphic): PdfSpaceRect {
  const xs: number[] = []
  const ys: number[] = []
  for (const s of raw.path) {
    if (s.op === 'h') continue
    for (let i = 0; i < s.pts.length; i += 2) {
      xs.push(s.pts[i] ?? 0)
      ys.push(s.pts[i + 1] ?? 0)
    }
  }
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 }
}
