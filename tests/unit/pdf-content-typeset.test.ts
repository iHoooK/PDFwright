import { PDFDocument, rgb, setCharacterSpacing, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { listPageObjects, replaceBlock, replaceText, type PageObjects } from '@shared/pdf-content'
import { carryStyles, type CharStyle } from '@shared/pdf-content/typeset'

function blockStarting(objects: PageObjects, start: string) {
  const block = objects.blocks.find((b) => b.text.startsWith(start))
  if (!block) throw new Error(`нет абзаца «${start}»`)
  return block
}

describe('стили букв при правке', () => {
  const regular: CharStyle = {
    fontName: 'Regular',
    size: 10,
    color: [0, 0, 0],
    bold: false,
    italic: false,
    font: null
  }
  const bold: CharStyle = { ...regular, fontName: 'Bold', bold: true }
  const styled = (text: string, styles: CharStyle[]) =>
    Array.from(text).map((char, i) => ({ char, style: styles[i] ?? regular }))

  it('общие буквы сохраняют стиль, вставленные берут стиль соседа', () => {
    const old = styled('ab CD ef', [
      regular,
      regular,
      regular,
      bold,
      bold,
      regular,
      regular,
      regular
    ])
    const next = carryStyles(old, 'ab CDX efg')
    expect(next.map((c) => c.style.bold)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false
    ])
  })

  it('вставка в начало берёт стиль первой буквы', () => {
    const next = carryStyles(styled('CD', [bold, bold]), 'xCD')
    expect(next[0]?.style.bold).toBe(true)
  })
})

describe('абзац со смешанным начертанием', () => {
  it('жирное слово остаётся жирным после правки соседнего слова', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
    const page = doc.addPage([400, 400])
    page.drawText('Normal ', { x: 40, y: 300, size: 12, font })
    const after = 40 + font.widthOfTextAtSize('Normal ', 12)
    page.drawText('Bold', { x: after, y: 300, size: 12, font: boldFont })
    page.drawText(' text', {
      x: after + boldFont.widthOfTextAtSize('Bold', 12),
      y: 300,
      size: 12,
      font
    })
    const bytes = await doc.save()

    const objects = await listPageObjects(bytes, 0)
    const block = blockStarting(objects, 'Normal')
    expect(block.text).toBe('Normal Bold text')
    expect(block.lines.length).toBeGreaterThanOrEqual(3)

    const next = await replaceBlock(bytes, 0, { lines: block.refs }, 'Normal Bold words')
    const lines = (await listPageObjects(next, 0)).lines
    const boldLine = lines.find((l) => l.text.includes('Bold'))
    expect(boldLine?.bold).toBe(true)
    const tail = lines.find((l) => l.text.includes('words'))
    expect(tail?.bold).toBe(false)
  })
})

describe('сдвиг содержимого ниже абзаца', () => {
  it('удлинённый абзац сдвигает строку и плашку ниже, они остаются текстом и контуром', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([400, 500])
    page.drawText('First line of the paragraph here', { x: 40, y: 400, size: 12, font })
    page.drawText('second line of the paragraph.', { x: 40, y: 385, size: 12, font })
    page.drawText('Below line', { x: 40, y: 340, size: 12, font })
    page.drawRectangle({ x: 40, y: 300, width: 200, height: 20, color: rgb(0.8, 0.8, 0.8) })
    const bytes = await doc.save()

    const before = await listPageObjects(bytes, 0)
    const block = blockStarting(before, 'First line')
    const belowBefore = before.lines.find((l) => l.text === 'Below line')
    const boxBefore = before.graphics.find((g) => g.fill !== null)
    const text = `${block.text} And two more sentences that need more lines to fit in the column.`
    const next = await replaceBlock(bytes, 0, { lines: block.refs }, text)

    const after = await listPageObjects(next, 0)
    const grown = blockStarting(after, 'First line')
    const extraRows = Math.round(grown.rect.height / block.lineHeight) - 2
    expect(extraRows).toBeGreaterThan(0)
    const belowAfter = after.lines.find((l) => l.text === 'Below line')
    const boxAfter = after.graphics.find((g) => g.fill !== null)
    const shift = (belowBefore?.origin.y ?? 0) - (belowAfter?.origin.y ?? 0)
    expect(shift).toBeGreaterThan(block.lineHeight * 0.9)
    expect((boxBefore?.rect.y ?? 0) - (boxAfter?.rect.y ?? 0)).toBeCloseTo(shift, 0)
    // Строку ниже можно и дальше править: она осталась настоящим текстом.
    const moved = after.lines.find((l) => l.text === 'Below line')
    if (!moved) throw new Error('нет строки')
    const edited = await replaceText(next, 0, moved, 'Below line edited')
    expect(
      (await listPageObjects(edited, 0)).lines.some((l) => l.text === 'Below line edited')
    ).toBe(true)
  })

  it('без сдвига (shift: none) содержимое ниже остаётся на месте', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([400, 500])
    page.drawText('One line paragraph', { x: 40, y: 400, size: 12, font })
    page.drawText('second row', { x: 40, y: 385, size: 12, font })
    page.drawText('Stays here', { x: 40, y: 300, size: 12, font })
    const bytes = await doc.save()
    const before = await listPageObjects(bytes, 0)
    const block = blockStarting(before, 'One line')
    const next = await replaceBlock(
      bytes,
      0,
      { lines: block.refs },
      `${block.text} more more more more more more more more more`,
      {
        shift: 'none'
      }
    )
    const stays = (await listPageObjects(next, 0)).lines.find((l) => l.text === 'Stays here')
    expect(stays?.origin.y).toBeCloseTo(300, 0)
  })
})

describe('межбуквенный интервал', () => {
  it('разреженная строка после замены той же длины остаётся той же ширины', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([400, 400])
    page.pushOperators(setCharacterSpacing(0.6))
    page.drawText('Spaced letters here', { x: 40, y: 300, size: 12, font })
    page.pushOperators(setCharacterSpacing(0))
    const bytes = await doc.save()
    const line = (await listPageObjects(bytes, 0)).lines.find(
      (l) => l.text === 'Spaced letters here'
    )
    if (!line) throw new Error('нет строки')
    const next = await replaceText(bytes, 0, line, 'Spaced letters hare')
    const replaced = (await listPageObjects(next, 0)).lines.find(
      (l) => l.text === 'Spaced letters hare'
    )
    // Без интервала строка была бы уже на 0,6 пт × 18 промежутков ≈ 11 пт.
    expect(Math.abs((replaced?.rect.width ?? 0) - line.rect.width)).toBeLessThan(3)
  })
})
