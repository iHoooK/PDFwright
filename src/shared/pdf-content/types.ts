/**
 * Типы движка правки содержимого страниц.
 *
 * Все координаты здесь — в пользовательском пространстве страницы PDF, как в
 * pdf-lib: единица — пункт (1/72 дюйма), начало внизу слева, ось Y вверх.
 * Поворот страницы (/Rotate) не учитывается: на повёрнутой странице
 * прямоугольники остаются в неповёрнутом пространстве, а интерфейс переводит
 * их в экранные сам (pdf.js: viewport.convertToViewportRectangle).
 */

/** Точка в пространстве PDF (начало внизу слева, Y вверх). */
export interface PdfSpacePoint {
  readonly x: number
  readonly y: number
}

/**
 * Прямоугольник в пространстве PDF: (x, y) — левый нижний угол, Y растёт вверх.
 * Ширина и высота неотрицательные.
 */
export interface PdfSpaceRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Цвет в RGB, компоненты от 0 до 1. */
export type RgbColor = readonly [number, number, number]

/** Строка текста страницы, как её видит MuPDF (символы на одной базовой линии). */
export interface PageTextLine {
  readonly kind: 'text'
  /** Порядковый номер строки на странице в порядке извлечения. */
  readonly index: number
  readonly text: string
  /** Рамка строки в пространстве PDF. */
  readonly rect: PdfSpaceRect
  /** Начало базовой линии первого символа в пространстве PDF. */
  readonly origin: PdfSpacePoint
  /** Единичный вектор направления письма в пространстве PDF ({1, 0} для обычной строки). */
  readonly direction: PdfSpacePoint
  /** Имя шрифта первого символа, как его сообщает MuPDF (может начинаться с префикса подмножества ABCDEF+). */
  readonly fontName: string
  /** Кегль в пунктах с учётом масштаба страницы. */
  readonly fontSize: number
  readonly bold: boolean
  readonly italic: boolean
  readonly color: RgbColor
}

/** Картинка, нарисованная на странице. */
export interface PageImage {
  readonly kind: 'image'
  readonly index: number
  /** Рамка картинки в пространстве PDF. */
  readonly rect: PdfSpaceRect
  /** Размер исходного растра в пикселях. */
  readonly pixelWidth: number
  readonly pixelHeight: number
}

export interface PageObjects {
  readonly pageIndex: number
  /** Границы страницы (MediaBox, обрезанный CropBox) в пространстве PDF. */
  readonly pageBox: PdfSpaceRect
  readonly lines: readonly PageTextLine[]
  readonly images: readonly PageImage[]
}

/** Чем строку можно найти повторно: достаточно текста и рамки из listPageObjects. */
export type TextLineRef = Pick<PageTextLine, 'text' | 'rect'>

/** Чем картинку можно найти повторно: рамка и размер в пикселях из listPageObjects. */
export type ImageRef = Pick<PageImage, 'rect' | 'pixelWidth' | 'pixelHeight'>

export interface EraseOptions {
  /** Удалить глифы, задетые областью (по умолчанию да). */
  readonly text?: boolean
  /**
   * Картинки: целиком накрытые областью удаляются из файла, у задетых частично
   * стираются пиксели внутри области (по умолчанию да).
   */
  readonly images?: boolean
  /** Векторная графика: удаляются контуры, целиком лежащие в области (по умолчанию да). */
  readonly graphics?: boolean
}

export interface ReplaceTextOptions {
  /**
   * Шрифт TTF/OTF для нового текста, если в исходном шрифте нет нужных глифов.
   * Без него берётся встроенный в MuPDF шрифт (Nimbus Sans/Roman/Mono с кириллицей)
   * по начертанию исходного.
   */
  readonly fallbackFont?: Uint8Array
}

export class PdfContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfContentError'
  }
}
