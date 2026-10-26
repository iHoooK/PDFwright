import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageAnnotation } from '@shared/pdf-content/annotations'
import { IconDelete } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { Button, Range, Swatches } from '@renderer/components/controls'
import { activeDoc, INK_COLORS, MARKER_COLORS, useStore } from '@renderer/app/store'
import v from '@renderer/features/viewer/viewer.module.css'
import s from '@renderer/features/markup/markup.module.css'
import { hexToRgb, rgbToHex, usePageAnnotations } from './page-annotations'

/** Пометки текста красятся цветами маркера, остальное — цветами пера. */
const MARKER_KINDS = new Set(['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Text'])

/**
 * Свойства выбранной аннотации документа: текст (FreeText, заметка),
 * цвет, непрозрачность, удаление. Каждая правка сразу пишется в байты
 * документа шагом истории, поэтому текст и ползунок применяются по
 * окончании ввода (потеря фокуса, отпускание ползунка), а не на каждый символ.
 */
function AnnotationFields({
  page,
  annotation
}: {
  page: number
  annotation: PageAnnotation
}): React.JSX.Element {
  const { state, actions } = useStore()
  const [text, setText] = useState(annotation.contents)
  const [opacity, setOpacity] = useState(Math.round(annotation.opacity * 100))
  const busy = activeDoc(state)?.busy ?? false
  const { can } = annotation
  // Текст, уже отправленный в документ: щелчок мимо снимает выбор раньше, чем поле теряет
  // фокус, поэтому несохранённый текст дописывается и при закрытии карточки.
  const sent = useRef(annotation.contents)
  const draft = useRef(text)
  const commitText = (): void => {
    if (draft.current === sent.current) return
    sent.current = draft.current
    actions.editAnnotation(page, annotation.index, { contents: draft.current })
  }
  const commitRef = useRef(commitText)
  useLayoutEffect(() => {
    draft.current = text
    commitRef.current = commitText
  })
  useEffect(
    () => () => {
      commitRef.current()
    },
    []
  )
  const commitOpacity = (): void => {
    if (opacity !== Math.round(annotation.opacity * 100))
      actions.editAnnotation(page, annotation.index, { opacity: opacity / 100 })
  }
  return (
    <div className={v.pcard} data-annotation-props={annotation.subtype}>
      <p className={s.hint}>{t.annotations.fromDocument}</p>
      {can.text && (
        <div className={v.field}>
          <label htmlFor="annotation-text">
            {annotation.subtype === 'Text' ? t.annotations.noteText : t.annotations.text}
          </label>
          <textarea
            id="annotation-text"
            className={s.textField}
            value={text}
            disabled={busy}
            rows={Math.min(6, Math.max(2, text.split('\n').length))}
            onChange={(event) => {
              setText(event.target.value)
            }}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.ctrlKey) {
                event.preventDefault()
                commitText()
              }
            }}
          />
        </div>
      )}
      {can.color && (
        <div className={v.field}>
          <span className={v.fieldLabel}>{t.props.color}</span>
          <Swatches
            colors={MARKER_KINDS.has(annotation.subtype) ? MARKER_COLORS : INK_COLORS}
            value={rgbToHex(annotation.color)}
            onChange={(color) => {
              actions.editAnnotation(page, annotation.index, { color: hexToRgb(color) })
            }}
            label={t.props.color}
          />
        </div>
      )}
      {can.opacity && (
        <div className={v.field}>
          <label htmlFor="annotation-opacity">
            {t.props.opacity} · {opacity}%
          </label>
          <Range
            id="annotation-opacity"
            min={10}
            max={100}
            value={opacity}
            disabled={busy}
            onChange={(event) => {
              setOpacity(Number(event.target.value))
            }}
            onPointerUp={commitOpacity}
            onKeyUp={commitOpacity}
            onBlur={commitOpacity}
          />
        </div>
      )}
      <div>
        <Button
          icon={<IconDelete />}
          disabled={busy}
          onClick={() => {
            actions.removeSelected()
          }}
        >
          {t.props.remove}
        </Button>
      </div>
    </div>
  )
}

/** Карточка выбранной аннотации: объект берётся из списка страницы для текущих байтов. */
export function AnnotationCard({
  page,
  index
}: {
  page: number
  index: number
}): React.JSX.Element | null {
  const { state } = useStore()
  const tab = activeDoc(state)
  const list = usePageAnnotations(tab?.doc ?? null, tab?.bytes ?? null, page, true)
  const annotation = list?.find((a) => a.index === index)
  if (!annotation) return null
  // Новые байты — новые значения полей: ключ сбрасывает черновики текста и ползунка.
  const key = `${page}:${index}:${annotation.contents}:${annotation.opacity}:${String(annotation.color)}`
  return <AnnotationFields key={key} page={page} annotation={annotation} />
}

/** Несколько выбранных объектов: сколько их и удаление всех разом. */
export function GroupCard({ count }: { count: number }): React.JSX.Element {
  const { state, actions } = useStore()
  const busy = activeDoc(state)?.busy ?? false
  return (
    <div className={v.pcard} data-selection-group={count}>
      <p className={s.hint}>{t.annotations.groupHint}</p>
      <div>
        <Button
          icon={<IconDelete />}
          disabled={busy}
          onClick={() => {
            actions.removeSelected()
          }}
        >
          {t.annotations.removeGroup}
        </Button>
      </div>
    </div>
  )
}
