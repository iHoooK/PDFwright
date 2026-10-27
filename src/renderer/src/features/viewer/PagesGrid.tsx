import { useState, type DragEvent, type MouseEvent } from 'react'
import { useStore, type DocTab, type SelectMode } from '@renderer/app/store'
import { cx } from '@renderer/components/cx'
import type { PdfDocument } from '@renderer/pdf-engine/engine'
import { useMarkupByPage } from '@renderer/features/markup/by-page'
import { PageThumbnail } from './PageThumbnail'
import s from './viewer.module.css'

function modeOf(event: MouseEvent): SelectMode {
  if (event.shiftKey) return 'range'
  if (event.ctrlKey || event.metaKey) return 'toggle'
  return 'single'
}

/**
 * Сетка страниц режима «Страницы»: выбор кликами с Ctrl/Shift и перестановка
 * перетаскиванием. Позиция вставки считается по половине плитки, над которой
 * находится курсор, и подсвечивается полосой слева или справа от неё.
 */
export function PagesGrid({ tab, doc }: { tab: DocTab; doc: PdfDocument }): React.JSX.Element {
  const { state, actions } = useStore()
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const markup = useMarkupByPage(tab.markup)

  const onDragStart = (page: number) => (event: DragEvent<HTMLDivElement>) => {
    if (!state.selectedPages.has(page)) actions.selectPage(page, 'single')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(page))
    setDragging(true)
  }

  const onDragOver = (page: number) => (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const before = event.clientX < rect.left + rect.width / 2
    setDropTarget(before ? page : page + 1)
  }

  const finish = (): void => {
    setDragging(false)
    setDropTarget(null)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (dropTarget !== null) actions.movePages(dropTarget)
    finish()
  }

  return (
    <div
      className={s.pagesGrid}
      onDragOver={(event) => {
        if (dragging) event.preventDefault()
      }}
      onDrop={onDrop}
      onDragEnd={finish}
      aria-busy={tab.busy}
    >
      {Array.from({ length: tab.pages }, (_, i) => {
        const page = i + 1
        return (
          <div
            key={page}
            className={cx(
              s.gridCell,
              dropTarget === page && s.dropBefore,
              dropTarget === page + 1 && i === tab.pages - 1 && s.dropAfter
            )}
            draggable={!tab.busy}
            onDragStart={onDragStart(page)}
            onDragOver={onDragOver(page)}
          >
            <PageThumbnail
              doc={doc}
              pageNumber={page}
              // Поворот вида здесь не действует: миниатюры показывают страницы так,
              // как они записаны в файле, а повернуть их можно кнопками режима.
              rotation={0}
              selected={state.selectedPages.has(page)}
              markup={markup.get(page)}
              onClick={(event) => {
                actions.selectPage(page, modeOf(event))
              }}
              onDoubleClick={() => {
                actions.togglePagesMode(false)
                actions.setPage(page)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
