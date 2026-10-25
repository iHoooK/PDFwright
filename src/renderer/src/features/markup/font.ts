import fontkit from '@pdf-lib/fontkit'
import { MARKUP_FONT_FAMILY, MARKUP_FONT_FILE, type MeasureText } from '@shared/markup/text-layout'

/**
 * Шрифт текстовых блоков — PT Sans (OFL 1.1) из public/fonts. Один и тот же
 * файл встраивается в PDF при сохранении, рисует текст на overlay-слое
 * (FontFace из байтов, без отдельного url в CSS) и меряет ширину строк через
 * fontkit — так же, как это делает pdf-lib, поэтому размеры совпадают.
 */

interface LoadedFont {
  bytes: Uint8Array
  measure: MeasureText
}

let loading: Promise<LoadedFont> | null = null
let loaded: LoadedFont | null = null

/** Грубая оценка до загрузки шрифта: средняя ширина буквы PT Sans ≈ 0,52 em. */
const fallbackMeasure: MeasureText = (text, size) => text.length * size * 0.52

export function loadMarkupFont(): Promise<LoadedFont> {
  loading ??= (async () => {
    const response = await fetch(new URL(MARKUP_FONT_FILE, document.baseURI))
    if (!response.ok) throw new Error(`Шрифт не загружен: ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const font = fontkit.create(bytes)
    const unitsPerEm = font.unitsPerEm
    const measure: MeasureText = (text, size) =>
      text.length === 0 ? 0 : (font.layout(text).advanceWidth / unitsPerEm) * size
    const face = new FontFace(MARKUP_FONT_FAMILY, bytes.slice().buffer)
    document.fonts.add(await face.load())
    loaded = { bytes, measure }
    return loaded
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** Измеритель строк: точный после загрузки шрифта, до неё — приблизительный. */
export function measureText(text: string, size: number): number {
  return (loaded?.measure ?? fallbackMeasure)(text, size)
}
