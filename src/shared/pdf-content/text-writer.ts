import { m } from '../messages'
import type { Font, PDFDocument as MuDocument, PDFObject } from 'mupdf'
import type { Mupdf } from './mupdf'
import { fontFamily, parseToUnicode, sameFamily, type CharCodes } from './to-unicode'
import { PdfContentError } from './types'

/**
 * Запись нового текста шрифтами самого документа. Урезанные подмножества
 * шрифтов (так PDF собирают Cairo, Word и браузеры) часто не содержат своей
 * таблицы Unicode, но в PDF у них есть ToUnicode: по ней берутся коды тех же
 * глифов, а ширины — из словаря шрифта. Буквы, которых нет ни в одном
 * подмножестве семейства, пишутся встроенным в MuPDF шрифтом того же
 * начертания (Nimbus с кириллицей), затем запасным шрифтом программы.
 */

/** Шрифт документа: ссылка на словарь, обратная таблица кодов и ширины. */
export interface DocFont {
  readonly ref: PDFObject
  readonly family: string
  readonly codes: CharCodes
  /** Ширина по коду, в тысячных долях кегля. */
  readonly widths: Map<string, number>
  readonly defaultWidth: number
}

function number(obj: PDFObject, fallback: number): number {
  return obj.isNumber() ? obj.asNumber() : fallback
}

function hexCode(code: number, digits: number): string {
  return code.toString(16).padStart(digits, '0')
}

function readWidths(
  font: PDFObject,
  twoByte: boolean
): { widths: Map<string, number>; dw: number } {
  const widths = new Map<string, number>()
  if (twoByte) {
    const descendant = font.get('DescendantFonts').get(0).resolve()
    const dw = number(descendant.get('DW'), 1000)
    const w = descendant.get('W')
    if (w.isArray()) {
      let i = 0
      while (i < w.length) {
        const first = number(w.get(i), -1)
        const next = w.get(i + 1)
        if (next.isArray()) {
          for (let k = 0; k < next.length; k += 1) {
            widths.set(hexCode(first + k, 4), number(next.get(k), dw))
          }
          i += 2
        } else {
          const last = number(next, -1)
          const value = number(w.get(i + 2), dw)
          for (let c = first; c <= last && c - first < 0x10000; c += 1)
            widths.set(hexCode(c, 4), value)
          i += 3
        }
      }
    }
    return { widths, dw }
  }
  const firstChar = number(font.get('FirstChar'), 0)
  const list = font.get('Widths')
  const missing = number(font.get('FontDescriptor').get('MissingWidth'), 500)
  if (list.isArray()) {
    for (let k = 0; k < list.length; k += 1) {
      widths.set(hexCode(firstChar + k, 2), number(list.get(k), missing))
    }
  }
  return { widths, dw: missing }
}

function readDocFont(font: PDFObject): DocFont | null {
  const subtype = font.get('Subtype')
  const base = font.get('BaseFont')
  const toUnicode = font.get('ToUnicode')
  if (!subtype.isName() || !base.isName() || !toUnicode.isStream()) return null
  const kind = subtype.asName()
  let twoByte: boolean
  if (kind === 'Type0') {
    const encoding = font.get('Encoding')
    if (!encoding.isName() || encoding.asName() !== 'Identity-H') return null
    twoByte = true
  } else if (kind === 'TrueType' || kind === 'Type1' || kind === 'MMType1') {
    twoByte = false
  } else {
    return null
  }
  const buffer = toUnicode.readStream()
  let cmap: string
  try {
    cmap = buffer.asString()
  } finally {
    buffer.destroy()
  }
  const codes = parseToUnicode(cmap)
  const digits = twoByte ? 4 : 2
  for (const [char, code] of codes) if (code.length !== digits) codes.delete(char)
  if (codes.size === 0) return null
  const { widths, dw } = readWidths(font, twoByte)
  return { ref: font, family: fontFamily(base.asName()), codes, widths, defaultWidth: dw }
}

/** Шрифты из ресурсов всех страниц документа (без повторов). */
export function collectDocumentFonts(doc: MuDocument): DocFont[] {
  const fonts: DocFont[] = []
  const seen = new Set<number>()
  const total = doc.countPages()
  for (let i = 0; i < total; i += 1) {
    const dict = doc.findPage(i).getInheritable('Resources').get('Font')
    if (!dict.isDictionary()) continue
    dict.forEach((font) => {
      if (font.isIndirect()) {
        const n = font.asIndirect()
        if (seen.has(n)) return
        seen.add(n)
      }
      try {
        const entry = readDocFont(font.resolve())
        if (entry) fonts.push({ ...entry, ref: font })
      } catch {
        // Повреждённый словарь шрифта — пропускаем.
      }
    })
  }
  return fonts
}

