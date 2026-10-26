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

/** Стиль текста: шрифт (имя из PDF, семейство без префикса подмножества), кегль, цвет. */
export interface TextStyle {
  readonly fontName: string
  readonly fontSize: number
  readonly color: RgbColor
  readonly bold: boolean
  readonly italic: boolean
}

/**
 * Абзац: подряд идущие строки одного стиля с общим левым краем и ровным
 * интерлиньяжем. Его текст правится целиком и переносится по ширине заново.
 */
export interface PageTextBlock {
  readonly kind: 'block'
  readonly index: number
  /** Текст абзаца: строки склеены пробелом, явные разрывы (пункты списка) — переводом строки. */
  readonly text: string
  /** Рамка абзаца в пространстве PDF. */
  readonly rect: PdfSpaceRect
  /** Начало базовой линии первой строки. */
  readonly origin: PdfSpacePoint
  /** Единичный вектор направления письма. */
  readonly direction: PdfSpacePoint
  /** Ширина абзаца вдоль направления письма, пт. */
  readonly width: number
  /** Расстояние между базовыми линиями, пт. */
  readonly lineHeight: number
  /** Номера строк (PageTextLine.index), из которых состоит абзац. */
  readonly lines: readonly number[]
  /** Строки абзаца для повторного поиска (replaceBlock). */
  readonly refs: readonly TextLineRef[]
  readonly style: TextStyle
}

/** Векторный контур страницы: заливка (плашки, фон) или линия. */
export interface PageGraphic {
  readonly kind: 'graphic'
  readonly index: number
  /** Рамка контура в пространстве PDF (с толщиной линии). */
  readonly rect: PdfSpaceRect
  readonly fill: RgbColor | null
  readonly stroke: RgbColor | null
}

export interface PageObjects {
  readonly pageIndex: number
  /** Границы страницы (MediaBox, обрезанный CropBox) в пространстве PDF. */
  readonly pageBox: PdfSpaceRect
  readonly lines: readonly PageTextLine[]
  readonly blocks: readonly PageTextBlock[]
  readonly images: readonly PageImage[]
  readonly graphics: readonly PageGraphic[]
  /** Семейства шрифтов документа, которыми можно писать новый текст. */
  readonly fonts: readonly string[]
}

/** Чем строку можно найти повторно: достаточно текста и рамки из listPageObjects. */
export type TextLineRef = Pick<PageTextLine, 'text' | 'rect'>

/** Чем абзац можно найти повторно: его строки. */
export interface TextBlockRef {
  readonly lines: readonly TextLineRef[]
}

/** Чем контур можно найти повторно: рамка и вид. */
export type GraphicRef = Pick<PageGraphic, 'rect' | 'fill' | 'stroke'>

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

/** Изменения стиля при перезаписи текста: шрифт, кегль, цвет. */
export type TextStylePatch = Partial<
  Pick<TextStyle, 'fontName' | 'fontSize' | 'color' | 'bold' | 'italic'>
>

export interface WriteTextOptions extends ReplaceTextOptions {
  /** Ширина колонки для переноса, пт (по умолчанию — прежняя ширина абзаца). */
  readonly width?: number
  /** Новое начало базовой линии первой строки (перенос абзаца). */
  readonly origin?: PdfSpacePoint
  readonly style?: TextStylePatch
  /**
   * Сдвиг содержимого под абзацем, если он стал выше или ниже: вся ширина
   * страницы (по умолчанию), только колонка абзаца или без сдвига.
   */
  readonly shift?: 'page' | 'column' | 'none'
}

export interface InsertTextOptions extends ReplaceTextOptions {
  /** Ширина колонки для переноса, пт; без неё строки рвутся только по переводам строки. */
  readonly width?: number
  /** Расстояние между базовыми линиями, пт (по умолчанию 1,4 кегля). */
  readonly lineHeight?: number
  /** Направление письма в пространстве PDF (по умолчанию слева направо). */
  readonly direction?: PdfSpacePoint
}

export class PdfContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfContentError'
  }
}
