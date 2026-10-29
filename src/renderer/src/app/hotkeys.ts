import { useEffect, useLayoutEffect, useRef } from 'react'
import { shiftInside, unionRects, viewDeltaToPage, type Point } from '@shared/markup/geometry'
import { isMovable, moveObject, visualBounds } from '@shared/markup/model'
import { t } from '@renderer/i18n'
import { isMac, isPageDeleteKey } from './platform'
import { activeDoc, TOOL_KEYS, TOOLS, useStore, type State, type Tool } from './store'
import { isTypingTarget } from './typing'

/**
 * Горячие клавиши интерфейса (docs/DESIGN.md, план 1.4). Сочетания с Ctrl
 * (на Mac — с ⌘) дублируют меню приложения (там они работают и при скрытой
 * строке меню), одиночные буквы переключают инструмент, как в графических
 * редакторах. Renderer получает клавишу раньше меню: сочетание, для которого
 * вызван preventDefault, меню уже не выполняет.
 */
export const HOTKEYS: readonly { keys: string; action: string }[] = t.shortcuts

/** Стрелки двигают выбранный объект на экране: шаг 1 пт, с Shift — 10 пт. */
const ARROWS: Readonly<Record<string, readonly [number, number] | undefined>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}
const NUDGE = 1
const NUDGE_LARGE = 10

/**
 * Сдвиг выбранного «Выделением» в пространстве страницы для сдвига на экране
 * (dx, dy пт) или null, если двигать нечего. Объекты разметки не уходят за
 * край страницы — как при перетаскивании.
 */
function nudgeDelta(state: State, dx: number, dy: number): Point | null {
  const tab = activeDoc(state)
  const doc = tab?.doc
  const selection = state.selection
  if (!tab || !doc || tab.busy || !selection) return null
  const group = state.selectionGroup.length > 0 ? state.selectionGroup : [selection]
  const ids = new Set(group.filter((x) => x.source === 'markup').map((x) => x.id))
  const members = tab.markup.filter((o) => ids.has(o.id) && isMovable(o))
  const annotation = group.find((x) => x.source === 'annotation')
  const page = members[0]?.page ?? (annotation?.source === 'annotation' ? annotation.page : null)
  if (page === null) return null
  const geometry = doc.geometryOf(page)
  const delta = viewDeltaToPage(geometry.rotate + state.rotation, dx, dy)
  if (members.length === 0) return delta
  const moved = members.map((o) => visualBounds(moveObject(o, delta.x, delta.y)))
  const fix = shiftInside(unionRects(moved), geometry.box)
  return { x: delta.x + fix.x, y: delta.y + fix.y }
}

export function useHotkeys(): void {
  const { state, actions } = useStore()
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  const inViewer = state.screen === 'viewer'
  const pagesMode = state.pagesMode
  const selection = state.selection

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = event.key
      const ctrl = event.ctrlKey || event.metaKey
      if (ctrl && !event.altKey) {
        const lower = key.toLowerCase()
        if (lower === 'o') {
          event.preventDefault()
          void actions.openDialog()
        } else if (lower === 'f' && inViewer) {
          event.preventDefault()
          actions.focusSearch()
        } else if ((key === '=' || key === '+') && inViewer) {
          event.preventDefault()
          actions.zoomBy(1)
        } else if (key === '-' && inViewer) {
          event.preventDefault()
          actions.zoomBy(-1)
        } else if (key === '0' && inViewer) {
          event.preventDefault()
          actions.zoomTo(100)
        } else if (lower === 'b' && inViewer) {
          event.preventDefault()
          if (event.shiftKey) actions.toggleProps()
          else actions.toggleSidebar()
        } else if (key === ',') {
          event.preventDefault()
          actions.openSettings()
        } else if (lower === 'w') {
          event.preventDefault()
          actions.requestCloseDoc()
        } else if (lower === 's' && inViewer) {
          event.preventDefault()
          if (event.shiftKey) void actions.saveAs()
          else void actions.save()
        } else if (lower === 'z' && inViewer && !isTypingTarget(event.target)) {
          event.preventDefault()
          if (event.shiftKey) actions.redo()
          else actions.undo()
        } else if (lower === 'y' && inViewer && !isTypingTarget(event.target)) {
          event.preventDefault()
          actions.redo()
        } else if (isMac && lower === 'z' && !isTypingTarget(event.target)) {
          // Вне документа ⌘Z ничего не делает, как Ctrl+Z в Windows: иначе его
          // выполнил бы пункт «Отменить» меню Mac и отменил операцию незаметно.
          event.preventDefault()
        } else if (lower === 'g' && inViewer) {
          event.preventDefault()
          actions.togglePagesMode()
        } else if (lower === 'a' && inViewer && pagesMode && !isTypingTarget(event.target)) {
          event.preventDefault()
          actions.selectAll()
        } else if (lower === 'p' && inViewer) {
          event.preventDefault()
          actions.print()
        } else if (lower === 'r' && inViewer) {
          event.preventDefault()
          actions.rotate()
        } else if (key === '1' && inViewer) {
          event.preventDefault()
          actions.setZoomMode('fit-width')
        } else if (key === '2' && inViewer) {
          event.preventDefault()
          actions.setZoomMode('fit-page')
        }
        return
      }
      if (isTypingTarget(event.target) || !inViewer || event.altKey) return
      if (pagesMode && isPageDeleteKey(key)) {
        event.preventDefault()
        actions.deleteSelected()
        return
      }
      if (pagesMode && key === 'Escape') {
        actions.selectNone()
        return
      }
      if (!pagesMode && selection !== null && (key === 'Delete' || key === 'Backspace')) {
        event.preventDefault()
        actions.removeSelected()
        return
      }
      if (!pagesMode && selection !== null && key === 'Escape') {
        actions.select(null)
        return
      }
      const arrow = ARROWS[key]
      if (!pagesMode && arrow && selection !== null && selection.source !== 'content') {
        const step = event.shiftKey ? NUDGE_LARGE : NUDGE
        const delta = nudgeDelta(stateRef.current, arrow[0] * step, arrow[1] * step)
        if (delta) {
          event.preventDefault()
          actions.moveSelected(delta.x, delta.y)
        }
        return
      }
      if (key === 'PageDown') {
        event.preventDefault()
        actions.setPage(state.page + 1)
      } else if (key === 'PageUp') {
        event.preventDefault()
        actions.setPage(Math.max(1, state.page - 1))
      } else {
        const tool = TOOLS.find((name: Tool) => TOOL_KEYS[name].toLowerCase() === key.toLowerCase())
        if (tool) actions.setTool(tool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [actions, inViewer, pagesMode, selection, state.page])
}