/** Начертание, по которому подбирается встроенный шрифт для недостающих букв. */
export interface StyleHints {
  readonly bold: boolean
  readonly italic: boolean
  readonly serif?: boolean
  readonly mono?: boolean
}

/**
 * Начертание по имени шрифта. Флаги дескриптора у урезанных подмножеств
 * часто неверны (MuPDF называет засечным и Noto Sans), поэтому засечки
 * признаются только по явным словам в имени.
 */
export function styleHintsFromName(name: string, bold: boolean, italic: boolean): StyleHints {
  const family = fontFamily(name)
  return {
    bold: bold || /bold|black|heavy|semibold|demi/i.test(family),
    italic: italic || /italic|oblique/i.test(family),
    serif:
      !/sans/i.test(family) &&
      /serif|times|roman|georgia|garamond|cambria|minion|book|charter|tinos|pt.?astra/i.test(
        family
      ),
    mono: /mono|courier|consol|menlo|code/i.test(family)
  }
}

function builtinFontName(style: StyleHints): string {
  const { bold, italic } = style
  if (style.mono) {
    return `Courier${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`
  }
  if (style.serif) {
    if (bold && italic) return 'Times-BoldItalic'
    if (bold) return 'Times-Bold'
    return italic ? 'Times-Italic' : 'Times-Roman'
  }
  return `Helvetica${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`
}

/** Источник глифа: шрифт документа (его коды) или шрифт, встраиваемый заново (номер глифа). */
export type GlyphSource =
  | { readonly kind: 'doc'; readonly font: DocFont }
  | { readonly kind: 'embedded'; readonly font: Font }

export interface Glyph {
  readonly char: string
  /** Ширина в тысячных долях кегля. */
  readonly width: number
  /** null — пробел, которого нет ни в одном шрифте: только сдвиг. */
  readonly source: GlyphSource | null
  readonly code: string
}

/** Средняя ширина пробела, если его нет ни в одном шрифте. */
const SPACE_WIDTH = 260

/**
 * Набор шрифтов для текста одного стиля: подмножества семейства из документа,
 * исходный шрифт строки, встроенный шрифт того же начертания, запасной шрифт.
 */
export class FontPalette {
  private readonly family: DocFont[]
  private readonly embedded: Font[] = []
  private builtin: Font | null | undefined
  private fallback: Font | null | undefined
  private readonly fallbackFirst: boolean

  constructor(
    private readonly mupdf: Mupdf,
    docFonts: readonly DocFont[],
    familyName: string,
    private readonly style: StyleHints,
    private readonly original: Font | null,
    private readonly fallbackBytes: Uint8Array | undefined
  ) {
    this.family = docFonts.filter((font) => sameFamily(font.family, familyName))
    // Запасной шрифт программы — PT Sans: документу в PT Sans он подходит
    // лучше встроенной Helvetica.
    this.fallbackFirst = /pt.?sans/i.test(fontFamily(familyName)) && !style.bold && !style.italic
  }

  /** Встраиваемые шрифты в порядке предпочтения. */
  private substitutes(): (Font | null)[] {
    return this.fallbackFirst
      ? [this.original, this.getFallback(), this.getBuiltin()]
      : [this.original, this.getBuiltin(), this.getFallback()]
  }

  private getBuiltin(): Font | null {
    if (this.builtin === undefined) {
      try {
        this.builtin = new this.mupdf.Font(builtinFontName(this.style))
        this.embedded.push(this.builtin)
      } catch {
        this.builtin = null
      }
    }
    return this.builtin
  }

  private getFallback(): Font | null {
    if (this.fallback === undefined) {
      this.fallback = null
      if (this.fallbackBytes) {
        try {
          this.fallback = new this.mupdf.Font('PDFwrightFallback', this.fallbackBytes)
          this.embedded.push(this.fallback)
        } catch {
          this.fallback = null
        }
      }
    }
    return this.fallback
  }

  private embeddedGlyph(font: Font | null, char: string): Glyph | null {
    if (!font) return null
    const gid = font.encodeCharacter(char.codePointAt(0) ?? 0)
    if (gid <= 0) return null
    return {
      char,
      width: font.advanceGlyph(gid) * 1000,
      source: { kind: 'embedded', font },
      code: gid.toString(16).padStart(4, '0')
    }
  }

