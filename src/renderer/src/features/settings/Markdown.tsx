import { Fragment, useMemo } from 'react'
import { useStore } from '@renderer/app/store'
import { parseMarkdown, type Inline } from './parse-markdown'
import s from './settings.module.css'

/** Отрисованный Markdown окна «Лицензии и приватность» (см. parse-markdown.ts). */
export function Markdown({ source }: { source: string }): React.JSX.Element {
  const { actions } = useStore()
  const blocks = useMemo(() => parseMarkdown(source), [source])

  const inline = (parts: readonly Inline[]): React.JSX.Element[] =>
    parts.map((part, index) => {
      switch (part.kind) {
        case 'code':
          return <code key={index}>{part.text}</code>
        case 'strong':
          return <strong key={index}>{part.text}</strong>
        case 'link':
          return (
            <a
              key={index}
              href={part.url}
              title={part.url}
              onClick={(event) => {
                // Ссылки открываются в браузере, и только разрешённые адреса (проверяет main).
                event.preventDefault()
                actions.openExternal(part.url)
              }}
            >
              {part.text}
            </a>
          )
        case 'text':
          return <Fragment key={index}>{part.text}</Fragment>
      }
    })

  return (
    <div className={s.markdown}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return block.level <= 1 ? (
              <h2 key={index}>{inline(block.text)}</h2>
            ) : (
              <h3 key={index}>{inline(block.text)}</h3>
            )
          case 'paragraph':
            return <p key={index}>{inline(block.text)}</p>
          case 'list':
            return (
              <ul key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>{inline(item)}</li>
                ))}
              </ul>
            )
          case 'code':
            return <pre key={index}>{block.text}</pre>
          case 'table':
            return (
              <div key={index} className={s.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, i) => (
                        <th key={i}>{inline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, i) => (
                          <td key={i}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
