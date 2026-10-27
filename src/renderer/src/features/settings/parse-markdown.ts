/**
 * Небольшой разбор Markdown для окна «Лицензии и приватность»: заголовки,
 * абзацы, списки, таблицы, блоки кода, а внутри строк — `код`, **жирный**
 * и [ссылки](адрес). Этого хватает для PRIVACY.md и THIRD_PARTY_NOTICES.md;
 * HTML не разбирается, комментарии <!-- … --> пропускаются.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; url: string }

export type Block =
  | { kind: 'heading'; level: number; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; text: string }

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(source: string): Inline[] {
  const result: Inline[] = []
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    const at = match.index
    if (at > last) result.push({ kind: 'text', text: source.slice(last, at) })
    const [whole, code, strong, linkText, url] = match
    if (code !== undefined) result.push({ kind: 'code', text: code })
    else if (strong !== undefined) result.push({ kind: 'strong', text: strong })
    else if (linkText !== undefined && url !== undefined)
      result.push({ kind: 'link', text: linkText, url })
    last = at + whole.length
  }
  if (last < source.length) result.push({ kind: 'text', text: source.slice(last) })
  return result
}

/** Ячейки строки таблицы `| a | b |`; экранированная `\|` остаётся в ячейке. */
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

const isTableRule = (line: string): boolean =>
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
const isListItem = (line: string): boolean => /^\s*[-*]\s+/.test(line)
const isTableRow = (line: string): boolean => line.trim().startsWith('|')

/**
 * Таблица пакетов из THIRD_PARTY_NOTICES.md (между маркерами deps:start и
 * deps:end, её пишет scripts/third-party.mjs): английский перечень берёт её
 * отсюда, чтобы не вести второй сгенерированный список. header заменяет
 * строку заголовков таблицы (в файле она по-русски).
 */
export function generatedTable(notices: string, header?: readonly string[]): string {
  const start = notices.indexOf('<!-- deps:start -->')
  const end = notices.indexOf('<!-- deps:end -->')
  if (start === -1 || end <= start) return ''
  const rows = notices
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
  if (header && rows.length > 0) rows[0] = `| ${header.join(' | ')} |`
  return rows.join('\n')
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  const at = (i: number): string => lines[i] ?? ''

  while (index < lines.length) {
    const line = at(index)
    const trimmed = line.trim()

    if (trimmed === '') {
      index += 1
      continue
    }

    // Комментарии HTML (маркеры сгенерированных частей) не показываются.
    if (trimmed.startsWith('<!--')) {
      while (index < lines.length && !at(index).includes('-->')) index += 1
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !at(index).trim().startsWith('```')) {
        code.push(at(index))
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        text: parseInline(heading[2] ?? '')
      })
      index += 1
      continue
    }

    if (isTableRow(line) && isTableRule(at(index + 1))) {
      const header = cells(line).map(parseInline)
      const rows: Inline[][][] = []
      index += 2
      while (index < lines.length && isTableRow(at(index))) {
        rows.push(cells(at(index)).map(parseInline))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (isListItem(line)) {
      const items: string[] = []
      while (index < lines.length && at(index).trim() !== '') {
        const current = at(index)
        // Строка без маркера продолжает предыдущий пункт.
        const last = items.pop()
        if (isListItem(current)) {
          if (last !== undefined) items.push(last)
          items.push(current.replace(/^\s*[-*]\s+/, ''))
        } else if (last !== undefined) items.push(`${last} ${current.trim()}`)
        index += 1
      }
      blocks.push({ kind: 'list', items: items.map(parseInline) })
      continue
    }

    // Абзац: строки до пустой строки или до начала другого блока.
    const paragraph: string[] = [trimmed]
    index += 1
    while (index < lines.length) {
      const current = at(index)
      const next = current.trim()
      if (
        next === '' ||
        next.startsWith('#') ||
        next.startsWith('```') ||
        next.startsWith('<!--') ||
        isListItem(current) ||
        (isTableRow(current) && isTableRule(at(index + 1)))
      )
        break
      paragraph.push(next)
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: parseInline(paragraph.join(' ')) })
  }
  return blocks
}
