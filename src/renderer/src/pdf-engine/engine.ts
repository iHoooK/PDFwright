import * as pdfjs from 'pdfjs-dist'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextContent
} from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parsePdfDate } from '@shared/pdf-date'
import { normalizeTurn, type PageBox, type PageGeometry } from '@shared/markup/geometry'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PageViewport = ReturnType<PDFPageProxy['getViewport']>

/**
 * Флаг отмены для асинхронных эффектов. Метод вместо поля: TypeScript сужает
 * `token.cancelled` до false после первой проверки и не учитывает await.
 */
export interface CancelToken {
  cancel: () => void
  isCancelled: () => boolean
}
export function createCancelToken(): CancelToken {
  let cancelled = false
  return {
    cancel: () => {
      cancelled = true
    },
    isCancelled: () => cancelled
  }
}

/** Статические ресурсы pdf.js копируются в public/pdfjs (scripts/copy-pdfjs-assets.mjs). */
const ASSETS = new URL('pdfjs/', document.baseURI).href

/** 100 % в интерфейсе = 96 dpi: один пункт PDF занимает 96/72 CSS-пикселя. */
export const CSS_UNITS = 96 / 72

export type Rotation = 0 | 90 | 180 | 270

export interface PageSize {
  /** Размер страницы в пунктах с учётом её собственного поворота (/Rotate). */
  width: number
  height: number
}

export interface OutlineEntry {
  title: string
  depth: number
  dest: string | unknown[] | null
}

export interface DocumentProperties {
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  creator: string | null
  producer: string | null
  created: Date | null
  modified: Date | null
  pdfVersion: string | null
  encrypted: boolean
}

export type PasswordReason = 'first' | 'wrong'

export class PdfLoadError extends Error {
  constructor(
    readonly kind: 'invalid' | 'cancelled' | 'unknown',
    message: string
  ) {
    super(message)
    this.name = 'PdfLoadError'
  }
}

/**
 * Обёртка над документом pdf.js: кэширует страницы и текст, собирает размеры
 * страниц, разрешает закладки, отдаёт метаданные. Один экземпляр на вкладку.
 */
export class PdfDocument {
  readonly numPages: number
  /** Заполняется прогрессивно в loadSizes; до этого все страницы считаются равными первой. */
  readonly sizes: (PageSize | undefined)[]
  /** Видимая область и /Rotate страниц для перевода разметки в координаты вида. */
  private readonly geometries: (PageGeometry | undefined)[]
  private readonly pages = new Map<number, Promise<PDFPageProxy>>()
  private readonly texts = new Map<number, Promise<TextContent>>()
  private destroyed = false

  constructor(
    private readonly proxy: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
    first: PDFPageProxy
  ) {
    this.numPages = proxy.numPages
    this.sizes = new Array<PageSize | undefined>(this.numPages)
    this.geometries = new Array<PageGeometry | undefined>(this.numPages)
    this.remember(1, first)
  }

  private remember(pageNumber: number, page: PDFPageProxy): void {
    this.sizes[pageNumber - 1] = sizeFromPage(page)
    this.geometries[pageNumber - 1] = {
      box: [...page.view] as unknown as PageBox,
      rotate: normalizeTurn(page.rotate)
    }
  }

  get fingerprint(): string {
    return this.proxy.fingerprints[0] ?? ''
  }

  sizeOf(pageNumber: number): PageSize {
    return this.sizes[pageNumber - 1] ?? this.sizes[0] ?? { width: 612, height: 792 }
  }

  /** Геометрия страницы; пока размеры не прочитаны — как у первой страницы. */
  geometryOf(pageNumber: number): PageGeometry {
    const known = this.geometries[pageNumber - 1] ?? this.geometries[0]
    if (known) return known
    const size = this.sizeOf(pageNumber)
    return { box: [0, 0, size.width, size.height], rotate: 0 }
  }

  getPage(pageNumber: number): Promise<PDFPageProxy> {
    let page = this.pages.get(pageNumber)
    if (!page) {
      page = this.proxy.getPage(pageNumber)
      this.pages.set(pageNumber, page)
    }
    return page
  }

  /** Считывает размеры всех страниц; onProgress вызывается пакетами. */
  async loadSizes(onProgress: (done: number) => void): Promise<void> {
    const batch = 16
    for (let n = 2; n <= this.numPages; n += 1) {
      if (this.destroyed) return
      const page = await this.getPage(n)
      this.remember(n, page)
      if (n % batch === 0) onProgress(n)
    }
    onProgress(this.numPages)
  }

