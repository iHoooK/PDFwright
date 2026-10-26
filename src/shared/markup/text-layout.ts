import {
  apply,
  boxContentMatrix,
  boxContentSize,
  resizeBoxKeepingOrigin,
  type PageBox
} from './geometry'
import type { TextObject } from './model'

/**
 * Раскладка текстового блока. Одна и та же функция задаёт положение строк
 * на overlay-слое и в PDF, поэтому текст после сохранения стоит там же,
 * где его видел пользователь. Ширины строк меряются шрифтом PT Sans через
 * fontkit (fontMeasure) и в renderer, и при записи — функция measure
 * приходит снаружи, а перенос по словам решается одинаково.
 */

/** Файл встроенного шрифта (OFL 1.1, ParaType), лежит в src/renderer/public/fonts. */
export const MARKUP_FONT_FILE = 'fonts/PTSans-Regular.ttf'
export const MARKUP_FONT_FAMILY = 'PDFwright PT Sans'

/** Метрики PT Sans Regular из hhea (единиц на em — 1000). */
export const FONT_ASCENT = 1.018
export const FONT_DESCENT = 0.276
export const LINE_HEIGHT = 1.3
/** Поле вокруг текста в долях кегля. */
export const TEXT_PADDING = 0.25

export interface TextLine {
  text: string
  /** Смещение базовой линии от верха блока вниз, пт. */
  baseline: number
  /** Отступ слева, пт. */
  x: number
  width: number
}

export interface TextLayout {
  lines: TextLine[]
  width: number
  height: number
}

/** measure(text, fontSize) — ширина строки в пунктах. */
export type MeasureText = (text: string, fontSize: number) => number

/** Шрифт fontkit — то, что нужно от него для измерения строк. */
export interface ShapingFont {
  unitsPerEm: number
  layout(text: string): { advanceWidth: number }
}

/** Измеритель строк по шрифту fontkit: одинаковый в renderer и при записи PDF. */
export function fontMeasure(font: ShapingFont): MeasureText {
  return (text, size) =>
    text.length === 0 ? 0 : (font.layout(text).advanceWidth / font.unitsPerEm) * size
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Разрыв слова, которое не помещается в строку целиком, по буквам (минимум буква на строку). */
function breakWord(word: string, fits: (s: string) => boolean): string[] {
  const parts: string[] = []
  let current = ''
  for (const char of Array.from(word)) {
    if (current.length > 0 && !fits(current + char)) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
}

/**
 * Перенос абзаца по словам в ширину limit (пт). Пробелы на месте переноса
 * «висят» за краем и в строку не попадают, как у textarea с pre-wrap;
 * слово длиннее строки разрывается по буквам.
 */
export function wrapParagraph(
  paragraph: string,
  limit: number,
  fontSize: number,
  measure: MeasureText
): string[] {
  const fits = (s: string): boolean => measure(s.trimEnd(), fontSize) <= limit + 1e-6
  const tokens = paragraph.match(/\s+|\S+\s*/g) ?? []
  if (tokens.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  for (const token of tokens) {
    if (fits(line + token)) {
      line += token
      continue
    }
    if (line.trim().length > 0) {
      lines.push(line.trimEnd())
      line = ''
    }
    if (fits(line + token)) {
      line += token
      continue
    }
    // Слово не помещается и в пустую строку: куски по буквам, хвост продолжает строку.
    const word = token.trimEnd()
    const pieces = breakWord(line + word, fits)
    lines.push(...pieces.slice(0, -1))
    line = (pieces.at(-1) ?? '') + token.slice(word.length)
  }
  lines.push(line.trimEnd().length > 0 ? line.trimEnd() : line)
  return lines
}

/**
 * Раскладка блока. Без boxWidth блок растёт по тексту (строки только по
 * переводам строки); с boxWidth — рамка заданной ширины (вместе с полями),
 * и строки переносятся по словам внутри неё.
 */
export function layoutText(
  text: string,
  fontSize: number,
  measure: MeasureText,
  boxWidth?: number
): TextLayout {
  const pad = fontSize * TEXT_PADDING
  const step = fontSize * LINE_HEIGHT
  const paragraphs = splitLines(text)
  const texts =
    boxWidth === undefined
      ? paragraphs
      : paragraphs.flatMap((p) => wrapParagraph(p, boxWidth - pad * 2, fontSize, measure))
  const lines = texts.map((line, i) => ({
    text: line,
    baseline: pad + fontSize * FONT_ASCENT + i * step,
    x: pad,
    width: measure(line, fontSize)
  }))
  const widest = Math.max(fontSize, ...lines.map((l) => l.width))
  return {
    lines,
    width: boxWidth ?? widest + pad * 2,
    height: pad * 2 + (lines.length - 1) * step + fontSize * (FONT_ASCENT + FONT_DESCENT)
  }
}

/** Раскладка текстового блока: рамка заданной ширины переносит строки, иначе растёт по тексту. */
export function layoutTextObject(o: TextObject, measure: MeasureText): TextLayout {
  const width = o.fixedWidth === true ? boxContentSize(o.rect, o.rotate).width : undefined
  return layoutText(o.text, o.fontSize, measure, width)
}

/**
 * Подгоняет рамку блока под текст после правки текста или кегля, не сдвигая
 * начало текста. Блок без заданной ширины принимает размер текста; у рамки
 * заданной ширины ширина остаётся, а высота — не меньше высоты текста
 * (пустое место, оставленное пользователем, сохраняется).
 */
export function fitTextBox(o: TextObject, measure: MeasureText, page?: PageBox): TextObject {
  const layout = layoutTextObject(o, measure)
  const content = boxContentSize(o.rect, o.rotate)
  if (o.fixedWidth !== true && page) {
    // Блок, растущий по тексту, не выходит за край страницы: там он получает
    // заданную ширину и дальше переносит строки.
    const available = roomToPageEdge(o, page)
    if (layout.width > available && available >= o.fontSize * 3) {
      return fitTextBox(
        {
          ...o,
          fixedWidth: true,
          rect: resizeBoxKeepingOrigin(o.rect, o.rotate, available, content.height)
        },
        measure
      )
    }
  }
  const height = o.fixedWidth === true ? Math.max(content.height, layout.height) : layout.height
  return { ...o, rect: resizeBoxKeepingOrigin(o.rect, o.rotate, layout.width, height) }
}

/** Сколько места от начала текста блока до края страницы вдоль строки, пт. */
function roomToPageEdge(o: TextObject, page: PageBox): number {
  const origin = apply(boxContentMatrix(o.rect, o.rotate), { x: 0, y: 0 })
  const [x0, y0, x1, y1] = page
  switch (o.rotate) {
    case 90:
      return y1 - origin.y
    case 180:
      return origin.x - x0
    case 270:
      return origin.y - y0
    default:
      return x1 - origin.x
  }
}
