import type { Font } from 'mupdf'
import type { Mupdf } from './mupdf'
import { FontPalette, styleHintsFromName, type DocFont, type Glyph } from './text-writer'
import type { RgbColor } from './types'

/**
 * Раскладка текста со стилем у каждой буквы: абзац со словами разного
 * начертания пишется так, что жирное слово остаётся жирным, а новые буквы
 * берут стиль соседей. Ширины — по шрифтам документа (FontPalette), к каждой
 * букве добавляется межбуквенный интервал исходного текста (Tc).
 */

export interface CharStyle {
  /** Имя шрифта из PDF (семейство определяется без префикса подмножества). */
  readonly fontName: string
  readonly size: number
  readonly color: RgbColor
  readonly bold: boolean
  readonly italic: boolean
  /** Исходный шрифт MuPDF строки (для встраивания, если в нём есть буквы). */
  readonly font: Font | null
}

export interface StyledChar {
  readonly char: string
  readonly style: CharStyle
}

export interface LaidGlyph {
  readonly glyph: Glyph
  readonly style: CharStyle
  /** Продвижение вдоль строки, пт (ширина глифа и межбуквенный интервал). */
  readonly advance: number
  readonly space: boolean
}

export interface LaidRow {
  readonly glyphs: readonly LaidGlyph[]
  /** Последняя строка абзаца (перед явным разрывом или в конце): без выключки. */
  readonly last: boolean
}

function sameStyle(a: CharStyle, b: CharStyle): boolean {
  return (
    a.fontName === b.fontName &&
    a.font === b.font &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    Math.abs(a.size - b.size) < 1e-3 &&
    a.color.every((v, i) => Math.abs(v - (b.color[i] ?? 0)) < 1e-3)
  )
}

/** Наборы шрифтов по стилям: один FontPalette на сочетание шрифта и начертания. */
export class Shaper {
  private readonly palettes = new Map<string, FontPalette>()
  private readonly fontIds = new Map<Font, number>()

  constructor(
    private readonly mupdf: Mupdf,
    private readonly docFonts: readonly DocFont[],
    private readonly fallbackBytes: Uint8Array | undefined
  ) {}

  private paletteFor(style: CharStyle): FontPalette {
    let fontId = 0
    if (style.font) {
      fontId = this.fontIds.get(style.font) ?? this.fontIds.size + 1
      this.fontIds.set(style.font, fontId)
    }
    const key = `${style.fontName}|${String(style.bold)}|${String(style.italic)}|${String(fontId)}`
    let palette = this.palettes.get(key)
    if (!palette) {
      palette = new FontPalette(
        this.mupdf,
        this.docFonts,
        style.fontName,
        styleHintsFromName(style.fontName, style.bold, style.italic),
        style.font,
        this.fallbackBytes
      )
      this.palettes.set(key, palette)
    }
    return palette
  }

  /** Глифы текста без переводов строки; tc — межбуквенный интервал, пт. */
  shape(chars: readonly StyledChar[], tc: number): LaidGlyph[] {
    const result: LaidGlyph[] = []
    let i = 0
    while (i < chars.length) {
      const first = chars[i]
      if (!first) break
      let j = i + 1
      for (let next = chars[j]; next && sameStyle(next.style, first.style); next = chars[j]) j += 1
      const run = chars.slice(i, j)
      const glyphs = this.paletteFor(first.style).glyphs(run.map((c) => c.char).join(''))
      glyphs.forEach((glyph, k) => {
        const style = run[k]?.style ?? first.style
        result.push({
          glyph,
          style,
          advance: (glyph.width * style.size) / 1000 + tc,
          space: /\s/.test(glyph.char)
        })
      })
      i = j
    }
    return result
  }

  dispose(): void {
    for (const palette of this.palettes.values()) palette.dispose()
    this.palettes.clear()
  }
}

function widthOf(glyphs: readonly LaidGlyph[]): number {
  return glyphs.reduce((sum, g) => sum + g.advance, 0)
}

