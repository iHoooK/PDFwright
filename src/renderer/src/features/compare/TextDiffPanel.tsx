import type { LineChange, WordPart } from '@shared/compare'
import { isWord, splitWords } from '@shared/compare'
import { t } from '@renderer/i18n'
import type { PageResult } from './compare-page'
import s from './compare.module.css'

/** Сколько слов удалено и добавлено в изменениях страницы (знаки препинания не в счёт). */
function countWords(changes: readonly LineChange[]): { removed: number; added: number } {
  let removed = 0
  let added = 0
  for (const change of changes) {
    if (change.kind === 'removed') removed += splitWords(change.text).length
    else if (change.kind === 'added') added += splitWords(change.text).length
    else if (change.kind === 'changed') {
      for (const word of change.words) {
        if (!isWord(word.value)) continue
        if (word.kind === 'removed') removed += 1
        else if (word.kind === 'added') added += 1
      }
    }
  }
  return { removed, added }
}

/** Строка по словам: пробел ставится там, где он был в строке (знак у слова — без него). */
function Words({ words }: { words: readonly WordPart[] }): React.JSX.Element {
  return (
    <>
      {words.map((word, index) => {
        const space = index > 0 && word.space ? ' ' : ''
        if (word.kind === 'same') return <span key={index}>{space + word.value}</span>
        return (
          <span key={index}>
            {space}
            {word.kind === 'removed' ? (
              <del data-diff="removed">{word.value}</del>
            ) : (
              <ins data-diff="added">{word.value}</ins>
            )}
          </span>
        )
      })}
    </>
  )
}

/** Панель справа: добавленные и удалённые строки и слова выбранной страницы. */
export function TextDiffPanel({
  page,
  result
}: {
  page: number
  result: PageResult | undefined
}): React.JSX.Element {
  const changes = result?.text.filter((change) => change.kind !== 'same') ?? []
  const words = countWords(changes)

  return (
    <aside className={s.text} aria-label={t.compare.textTitle(page)} data-compare-text={page}>
      <h3>{t.compare.textTitle(page)}</h3>
      {!result ? (
        <p className={s.muted}>{t.compare.textPending}</p>
      ) : changes.length === 0 ? (
        <p className={s.muted}>
          {result.status === 'same' ? t.compare.textSame : t.compare.textOnlyLayout}
        </p>
      ) : (
        <>
          <p className={s.muted}>{t.compare.words(words.removed, words.added)}</p>
          <ul className={s.changes}>
            {changes.map((change, index) => (
              <li
                key={index}
                className={s[change.kind]}
                title={
                  change.kind === 'removed'
                    ? t.compare.removedLine
                    : change.kind === 'added'
                      ? t.compare.addedLine
                      : t.compare.changedLine
                }
              >
                {change.kind === 'changed' ? (
                  <Words words={change.words} />
                ) : change.kind === 'removed' ? (
                  <del data-diff="removed">{change.text}</del>
                ) : (
                  <ins data-diff="added">{change.text}</ins>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
