/**
 * Раскладка текстового блока. Одна и та же функция задаёт положение строк
 * на overlay-слое и в PDF, поэтому текст после сохранения стоит там же,
 * где его видел пользователь. Ширины строк меряются шрифтом PT Sans
 * (fontkit в renderer, pdf-lib при записи) — функция measure приходит снаружи.
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

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

export function layoutText(text: string, fontSize: number, measure: MeasureText): TextLayout {
  const pad = fontSize * TEXT_PADDING
  const step = fontSize * LINE_HEIGHT
  const lines = splitLines(text).map((line, i) => ({
    text: line,
    baseline: pad + fontSize * FONT_ASCENT + i * step,
    x: pad,
    width: measure(line, fontSize)
  }))
  const widest = Math.max(fontSize, ...lines.map((l) => l.width))
  return {
    lines,
    width: widest + pad * 2,
    height: pad * 2 + (lines.length - 1) * step + fontSize * (FONT_ASCENT + FONT_DESCENT)
  }
}
