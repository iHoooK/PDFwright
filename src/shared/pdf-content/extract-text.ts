import { loadMupdf } from './mupdf'
import { openPdf } from './open'
import { PdfContentError } from './types'

/**
 * Извлечение текста страниц на MuPDF (structured text). MuPDF отдаёт строки
 * в порядке потока содержимого, а он не всегда совпадает с видимым: строки
 * упорядочиваются сверху вниз и слева направо, куски одной строки
 * склеиваются, между абзацами остаётся пустая строка.
 */

/** Строка страницы: текст и рамка в пространстве MuPDF (начало вверху слева, Y вниз). */
export interface TextLineBox {
  text: string
  box: readonly [number, number, number, number]
}

interface Row {
  top: number
  bottom: number
  items: { text: string; x0: number; x1: number; height: number }[]
}

/** Складывает строки страницы в текст в видимом порядке. Чистая функция. */
export function linesToText(lines: readonly TextLineBox[]): string {
  const items = lines
    .map(({ text, box }) => ({
      text: text.replace(/\s+$/, ''),
      x0: box[0],
      y0: box[1],
      x1: box[2],
      y1: box[3]
    }))
    .filter((item) => item.text.trim().length > 0)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)

  const rows: Row[] = []
  for (const item of items) {
    const height = Math.max(0.1, item.y1 - item.y0)
    const center = (item.y0 + item.y1) / 2
    const row = rows[rows.length - 1]
    // Та же строка, если середина куска внутри строки и высоты сопоставимы.
    const rowHeight = row ? row.bottom - row.top : 0
    if (
      row &&
      center > row.top &&
      center < row.bottom &&
      Math.abs(center - (row.top + row.bottom) / 2) < Math.min(height, rowHeight) / 2
    ) {
      row.items.push({ text: item.text, x0: item.x0, x1: item.x1, height })
      row.top = Math.min(row.top, item.y0)
      row.bottom = Math.max(row.bottom, item.y1)
    } else {
      rows.push({
        top: item.y0,
        bottom: item.y1,
        items: [{ text: item.text, x0: item.x0, x1: item.x1, height }]
      })
    }
  }

  const out: string[] = []
  let previous: Row | null = null
  for (const row of rows) {
    const height = row.bottom - row.top
    if (
      previous &&
      row.top - previous.bottom > 0.8 * Math.min(height, previous.bottom - previous.top)
    ) {
      out.push('')
    }
    out.push(joinRow(row))
    previous = row
  }
  return out.join('\n')
}

function joinRow(row: Row): string {
  const items = [...row.items].sort((a, b) => a.x0 - b.x0)
  let text = ''
  let right = -Infinity
  for (const item of items) {
    if (text.length > 0) {
      const gap = item.x0 - right
      // Далеко стоящие куски (колонки таблицы) — через табуляцию.
      text += gap > 2 * item.height ? '\t' : gap > 0.1 * item.height ? ' ' : ''
    }
    text += text.length > 0 ? item.text.trimStart() : item.text
    right = Math.max(right, item.x1)
  }
  return text
}

/**
 * Текст страниц документа. pageIndices — номера с 0 в нужном порядке; без
 * него — все страницы. Возвращает по строке текста на каждую страницу.
 */
export async function extractText(
  bytes: Uint8Array,
  pageIndices?: readonly number[]
): Promise<string[]> {
  const mupdf = await loadMupdf()
  const doc = openPdf(
    mupdf,
    bytes,
    'Документ зашифрован: текст защищённых паролем файлов не извлекается.'
  )
  try {
    const total = doc.countPages()
    const indices = pageIndices ?? Array.from({ length: total }, (_, i) => i)
    return indices.map((index) => {
      if (!Number.isInteger(index) || index < 0 || index >= total) {
        throw new PdfContentError(`Страницы ${index + 1} нет в документе (всего ${total}).`)
      }
      const page = doc.loadPage(index)
      const stext = page.toStructuredText('')
      const lines: TextLineBox[] = []
      let current: TextLineBox | null = null
      try {
        stext.walk({
          beginLine(bbox) {
            current = { text: '', box: [bbox[0], bbox[1], bbox[2], bbox[3]] }
          },
          onChar(c, _origin, font) {
            font.destroy()
            if (current) current.text += c
          },
          endLine() {
            if (current) lines.push(current)
            current = null
          }
        })
      } finally {
        stext.destroy()
        page.destroy()
      }
      return linesToText(lines)
    })
  } finally {
    doc.destroy()
  }
}
