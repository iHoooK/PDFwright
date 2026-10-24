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
  { keys: 'Ctrl + F', action: 'Поиск в документе' },
  { keys: 'Ctrl + «+» / «−» / 0', action: 'Масштаб больше / меньше / 100%' },
  { keys: 'Ctrl + B', action: 'Боковая панель' },
  { keys: 'Ctrl + Shift + B', action: 'Панель свойств' },
  { keys: 'Ctrl + ,', action: 'Параметры' },
  { keys: 'PageUp / PageDown', action: 'Предыдущая / следующая страница' },
  {
    keys: 'V, H, M, P, U, T, S',
    action: 'Инструменты: выделение, рука, маркер, перо, фигуры, текст, подпись'
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
          actions.closeDoc()
        }
        return
      }
      if (isTypingTarget(event.target) || !inViewer || event.altKey) return
      if (key === 'PageDown') {
        event.preventDefault()
        actions.setPage(Math.min(state.page + 1, pageCount(state.docs.length)))
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
  }, [actions, inViewer, state.page, state.docs.length])
}

function pageCount(docs: number): number {
  return docs > 0 ? 14 : 1
}