/** Отрезает пробелы в конце строки: они не занимают место при выключке и переносе. */
function trimEnd(glyphs: readonly LaidGlyph[]): LaidGlyph[] {
  let end = glyphs.length
  while (end > 0 && glyphs[end - 1]?.space) end -= 1
  return glyphs.slice(0, end)
}

/**
 * Перенос по словам: абзацы (между явными разрывами) раскладываются в строки
 * не шире width; слово шире строки разрывается по буквам.
 */
export function wrapGlyphs(
  paragraphs: readonly (readonly LaidGlyph[])[],
  width: number
): LaidRow[] {
  const rows: LaidRow[] = []
  for (const paragraph of paragraphs) {
    const words: LaidGlyph[][] = []
    let word: LaidGlyph[] = []
    for (const g of paragraph) {
      word.push(g)
      if (g.space) {
        words.push(word)
        word = []
      }
    }
    if (word.length > 0) words.push(word)
    let line: LaidGlyph[] = []
    const push = (): void => {
      rows.push({ glyphs: trimEnd(line), last: false })
      line = []
    }
    for (const w of words) {
      const candidate = [...line, ...w]
      if (line.length > 0 && widthOf(trimEnd(candidate)) > width) {
        push()
        line = [...w]
      } else {
        line = candidate
      }
      // Слово шире строки — режем по буквам.
      while (widthOf(trimEnd(line)) > width && trimEnd(line).length > 1) {
        let cut = trimEnd(line).length - 1
        while (cut > 1 && widthOf(line.slice(0, cut)) > width) cut -= 1
        rows.push({ glyphs: line.slice(0, cut), last: false })
        line = line.slice(cut)
      }
    }
    rows.push({ glyphs: trimEnd(line), last: true })
  }
  return rows
}

/**
 * Стили букв нового текста по старому: общие буквы (наибольшая общая
 * подпоследовательность после отсечения общего начала и конца) сохраняют
 * свой стиль, вставленные берут стиль предыдущей буквы (в начале — следующей).
 */
export function carryStyles(old: readonly StyledChar[], text: string): StyledChar[] {
  const next = Array.from(text)
  const fallback = old[0]?.style
  if (!fallback) return []
  const styles: (CharStyle | null)[] = next.map(() => null)
  let prefix = 0
  while (prefix < old.length && prefix < next.length && old[prefix]?.char === next[prefix]) {
    styles[prefix] = old[prefix]?.style ?? null
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old[old.length - 1 - suffix]?.char === next[next.length - 1 - suffix]
  ) {
    styles[next.length - 1 - suffix] = old[old.length - 1 - suffix]?.style ?? null
    suffix += 1
  }
  const a = old.slice(prefix, old.length - suffix)
  const b = next.slice(prefix, next.length - suffix)
  if (a.length > 0 && b.length > 0 && a.length * b.length <= 4_000_000) {
    // НОП по таблице длин: середина обычно короткая (правка одного места).
    const cols = b.length + 1
    const table = new Uint16Array((a.length + 1) * cols)
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * cols + j] =
          a[i]?.char === b[j]
            ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
            : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      if (a[i]?.char === b[j]) {
        styles[prefix + j] = a[i]?.style ?? null
        i += 1
        j += 1
      } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
        i += 1
      } else {
        j += 1
      }
    }
  }
  // Вставленные буквы: стиль предыдущей, в начале — ближайшей следующей.
  let previous: CharStyle | null = null
  for (let k = 0; k < styles.length; k += 1) {
    if (styles[k]) previous = styles[k] ?? null
    else if (previous) styles[k] = previous
  }
  let following: CharStyle = fallback
  for (let k = styles.length - 1; k >= 0; k -= 1) {
    const style = styles[k]
    if (style) following = style
    else styles[k] = following
  }
  return next.map((char, k) => ({ char, style: styles[k] ?? fallback }))
}
