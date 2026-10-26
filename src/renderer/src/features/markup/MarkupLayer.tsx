import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  apply,
  arrowHead,
  boxContentSize,
  invert,
  normalizeTurn,
  rectFromPoints,
  simplifyPath,
  textLineStroke,
  transformRect,
  viewMatrix,
  viewSize,
  type Matrix,
  type PageGeometry,
  type Point,
  type Rect
} from '@shared/markup/geometry'
import {
  geometryBounds,
  isBoxObject,
  isMovable,
  moveObject,
  newMarkupId,
  visualBounds,
  type ImageObject,
  type LineObject,
  type MarkupObject,
  type ShapeKind,
  type TextObject
} from '@shared/markup/model'
import { FRAME_HANDLES, handlePoint, resizeInView, type FrameHandle } from '@shared/markup/resize'
import {
  fitTextBox,
  layoutTextObject,
  LINE_HEIGHT,
  MARKUP_FONT_FAMILY,
  TEXT_PADDING
} from '@shared/markup/text-layout'
import type { Actions, Tool, ToolStyle } from '@renderer/app/store'
import type { Rotation } from '@renderer/pdf-engine/engine'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import { measureText } from './font'
import { hitSources, markupSource, type SelectionSource } from './selection'
import s from './markup.module.css'

interface Props {
  geometry: PageGeometry
  pageNumber: number
  /** CSS-пикселей на пункт. */
  scale: number
  /** Поворот вида (без собственного /Rotate страницы). */
  rotation: Rotation
  objects: readonly MarkupObject[]
  /** id выбранного объекта, если он на этой странице. */
  selectedId: string | null
  tool: Tool
  style: ToolStyle
  shapeKind: ShapeKind
  actions: Actions
}

/** Допуск попадания по тонким линиям, CSS-пиксели. */
const HIT_TOLERANCE = 6
/** Меньше этого жест считается щелчком, а не протягиванием, пт. */
const CLICK_DISTANCE = 3

interface Editing {
  object: TextObject
  isNew: boolean
}

interface BoxPlacement {
  frame: Rect
  width: number
  height: number
  turn: number
}

function boxPlacement(
  o: TextObject | ImageObject,
  matrix: Matrix,
  geometry: PageGeometry,
  rotation: Rotation,
  scale: number
): BoxPlacement {
  const content = boxContentSize(o.rect, o.rotate)
  return {
    frame: transformRect(matrix, o.rect),
    width: content.width * scale,
    height: content.height * scale,
    turn: normalizeTurn(geometry.rotate + rotation - o.rotate)
  }
}

/** Текст нового содержания: рамка подгоняется от начала текста (см. fitTextBox). */
function withText(o: TextObject, text: string): TextObject {
  return fitTextBox({ ...o, text }, measureText)
}

/** Векторные объекты рисуются в координатах страницы внутри группы с матрицей вида. */
function VectorObject({ o }: { o: MarkupObject }): React.JSX.Element | null {
  const stroke = {
    stroke: o.color,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  } as const
  switch (o.kind) {
    case 'highlight':
      return null
    case 'underline':
    case 'strikeout': {
      const kind = o.kind
      return (
        <g opacity={o.opacity}>
          {o.rects.map((r, i) => {
            const line = textLineStroke(r, kind)
            return (
              <line
                key={i}
                x1={line.from.x}
                y1={line.from.y}
                x2={line.to.x}
                y2={line.to.y}
                stroke={o.color}
                strokeWidth={line.width}
              />
            )
          })}
        </g>
      )
    }
    case 'ink':
      return (
        <g opacity={o.opacity} {...stroke} strokeWidth={o.width}>
          {o.paths.map((path, i) => (
            <polyline
              key={i}
              points={(path.length === 1 ? [...path, ...path] : path)
                .map((p) => `${p.x},${p.y}`)
                .join(' ')}
            />
          ))}
        </g>
      )
    case 'rect':
      return (
        <rect {...o.rect} opacity={o.opacity} stroke={o.color} fill="none" strokeWidth={o.width} />
      )
    case 'ellipse':
      return (
        <ellipse
          cx={o.rect.x + o.rect.width / 2}
          cy={o.rect.y + o.rect.height / 2}
          rx={o.rect.width / 2}
          ry={o.rect.height / 2}
          opacity={o.opacity}
          stroke={o.color}
          fill="none"
          strokeWidth={o.width}
        />
      )
    case 'line':
    case 'arrow': {
      const head = o.kind === 'arrow' ? arrowHead(o.from, o.to, o.width) : null
      return (
        <g opacity={o.opacity} {...stroke} strokeWidth={o.width}>
          <line x1={o.from.x} y1={o.from.y} x2={o.to.x} y2={o.to.y} />
          {head && (
            <polyline
              points={`${head[0].x},${head[0].y} ${o.to.x},${o.to.y} ${head[1].x},${head[1].y}`}
            />
          )}
        </g>
      )
    }
    case 'text':
    case 'image':
      return null
  }
}