  private static fromDoc(font: DocFont, char: string): Glyph | null {
    const code = font.codes.get(char)
    if (code === undefined) return null
    return {
      char,
      width: font.widths.get(code) ?? font.defaultWidth,
      source: { kind: 'doc', font },
      code
    }
  }

  private docGlyph(char: string, previous: GlyphSource | null): Glyph | null {
    // Тот же источник, что у предыдущей буквы, — меньше переключений шрифта.
    if (previous?.kind === 'doc') {
      const same = FontPalette.fromDoc(previous.font, char)
      if (same) return same
    }
    for (const font of this.family) {
      const hit = FontPalette.fromDoc(font, char)
      if (hit) return hit
    }
    return null
  }

  private glyph(char: string, previous: GlyphSource | null): Glyph | null {
    const fromDoc = this.docGlyph(char, previous)
    if (fromDoc) return fromDoc
    for (const font of this.substitutes()) {
      const glyph = this.embeddedGlyph(font, char)
      if (glyph) return glyph
    }
    return null
  }

  /**
   * Слово одним шрифтом: целиком шрифтом документа, а если в нём нет хотя бы
   * одной буквы — целиком похожим встроенным шрифтом, чтобы буквы разных
   * шрифтов не смешивались внутри слова. null — ни один шрифт не покрывает слово.
   */
  private word(chars: readonly string[], previous: GlyphSource | null): Glyph[] | null {
    const fromDoc: Glyph[] = []
    let source = previous
    for (const char of chars) {
      const glyph = this.docGlyph(char, source)
      if (!glyph) break
      fromDoc.push(glyph)
      source = glyph.source
    }
    if (fromDoc.length === chars.length) return fromDoc
    for (const font of this.substitutes()) {
      const glyphs = chars.map((char) => this.embeddedGlyph(font, char))
      if (glyphs.every((g) => g !== null)) return glyphs
    }
    return null
  }

  /** Глифы текста; бросает PdfContentError, если какой-то буквы нет ни в одном шрифте. */
  glyphs(text: string): Glyph[] {
    const result: Glyph[] = []
    const missing = new Set<string>()
    let previous: GlyphSource | null = null
    const push = (glyph: Glyph): void => {
      result.push(glyph)
      if (glyph.source) previous = glyph.source
    }
    for (const token of text.split(/(\s+)/)) {
      if (token === '') continue
      const chars = Array.from(token)
      const whole = /^\s+$/.test(token) ? null : this.word(chars, previous)
      if (whole) {
        whole.forEach(push)
        continue
      }
      for (const char of chars) {
        const glyph = this.glyph(char, previous)
        if (glyph) push(glyph)
        else if (/\s/.test(char)) push({ char, width: SPACE_WIDTH, source: null, code: '' })
        else missing.add(char)
      }
    }
    if (missing.size > 0) {
      throw new PdfContentError(
        m({
          ru: `В шрифтах нет символов: ${[...missing].join(' ')}`,
          en: `The fonts have no characters: ${[...missing].join(' ')}`
        })
      )
    }
    return result
  }

  /** Ширина текста в пунктах при кегле size. */
  measure(text: string, size: number): number {
    return this.glyphs(text).reduce((sum, g) => sum + g.width, 0) * (size / 1000)
  }

  /** Использует ли текст только шрифты документа (без подстановки). */
  usesOnlyDocumentFonts(text: string): boolean {
    return this.glyphs(text).every((g) => g.source === null || g.source.kind === 'doc')
  }

  dispose(): void {
    for (const font of this.embedded) font.destroy()
    this.embedded.length = 0
  }
}

/**
 * Перенос текста по словам в ширину width (пункты). Переводы строки в тексте
 * сохраняются; слово длиннее строки разрывается по буквам. Пустые строки
 * между абзацами остаются пустыми.
 */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/ +/).filter((word, i, all) => word !== '' || all.length === 1)
    let line = ''
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (line !== '' && measure(candidate) > width) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
      // Слово шире строки — режем по буквам.
      while (measure(line) > width && Array.from(line).length > 1) {
        const chars = Array.from(line)
        let cut = chars.length - 1
        while (cut > 1 && measure(chars.slice(0, cut).join('')) > width) cut -= 1
        lines.push(chars.slice(0, cut).join(''))
        line = chars.slice(cut).join('')
      }
    }
    lines.push(line)
  }
  return lines
}
