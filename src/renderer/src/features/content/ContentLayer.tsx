import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  apply,
  inflate,
  invert,
  rectFromPoints,
  transformRect,
  viewMatrix,
  viewSize,
  type PageGeometry,
  type Point,
  type Rect
} from '@shared/markup/geometry'
import { MARKUP_FONT_FAMILY } from '@shared/markup/text-layout'
import type { PageImage, PageTextLine } from '@shared/pdf-content/types'
import type { Actions, ContentMode } from '@renderer/app/store'
import type { Rotation } from '@renderer/pdf-engine/engine'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import {
  contentId,
  contentSource,
  type PageContentObject,
  type SelectionTarget
} from '@renderer/features/markup/selection'
import { usePageObjects } from './page-objects'
import s from './content.module.css'

type ContentTarget = Extract<SelectionTarget, { source: 'content' }>

interface Props {
  geometry: PageGeometry
  pageNumber: number
  /** CSS-пикселей на пункт. */
  scale: number
  /** Поворот вида (без собственного /Rotate страницы). */
  rotation: Rotation
  bytes: Uint8Array
  mode: ContentMode
  /** Выбранный объект документа, если он на этой странице. */
  selected: ContentTarget | null
  actions: Actions
}

/** Допуск попадания, CSS-пиксели. */
const HIT_TOLERANCE = 2
/** Меньше этого жест считается щелчком, а не перетаскиванием, CSS-пиксели. */
const CLICK_DISTANCE = 3
/** Самая маленькая сторона картинки при изменении размера, CSS-пиксели. */
const MIN_IMAGE_SIZE = 8

/** Жест указателя: обработчики на window, чтобы не терять его за краем страницы. */
function trackPointer(
  onMove: (event: PointerEvent) => void,
  onEnd: (event: PointerEvent) => void
): void {
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
}

