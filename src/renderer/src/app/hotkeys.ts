import { useEffect } from 'react'
import { TOOL_KEYS, TOOLS, useStore, type Tool } from './store'

/**
 * Горячие клавиши интерфейса (docs/DESIGN.md, план 1.4). Сочетания с Ctrl
 * дублируют меню приложения (там они работают и при скрытой строке меню),
 * одиночные буквы переключают инструмент, как в графических редакторах.
 */
export const HOTKEYS: readonly { keys: string; action: string }[] = [
  { keys: 'Ctrl + O', action: 'Открыть файл' },
  { keys: 'Ctrl + S', action: 'Сохранить' },
  { keys: 'Ctrl + Shift + S', action: 'Сохранить как' },
  { keys: 'Ctrl + P', action: 'Печать' },
  { keys: 'Ctrl + W', action: 'Закрыть документ' },
  { keys: 'Ctrl + Z / Ctrl + Y', action: 'Отменить / повторить операцию или правку разметки' },
  { keys: 'Delete, Esc', action: 'Удалить выбранный объект разметки или документа, снять выбор' },
  { keys: 'Ctrl + G', action: 'Режим «Страницы»' },
  {
    keys: 'Delete, Ctrl + A, Esc',
    action: 'В режиме «Страницы»: удалить, выбрать все, снять выбор'
  },
  { keys: 'Ctrl + F', action: 'Поиск в документе' },
  { keys: 'Ctrl + «+» / «−» / 0', action: 'Масштаб больше / меньше / 100%' },
  { keys: 'Ctrl + 1 / 2', action: 'По ширине / страница целиком' },
  { keys: 'Ctrl + R', action: 'Повернуть вид' },
  { keys: 'Ctrl + колесо', action: 'Масштаб' },
  { keys: 'Ctrl + B', action: 'Боковая панель' },
  { keys: 'Ctrl + Shift + B', action: 'Панель свойств' },
  { keys: 'Ctrl + ,', action: 'Параметры' },
  { keys: 'PageUp / PageDown', action: 'Предыдущая / следующая страница' },
  {
    keys: 'V, E, H, M, P, U, T, S',
    action: 'Инструменты: выделение, правка, рука, маркер, перо, фигуры, текст, подпись'
  }
]

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

export function useHotkeys(): void {
  const { state, actions } = useStore()
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
      if (pagesMode && key === 'Delete') {
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
