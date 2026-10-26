import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import s from './context-menu.module.css'

export interface ContextMenuItem {
  label: string
  icon: ReactNode
  onSelect: () => void
}

interface Props {
  /** Точка вызова в координатах окна. */
  x: number
  y: number
  label: string
  items: readonly ContextMenuItem[]
  onClose: () => void
}

/**
 * Контекстное меню у курсора. Не выходит за край окна; стрелки переходят
 * между пунктами; Esc, Tab, щелчок мимо и потеря фокуса окна закрывают его,
 * и фокус возвращается туда, где был.
 */
export function ContextMenu({ x, y, label, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))
    })
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      const focused = document.activeElement
      if (focused === null || focused === document.body || menu.contains(focused)) {
        previous?.focus()
      }
    }
  }, [x, y])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    )
    const index = buttons.findIndex((button) => button === document.activeElement)
    const move = (delta: number): void => {
      buttons[(index + delta + buttons.length) % buttons.length]?.focus()
    }
    if (event.key === 'Escape' || event.key === 'Tab') onClose()
    else if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Home') buttons[0]?.focus()
    else if (event.key === 'End') buttons[buttons.length - 1]?.focus()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={s.menu}
      style={position}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault()
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={s.item}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
