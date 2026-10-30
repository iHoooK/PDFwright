import { isMac } from './platform'

/** Элемент, где клавиши правят текст: поля ввода, списки и contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

/**
 * Mac: ⌘Z и ⇧⌘Z в поле ввода renderer пропускает к меню (Chromium на Mac сам
 * их не обрабатывает), и пункт «Отменить» или «Повторить» шлёт команду сюда.
 * Тогда отменяется правка текста в поле, а не операция документа. Возвращает
 * true, если команда выполнена в поле; в Windows — всегда false.
 */
export function editFocusedField(command: 'undo' | 'redo'): boolean {
  if (!isMac || !isTypingTarget(document.activeElement)) return false
  // execCommand устарел, но выполняет ту же команду редактора, что и Ctrl+Z в Windows.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- замены для undo/redo нет
  document.execCommand(command)
  return true
}