  getTextContent(pageNumber: number): Promise<TextContent> {
    let text = this.texts.get(pageNumber)
    if (!text) {
      text = this.getPage(pageNumber).then((page) => page.getTextContent())
      this.texts.set(pageNumber, text)
    }
    return text
  }

  async getTextItems(pageNumber: number): Promise<string[]> {
    const content = await this.getTextContent(pageNumber)
    return content.items.map((item) => ('str' in item ? item.str : ''))
  }

  async getOutline(): Promise<OutlineEntry[]> {
    const outline = await this.proxy.getOutline()
    const entries: OutlineEntry[] = []
    const walk = (nodes: OutlineNode[], depth: number): void => {
      for (const node of nodes) {
        entries.push({ title: node.title, depth, dest: node.dest })
        if (depth < 8) walk(node.items, depth + 1)
      }
    }
    walk(outline, 0)
    return entries
  }

  /** Номер страницы (с 1) для назначения закладки или null, если разрешить нельзя. */
  async resolveDestination(dest: string | unknown[] | null): Promise<number | null> {
    try {
      const explicit: unknown[] | null =
        typeof dest === 'string' ? await this.proxy.getDestination(dest) : dest
      const target = explicit?.[0]
      if (typeof target === 'number') return target + 1
      if (typeof target === 'object' && target !== null && 'num' in target) {
        return (await this.proxy.getPageIndex(target as { num: number; gen: number })) + 1
      }
    } catch {
      // битая закладка — просто не переходим
    }
    return null
  }

  async getProperties(): Promise<DocumentProperties> {
    const { info } = await this.proxy.getMetadata()
    const meta = info as unknown as Record<string, unknown>
    const str = (key: string): string | null => {
      const value = meta[key]
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
    }
    return {
      title: str('Title'),
      author: str('Author'),
      subject: str('Subject'),
      keywords: str('Keywords'),
      creator: str('Creator'),
      producer: str('Producer'),
      created: parsePdfDate(meta.CreationDate),
      modified: parsePdfDate(meta.ModDate),
      pdfVersion: str('PDFFormatVersion'),
      encrypted: meta.IsEncrypted === true
    }
  }

  destroy(): void {
    this.destroyed = true
    void this.task.destroy()
  }
}

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items: OutlineNode[]
}

function sizeFromPage(page: PDFPageProxy): PageSize {
  const viewport = page.getViewport({ scale: 1 })
  return { width: viewport.width, height: viewport.height }
}

export interface LoadOptions {
  askPassword: (reason: PasswordReason) => Promise<string | null>
}

export async function loadPdfDocument(
  bytes: ArrayBuffer | Uint8Array,
  options: LoadOptions
): Promise<PdfDocument> {
  // pdf.js передаёт буфер в worker и отсоединяет его, поэтому отдаём копию.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes).slice(),
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`
  })
  task.onPassword = (update: (password: string | null) => void, reason: number) => {
    const why: PasswordReason =
      reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'wrong' : 'first'
    void options.askPassword(why).then((password) => {
      if (password === null) void task.destroy()
      else update(password)
    })
  }
  try {
    const proxy = await task.promise
    const first = await proxy.getPage(1)
    return new PdfDocument(proxy, task, first)
  } catch (error) {
    throw toLoadError(error)
  }
}

function toLoadError(error: unknown): PdfLoadError {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || name === 'FormatError') {
    return new PdfLoadError('invalid', 'Файл не является PDF или повреждён.')
  }
  if (name === 'PasswordException' || name === 'AbortException') {
    return new PdfLoadError('cancelled', 'Открытие отменено.')
  }
  const message = error instanceof Error ? error.message : String(error)
  return new PdfLoadError('unknown', `Не удалось открыть файл: ${message}`)
}

export interface RenderHandle {
  done: Promise<void>
  cancel: () => void
}

/**
 * Рисует страницу в canvas с учётом devicePixelRatio. Возвращает ручку
 * для отмены: при смене масштаба или уходе страницы с экрана рендер прерывается.
 */
export function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  pixelRatio: number
): RenderHandle {
  const width = Math.max(1, Math.floor(viewport.width * pixelRatio))
  const height = Math.max(1, Math.floor(viewport.height * pixelRatio))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  const task: RenderTask = page.render({
    canvas,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    annotationMode: pdfjs.AnnotationMode.ENABLE
  })
  const done = task.promise.then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof pdfjs.RenderingCancelledException) return
      throw error
    }
  )
  return {
    done,
    cancel: () => {
      task.cancel()
    }
  }
}

export function viewportFor(page: PDFPageProxy, scale: number, rotation: Rotation): PageViewport {
  return page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
}

export { TextLayer } from 'pdfjs-dist'
export type { PDFPageProxy, TextContent }