function LineEditor({
  line,
  frame,
  scale,
  onDone
}: {
  line: PageTextLine
  frame: Rect
  scale: number
  onDone: (text: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(line.text)
  const done = useRef(false)
  const finish = (text: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(text)
  }
  const fontSize = Math.max(8, line.fontSize * scale)
  return (
    <input
      className={s.editor}
      aria-label={t.content.text}
      data-content-editor=""
      value={value}
      autoFocus
      spellCheck={false}
      style={{
        left: frame.x - 2,
        top: frame.y + frame.height / 2 - (fontSize * 1.4) / 2,
        minWidth: frame.width + 4,
        width: Math.max(frame.width + 4, value.length * fontSize * 0.55),
        height: fontSize * 1.4,
        fontSize,
        fontFamily: `'${MARKUP_FONT_FAMILY}', sans-serif`
      }}
      onFocus={(event) => {
        event.target.select()
      }}
      onChange={(event) => {
        setValue(event.target.value)
      }}
      onBlur={() => {
        finish(value)
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(null)
        }
      }}
    />
  )
}

/**
 * Слой инструмента «Правка»: строки текста и картинки самого документа
 * (MuPDF, координаты пространства PDF) переводятся в пиксели вида той же
 * матрицей, что и разметка. Наведение подсвечивает объект, щелчок выбирает,
 * двойной щелчок по строке открывает правку текста, картинку можно перетащить
 * и потянуть за угол; в режиме «Ластик области» протянутая рамка вырезает всё
 * внутри неё. Каждое действие — одна правка байтов через историю вкладки.
 */
export const ContentLayer = memo(function ContentLayer({
  geometry,
  pageNumber,
  scale,
  rotation,
  bytes,
  mode,
  selected,
  actions
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const objects = usePageObjects(bytes, pageNumber, true)
  const list = useMemo<PageContentObject[]>(
    () => (objects ? [...objects.lines, ...objects.images] : []),
    [objects]
  )
  const source = useMemo(() => contentSource(pageNumber, list), [pageNumber, list])
  const [hover, setHover] = useState<PageContentObject | null>(null)
  /** Рамка во время жеста (пространство PDF): перенос картинки или ластик. */
  const [preview, setPreview] = useState<Rect | null>(null)
  const [editing, setEditing] = useState<PageTextLine | null>(null)

  const totalRotation = geometry.rotate + rotation
  const matrix = useMemo(
    () => viewMatrix(geometry.box, totalRotation, scale),
    [geometry.box, totalRotation, scale]
  )
  const inverse = useMemo(() => invert(matrix), [matrix])
  const size = viewSize(geometry.box, totalRotation, scale)

  const viewPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }, [])
  const pagePoint = useCallback(
    (clientX: number, clientY: number): Point => apply(inverse, viewPoint(clientX, clientY)),
    [inverse, viewPoint]
  )
  const hitAt = (event: { clientX: number; clientY: number }): ContentTarget | null => {
    const target = source.hitTest(
      pageNumber,
      pagePoint(event.clientX, event.clientY),
      HIT_TOLERANCE / scale
    )
    return target?.source === 'content' ? target : null
  }

  const startErase = (start: Point): void => {
    let rect: Rect | null = null
    trackPointer(
      (e) => {
        rect = rectFromPoints(start, pagePoint(e.clientX, e.clientY))
        setPreview(rect)
      },
      () => {
        setPreview(null)
        const area: Rect | null = rect
        if (area && area.width * scale >= CLICK_DISTANCE && area.height * scale >= CLICK_DISTANCE) {
          actions.eraseContent(pageNumber, area)
        }
      }
    )
  }

  const startMove = (image: PageImage, start: Point): void => {
    let moved: Rect | null = null
    trackPointer(
      (e) => {
        const p = pagePoint(e.clientX, e.clientY)
        moved = { ...image.rect, x: image.rect.x + p.x - start.x, y: image.rect.y + p.y - start.y }
        setPreview(moved)
      },
      () => {
        setPreview(null)
        const target: Rect | null = moved
        if (!target) return
        const shift = Math.hypot(target.x - image.rect.x, target.y - image.rect.y) * scale
        if (shift >= CLICK_DISTANCE) actions.moveContentImage(pageNumber, image, target)
      }
    )
  }

  // Изменение размера за угол с сохранением пропорций (в пикселях вида — при любом повороте).
  const startCorner = (event: React.PointerEvent, image: PageImage, corner: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const frame = transformRect(matrix, image.rect)
    const corners: Point[] = [
      { x: frame.x, y: frame.y },
      { x: frame.x + frame.width, y: frame.y },
      { x: frame.x + frame.width, y: frame.y + frame.height },
      { x: frame.x, y: frame.y + frame.height }
    ]
    const fixed = corners[(corner + 2) % 4] ?? corners[0] ?? { x: 0, y: 0 }
    let result: Rect | null = null
    trackPointer(
      (e) => {
        const q = viewPoint(e.clientX, e.clientY)
        const k = Math.max(
          Math.abs(q.x - fixed.x) / Math.max(frame.width, 1),
          Math.abs(q.y - fixed.y) / Math.max(frame.height, 1),
          MIN_IMAGE_SIZE / Math.max(Math.min(frame.width, frame.height), 1)
        )
        const w = frame.width * k
        const h = frame.height * k
        const view: Rect = {
          x: q.x < fixed.x ? fixed.x - w : fixed.x,
          y: q.y < fixed.y ? fixed.y - h : fixed.y,
          width: w,
          height: h
        }
        result = transformRect(inverse, view)
        setPreview(result)
      },
      () => {
        setPreview(null)
        const target: Rect | null = result
        if (target) actions.moveContentImage(pageNumber, image, target)
      }
    )
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const element = event.target as Element
    if (element.closest('[data-content-editor]')) return
    // Угол выбранной картинки: номер угла — в data-content-handle.
    const handle = element.closest<HTMLElement>('[data-content-handle]')
    if (handle) {
      if (selected?.object.kind === 'image') {
        startCorner(event, selected.object, Number(handle.dataset.contentHandle))
      }
      return
    }
    event.preventDefault()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const start = pagePoint(event.clientX, event.clientY)
    if (mode === 'erase') {
      startErase(start)
      return
    }
    const target = hitAt(event)
    actions.select(target)
    if (target?.object.kind === 'image') startMove(target.object, start)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (mode !== 'objects') return
    const target = hitAt(event)
    if (target?.object.kind !== 'text') return
    event.preventDefault()
    actions.select(target)
    setEditing(target.object)
  }

  const onHover = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.buttons !== 0 || mode !== 'objects') return
    const object = hitAt(event)?.object ?? null
    setHover((current) =>
      current?.kind === object?.kind && current?.index === object?.index ? current : object
    )
  }

  const selectedObject = selected?.object ?? null
  const view = (r: Rect): Rect => transformRect(matrix, r)
  const box = (r: Rect, pad: number): React.CSSProperties => {
    const v = inflate(view(r), pad)
    return { left: v.x, top: v.y, width: v.width, height: v.height }
  }

  let handles: React.JSX.Element[] = []
  if (selectedObject?.kind === 'image' && !preview && !editing) {
    const g = view(selectedObject.rect)
    handles = [
      { x: g.x, y: g.y, cursor: 'nwse-resize' },
      { x: g.x + g.width, y: g.y, cursor: 'nesw-resize' },
      { x: g.x + g.width, y: g.y + g.height, cursor: 'nwse-resize' },
      { x: g.x, y: g.y + g.height, cursor: 'nesw-resize' }
    ].map((c, i) => (
      <span
        key={i}
        className={s.handle}
        data-content-handle={i}
        style={{ left: c.x, top: c.y, cursor: c.cursor }}
      />
    ))
  }

  const hovered =
    hover && mode === 'objects' && contentId(pageNumber, hover) !== selected?.id ? hover : null
  return (
    <div
      ref={rootRef}
      className={cx(
        s.layer,
        mode === 'erase' && s.erase,
        mode === 'objects' && hover?.kind === 'text' && s.over,
        mode === 'objects' && hover?.kind === 'image' && s.overImage
      )}
      style={{ width: size.width, height: size.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onHover}
      onPointerLeave={() => {
        setHover(null)
      }}
      onDoubleClick={onDoubleClick}
      data-content-layer={pageNumber}
      data-content-ready={objects ? list.length : undefined}
    >
      {hovered && (
        <div className={s.outline} style={box(hovered.rect, 2)} data-content-hover={hovered.kind} />
      )}
      {selectedObject && !editing && (
        <div
          className={s.frame}
          style={box(selectedObject.rect, 2)}
          data-content-selected={selectedObject.kind}
        />
      )}
      {preview && (
        <div
          className={mode === 'erase' ? s.eraseRect : s.preview}
          style={box(preview, 0)}
          data-content-preview=""
        />
      )}
      {handles}
      {editing && (
        <LineEditor
          key={contentId(pageNumber, editing)}
          line={editing}
          frame={view(editing.rect)}
          scale={scale}
          onDone={(text) => {
            setEditing(null)
            if (text !== null) actions.replaceContentText(pageNumber, editing, text)
          }}
        />
      )}
    </div>
  )
})