function BoxObject({
  o,
  placement
}: {
  o: TextObject | ImageObject
  placement: BoxPlacement
}): React.JSX.Element {
  const { frame, width, height, turn } = placement
  const content = boxContentSize(o.rect, o.rotate)
  return (
    <div
      className={s.box}
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        opacity: o.opacity
      }}
      data-markup-kind={o.kind}
    >
      <div
        className={s.boxInner}
        style={{ width, height, transform: `translate(-50%, -50%) rotate(${turn}deg)` }}
      >
        {o.kind === 'image' ? (
          <img src={o.src} alt="" draggable={false} className={s.image} />
        ) : (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${content.width} ${content.height}`}
            preserveAspectRatio="none"
            className={s.textSvg}
          >
            {layoutTextObject(o, measureText).lines.map((line, i) => (
              <text
                key={i}
                x={line.x}
                y={line.baseline}
                fontSize={o.fontSize}
                fontFamily={`'${MARKUP_FONT_FAMILY}'`}
                fill={o.color}
              >
                {line.text}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}

function TextEditor({
  editing,
  placement,
  scale,
  onChange,
  onDone
}: {
  editing: Editing
  placement: BoxPlacement
  scale: number
  onChange: (text: string) => void
  onDone: () => void
}): React.JSX.Element {
  const { object } = editing
  const { frame, width, height, turn } = placement
  const wraps = object.fixedWidth === true
  // Рамка редактора — 1 px, поэтому поле на пиксель меньше: текст стоит там же, где на слое.
  const padding = Math.max(0, object.fontSize * TEXT_PADDING * scale - 1)
  return (
    <div
      className={s.box}
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      data-markup-editor=""
    >
      <div
        className={s.boxInner}
        style={{ width, height, transform: `translate(-50%, -50%) rotate(${turn}deg)` }}
      >
        <textarea
          className={cx(s.editor, wraps && s.editorWrap)}
          aria-label={t.props.text}
          placeholder={t.markup.textPlaceholder}
          value={object.text}
          autoFocus
          // В рамке заданной ширины строки переносятся так же, как в layoutText.
          wrap={wraps ? 'soft' : 'off'}
          spellCheck={false}
          style={{
            fontFamily: `'${MARKUP_FONT_FAMILY}'`,
            fontSize: object.fontSize * scale,
            lineHeight: LINE_HEIGHT,
            padding,
            color: object.color,
            width: wraps ? width : Math.max(width, object.fontSize * scale * 2),
            height
          }}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onBlur={onDone}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && event.ctrlKey)) {
              event.preventDefault()
              event.stopPropagation()
              onDone()
            }
          }}
        />
      </div>
    </div>
  )
}

/**
 * Слой разметки поверх страницы: объекты в координатах PDF переводятся в
 * пиксели вида матрицей pdf.js (масштаб, поворот вида и /Rotate страницы).
 * Инструменты рисования ловят указатель на всём слое; «Выделение» слушает
 * страницу в фазе захвата и забирает щелчок, только если под ним объект, —
 * иначе выделение текста работает как обычно.
 */
export const MarkupLayer = memo(function MarkupLayer({
  geometry,
  pageNumber,
  scale,
  rotation,
  objects,
  selectedId,
  tool,
  style,
  shapeKind,
  actions
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<MarkupObject | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  useLayoutEffect(() => {
    editingRef.current = editing
  })

  const totalRotation = geometry.rotate + rotation
  const matrix = useMemo(
    () => viewMatrix(geometry.box, totalRotation, scale),
    [geometry.box, totalRotation, scale]
  )
  const inverse = useMemo(() => invert(matrix), [matrix])
  const size = viewSize(geometry.box, totalRotation, scale)
  const sources = useMemo<SelectionSource[]>(() => [markupSource(objects)], [objects])

  const viewPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }, [])
  const pagePoint = useCallback(
    (clientX: number, clientY: number): Point => apply(inverse, viewPoint(clientX, clientY)),
    [inverse, viewPoint]
  )

  /** Жест указателя: обработчики на window, чтобы не терять его за краем страницы. */
  const gesture = useCallback(
    (onMove: (event: PointerEvent) => void, onEnd: (event: PointerEvent) => void): void => {
      const move = (event: PointerEvent): void => {
        onMove(event)
      }
      const end = (event: PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        document.body.classList.remove(s.dragging ?? '')
        onEnd(event)
      }
      document.body.classList.add(s.dragging ?? '')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    []
  )

  const finishEditing = useCallback(() => {
    const current = editingRef.current
    if (!current) return
    editingRef.current = null
    setEditing(null)
    const { object, isNew } = current
    if (object.text.trim().length === 0) {
      if (!isNew) actions.removeMarkup(object.id)
    } else if (isNew) {
      actions.addMarkup(object, false)
    } else {
      actions.updateMarkup(object)
    }
  }, [actions])

  // Смена инструмента или страницы завершает правку текста.
  useEffect(() => {
    if (tool !== 'text' && tool !== 'select') finishEditing()
  }, [tool, finishEditing])

  const startMove = useCallback(
    (event: PointerEvent, object: MarkupObject) => {
      const start = pagePoint(event.clientX, event.clientY)
      let moved: MarkupObject | null = null
      gesture(
        (e) => {
          const p = pagePoint(e.clientX, e.clientY)
          moved = moveObject(object, p.x - start.x, p.y - start.y)
          setPreview(moved)
        },
        () => {
          setPreview(null)
          if (moved) actions.updateMarkup(moved)
        }
      )
    },
    [actions, gesture, pagePoint]
  )

  // «Выделение»: выбор, перемещение и правка текста двойным щелчком.
  useEffect(() => {
    const page = rootRef.current?.parentElement
    if (!page || tool !== 'select') return
    const hit = (event: MouseEvent): MarkupObject | null => {
      const target = hitSources(
        sources,
        pageNumber,
        pagePoint(event.clientX, event.clientY),
        HIT_TOLERANCE / scale
      )
      return target ? (objects.find((o) => o.id === target.id) ?? null) : null
    }
    const isOwnControl = (event: Event): boolean =>
      event.target instanceof Element &&
      event.target.closest('[data-markup-handle], [data-markup-editor]') !== null
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0 || isOwnControl(event)) return
      const object = hit(event)
      if (!object) {
        // Снимает выбор и на других страницах; повторный null состояние не меняет.
        actions.select(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
      actions.select({ source: 'markup', id: object.id })
      if (isMovable(object)) startMove(event, object)
    }
    // Нажатие на объект не должно начинать выделение текста под ним.
    const onMouseDown = (event: MouseEvent): void => {
      if (!isOwnControl(event) && hit(event)) event.preventDefault()
    }
    const onDoubleClick = (event: MouseEvent): void => {
      const object = hit(event)
      if (object?.kind === 'text') {
        event.preventDefault()
        setEditing({ object, isNew: false })
      }
    }
    const onHover = (event: PointerEvent): void => {
      if (event.buttons !== 0) return
      page.classList.toggle(s.hoverObject ?? '', hit(event) !== null)
    }
    page.addEventListener('pointerdown', onDown, true)
    page.addEventListener('mousedown', onMouseDown, true)
    page.addEventListener('dblclick', onDoubleClick, true)
    page.addEventListener('pointermove', onHover)
    return () => {
      page.removeEventListener('pointerdown', onDown, true)
      page.removeEventListener('mousedown', onMouseDown, true)
      page.removeEventListener('dblclick', onDoubleClick, true)
      page.removeEventListener('pointermove', onHover)
      page.classList.remove(s.hoverObject ?? '')
    }
  }, [tool, sources, objects, pageNumber, pagePoint, scale, actions, startMove])

  /** Конец по умолчанию для щелчка без протягивания: на 100×60 пикселей вправо-вниз на экране. */
  const defaultEnd = (start: Point): Point => {
    const v = apply(matrix, start)
    return apply(inverse, { x: v.x + 100 * scale, y: v.y + 60 * scale })
  }

  const onDrawStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    if ((event.target as Element).closest('[data-markup-editor]')) return
    event.preventDefault()
    const start = pagePoint(event.clientX, event.clientY)
    const base = { page: pageNumber, color: style.color, opacity: style.opacity }
    if (tool === 'pen') {
      const points: Point[] = [start]
      const draft = { ...base, id: newMarkupId(), kind: 'ink' as const, width: style.width }
      setPreview({ ...draft, paths: [points] })
      gesture(
        (e) => {
          points.push(pagePoint(e.clientX, e.clientY))
          setPreview({ ...draft, paths: [[...points]] })
        },
        () => {
          setPreview(null)
          const path = simplifyPath(points, 0.35)
          actions.addMarkup({ ...draft, paths: [path.length > 1 ? path : [start, start]] }, false)
        }
      )
    } else if (tool === 'shapes') {
      const id = newMarkupId()
      const make = (end: Point): MarkupObject =>
        shapeKind === 'line' || shapeKind === 'arrow'
          ? { ...base, id, kind: shapeKind, width: style.width, from: start, to: end }
          : { ...base, id, kind: shapeKind, width: style.width, rect: rectFromPoints(start, end) }
      gesture(
        (e) => {
          setPreview(make(pagePoint(e.clientX, e.clientY)))
        },
        (e) => {
          setPreview(null)
          const end = pagePoint(e.clientX, e.clientY)
          const tiny = Math.hypot(end.x - start.x, end.y - start.y) < CLICK_DISTANCE
          actions.addMarkup(make(tiny ? defaultEnd(start) : end), false)
        }
      )
    } else if (tool === 'text') {
      if (editingRef.current) {
        finishEditing()
        return
      }
      // Редактор на другой странице закрывается по потере фокуса.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      const object: TextObject = withText(
        {
          ...base,
          id: newMarkupId(),
          kind: 'text',
          rect: { x: start.x, y: start.y, width: 0, height: 0 },
          // Текст встаёт ровно на экране: с учётом /Rotate страницы и поворота вида.
          rotate: normalizeTurn(totalRotation),
          text: '',
          fontSize: style.fontSize
        },
        ''
      )
      setEditing({ object, isNew: true })
    } else if (tool === 'sign') {
      actions.placeSignature(pageNumber, start)
    }
  }

  // Изменение размера за угол или сторону (в пикселях вида, чтобы ручка шла за указателем
  // при любом повороте). Углы картинок сохраняют пропорции, с Shift — свободно.
  const startResize = (
    event: React.PointerEvent,
    object: MarkupObject,
    handle: FrameHandle
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    let result: MarkupObject | null = null
    gesture(
      (e) => {
        result = resizeInView(object, handle, viewPoint(e.clientX, e.clientY), e.shiftKey, {
          matrix,
          scale,
          measure: measureText
        })
        setPreview(result)
      },
      () => {
        setPreview(null)
        if (result) actions.updateMarkup(result)
      }
    )
  }

  const startEndpoint = (
    event: React.PointerEvent,
    object: LineObject,
    end: 'from' | 'to'
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    let result: LineObject | null = null
    gesture(
      (e) => {
        result = { ...object, [end]: pagePoint(e.clientX, e.clientY) }
        setPreview(result)
      },
      () => {
        setPreview(null)
        if (result) actions.updateMarkup(result)
      }
    )
  }

  const shown = useMemo(() => {
    const list = objects.map((o) => (o.id === preview?.id ? preview : o))
    if (preview && !objects.some((o) => o.id === preview.id)) list.push(preview)
    return editing ? list.filter((o) => o.id !== editing.object.id) : list
  }, [objects, preview, editing])
  const highlights = shown.filter((o) => o.kind === 'highlight')
  const selected = shown.find((o) => o.id === selectedId) ?? null
  const drawing = tool === 'pen' || tool === 'shapes' || tool === 'text' || tool === 'sign'
  const gTransform = `matrix(${matrix.join(' ')})`

  let frame: React.JSX.Element | null = null
  if (selected && !editing) {
    const bounds = transformRect(matrix, visualBounds(selected))
    const interactive = tool === 'select' && isMovable(selected)
    const handles: React.JSX.Element[] = []
    if (interactive && (selected.kind === 'line' || selected.kind === 'arrow')) {
      for (const end of ['from', 'to'] as const) {
        const p = apply(matrix, selected[end])
        handles.push(
          <span
            key={end}
            className={s.handle}
            data-markup-handle={end}
            style={{ left: p.x, top: p.y }}
            onPointerDown={(e) => {
              startEndpoint(e, selected, end)
            }}
          />
        )
      }
    } else if (interactive) {
      const g = transformRect(matrix, geometryBounds(selected))
      for (const handle of FRAME_HANDLES) {
        const p = handlePoint(g, handle)
        handles.push(
          <span
            key={handle.id}
            className={s.handle}
            data-markup-handle={handle.id}
            style={{ left: p.x, top: p.y, cursor: handle.cursor }}
            onPointerDown={(e) => {
              startResize(e, selected, handle)
            }}
          />
        )
      }
    }
    frame = (
      <>
        <div
          className={s.frame}
          style={{
            left: bounds.x - 3,
            top: bounds.y - 3,
            width: bounds.width + 6,
            height: bounds.height + 6
          }}
          data-markup-selected={selected.kind}
        />
        {handles}
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cx(s.layer, drawing && s.drawing, tool === 'text' && s.textTool)}
      style={{ width: size.width, height: size.height }}
      onPointerDown={drawing ? onDrawStart : undefined}
      onMouseDown={
        drawing
          ? (event) => {
              // Иначе щелчок по странице уводит фокус из только что открытого редактора текста.
              if (!(event.target as Element).closest('[data-markup-editor]')) event.preventDefault()
            }
          : undefined
      }
      data-markup-layer={pageNumber}
    >
      {highlights.length > 0 && (
        <svg
          className={cx(s.svg, s.multiply)}
          width={size.width}
          height={size.height}
          aria-hidden="true"
        >
          <g transform={gTransform}>
            {highlights.map(
              (o) =>
                o.kind === 'highlight' && (
                  <g key={o.id} opacity={o.opacity} fill={o.color}>
                    {o.rects.map((r, i) => (
                      <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} />
                    ))}
                  </g>
                )
            )}
          </g>
        </svg>
      )}
      <svg className={s.svg} width={size.width} height={size.height} aria-hidden="true">
        <g transform={gTransform}>
          {shown.map((o) => (
            <VectorObject key={o.id} o={o} />
          ))}
        </g>
      </svg>
      {shown.filter(isBoxObject).map((o) => (
        <BoxObject
          key={o.id}
          o={o}
          placement={boxPlacement(o, matrix, geometry, rotation, scale)}
        />
      ))}
      {frame}
      {editing && (
        <TextEditor
          editing={editing}
          placement={boxPlacement(editing.object, matrix, geometry, rotation, scale)}
          scale={scale}
          onChange={(text) => {
            setEditing((current) =>
              current ? { ...current, object: withText(current.object, text) } : current
            )
          }}
          onDone={finishEditing}
        />
      )}
    </div>
  )
})
