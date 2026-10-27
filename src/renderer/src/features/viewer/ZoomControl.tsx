import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown, IconZoomIn, IconZoomOut } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { IconButton } from '@renderer/components/controls'
import { ContextMenu } from '@renderer/app/ContextMenu'
import { useStore } from '@renderer/app/store'
import { parseZoomInput, ZOOM_PRESETS } from './zoom'
import s from './viewer.module.css'

/**
 * Масштаб на панели команд: «−», поле со значением (можно ввести своё и
 * нажать Enter), меню режимов и готовых значений, «+».
 */
export function ZoomControl({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { state, actions } = useStore()
  const [draft, setDraft] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => {
    setMenu(null)
  }, [])
  const label = `${state.resolvedZoom}%`

  const apply = (): void => {
    if (draft === null) return
    const percent = parseZoomInput(draft)
    setDraft(null)
    if (percent !== null) actions.zoomTo(percent)
  }

  return (
    <div className={s.zoom}>
      <IconButton
        label={t.cmd.zoomOut}
        onClick={() => {
          actions.zoomBy(-1)
        }}
        disabled={disabled}
      >
        <IconZoomOut />
      </IconButton>
      <div ref={fieldRef} className={s.zoomField} data-disabled={disabled || undefined}>
        <input
          className={s.zoomValue}
          value={draft ?? label}
          aria-label={t.cmd.zoomValue}
          title={t.cmd.zoomValueHint}
          inputMode="numeric"
          disabled={disabled}
          onFocus={(event) => {
            setDraft(label)
            event.currentTarget.select()
          }}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onBlur={() => {
            setDraft(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
        />
        <button
          type="button"
          className={s.zoomMenuButton}
          aria-label={t.cmd.zoomMenu}
          title={t.cmd.zoomMenu}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          disabled={disabled}
          onClick={() => {
            const rect = fieldRef.current?.getBoundingClientRect()
            if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
        >
          <IconChevronDown />
        </button>
      </div>
      <IconButton
        label={t.cmd.zoomIn}
        onClick={() => {
          actions.zoomBy(1)
        }}
        disabled={disabled}
      >
        <IconZoomIn />
      </IconButton>
      {/* Меню — вне панели команд: её стили прячут подписи кнопок в узком окне. */}
      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            label={t.cmd.zoomMenu}
            onClose={closeMenu}
            items={[
              {
                label: t.cmd.fitWidth,
                icon: null,
                onSelect: () => {
                  actions.setZoomMode('fit-width')
                }
              },
              {
                label: t.cmd.fitPage,
                icon: null,
                onSelect: () => {
                  actions.setZoomMode('fit-page')
                }
              },
              ...ZOOM_PRESETS.map((percent) => ({
                label: `${percent}%`,
                icon: null,
                onSelect: () => {
                  actions.zoomTo(percent)
                }
              }))
            ]}
          />,
          document.body
        )}
    </div>
  )
}
