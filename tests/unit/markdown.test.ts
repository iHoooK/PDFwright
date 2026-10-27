import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generatedTable,
  parseInline,
  parseMarkdown,
  type Block
} from '@renderer/features/settings/parse-markdown'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string): Promise<string> => readFile(join(ROOT, path), 'utf8')

/** Весь видимый текст блока: так проверяется, что разметка Markdown не просочилась. */
function plain(block: Block | undefined): string {
  if (!block) return ''
  const inline = (parts: { text: string }[]): string => parts.map((p) => p.text).join('')
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return inline(block.text)
    case 'list':
      return block.items.map(inline).join('\n')
    case 'code':
      return block.text
    case 'table':
      return [block.header, ...block.rows].map((row) => row.map(inline).join(' ')).join('\n')
  }
}

describe('parseMarkdown', () => {
  it('разбирает заголовки, абзацы, списки, таблицы и код', () => {
    const blocks = parseMarkdown(
      [
        '# Заголовок',
        '',
        'Первая строка абзаца',
        'и вторая.',
        '',
        '- пункт `код`',
        '  продолжение',
        '- **жирный** и [ссылка](https://github.com/iHoooK/PDFwright)',
        '',
        '| A | B |',
        '| --- | :-: |',
        '| 1 | 2 \\| 3 |',
        '',
        '<!-- deps:start -->',
        '```text',
        '%APPDATA%\\PDFwright',
        '```'
      ].join('\n')
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'table', 'code'])
    expect(blocks[0]).toEqual({
      kind: 'heading',
      level: 1,
      text: [{ kind: 'text', text: 'Заголовок' }]
    })
    expect(plain(blocks[1])).toBe('Первая строка абзаца и вторая.')
    const list = blocks[2]
    expect(list?.kind === 'list' ? list.items : null).toEqual([
      [
        { kind: 'text', text: 'пункт ' },
        { kind: 'code', text: 'код' },
        { kind: 'text', text: ' продолжение' }
      ],
      [
        { kind: 'strong', text: 'жирный' },
        { kind: 'text', text: ' и ' },
        { kind: 'link', text: 'ссылка', url: 'https://github.com/iHoooK/PDFwright' }
      ]
    ])
    const table = blocks[3]
    expect(table?.kind === 'table' ? table.rows.length : 0).toBe(1)
    expect(plain(table)).toBe('A B\n1 2 | 3')
    expect(plain(blocks[4])).toBe('%APPDATA%\\PDFwright')
  })

  it('не зацикливается на строке, похожей на начало блока', () => {
    expect(parseMarkdown('#хэштег без пробела')).toEqual([
      { kind: 'paragraph', text: [{ kind: 'text', text: '#хэштег без пробела' }] }
    ])
    expect(parseInline('просто текст')).toEqual([{ kind: 'text', text: 'просто текст' }])
  })

  it('перечень компонентов и приватность отрисовываются без сырой разметки', async () => {
    for (const path of [
      'THIRD_PARTY_NOTICES.md',
      'PRIVACY.md',
      'docs/en/THIRD_PARTY_NOTICES.md',
      'docs/en/PRIVACY.md'
    ]) {
      const blocks = parseMarkdown(await read(path))
      const text = blocks.map(plain).join('\n')
      expect(text, path).not.toMatch(/\| ?-{3}|^#|`|<!--/m)
      expect(blocks[0]?.kind, path).toBe('heading')
    }
    const notices = parseMarkdown(await read('THIRD_PARTY_NOTICES.md'))
    expect(notices.filter((b) => b.kind === 'table').length).toBeGreaterThanOrEqual(2)
  })

  it('английский перечень берёт таблицу пакетов из русского файла с английскими заголовками', async () => {
    const table = generatedTable(await read('THIRD_PARTY_NOTICES.md'), [
      'Package',
      'Version',
      'License'
    ])
    const [block] = parseMarkdown(table)
    expect(block?.kind).toBe('table')
    if (block?.kind !== 'table') return
    expect(block.header.map((cell) => cell.map((p) => p.text).join(''))).toEqual([
      'Package',
      'Version',
      'License'
    ])
    expect(block.rows.some((row) => row[0]?.[0]?.text === 'pdf-lib')).toBe(true)
    expect(generatedTable('без маркеров')).toBe('')
  })
})
