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
import { pickPageObject } from '@shared/pdf-content/hit-test'
import type {
  PageGraphic,
  PageImage,
  PageObjects,
  PageTextBlock,
  PageTextLine,
  PdfSpacePoint,
  TextStyle
} from '@shared/pdf-content/types'
import type { Actions, ContentMode } from '@renderer/app/store'
import type { Rotation } from '@renderer/pdf-engine/engine'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import {
  contentId,
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
  /** Стиль нового текста (режим «Новый текст»). */
  textStyle: TextStyle | null
  /** Группа выбранных объектов на этой странице (больше одного) или пусто. */
  group: readonly ContentTarget[]
  actions: Actions
}

/** Допуск попадания, CSS-пиксели. */
const HIT_TOLERANCE = 2
/** Меньше этого жест считается щелчком, а не перетаскиванием, CSS-пиксели. */
const CLICK_DISTANCE = 3
/** Самая маленькая сторона объекта при изменении размера, CSS-пиксели. */
const MIN_SIZE = 6

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end'
type Editing =
  | { kind: 'line'; line: PageTextLine }
  | { kind: 'block'; block: PageTextBlock }
  | { kind: 'new'; at: Point; style: TextStyle }

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

function dot(a: PdfSpacePoint, b: PdfSpacePoint): number {
  return a.x * b.x + a.y * b.y
}

function contains(rect: Rect, p: Point, tolerance: number): boolean {
  return (
    p.x >= rect.x - tolerance &&
    p.x <= rect.x + rect.width + tolerance &&
    p.y >= rect.y - tolerance &&
    p.y <= rect.y + rect.height + tolerance
  )
}

/** Рамка абзаца вдоль письма от start до end (пт от начала строки) в пространстве PDF. */
function blockSpan(block: PageTextBlock, start: number, end: number): Rect {
  const d = block.direction
  const n = { x: -d.y, y: d.x }
  const r = block.rect
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height }
  ].map((p) => dot(p, n))
  const v0 = Math.min(...corners)
  const v1 = Math.max(...corners)
  const s0 = dot(block.origin, d)
  const points = [
    [s0 + start, v0],
    [s0 + end, v0],
    [s0 + start, v1],
    [s0 + end, v1]
  ].map(([u = 0, v = 0]) => ({ x: d.x * u + n.x * v, y: d.y * u + n.y * v }))
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Стиль нового текста по умолчанию: основной текст страницы (самый длинный абзац). */
function defaultStyle(objects: PageObjects | null): TextStyle {
  const main = objects?.blocks.reduce<PageTextBlock | null>(
    (best, b) => (!best || b.text.length > best.text.length ? b : best),
    null
  )
  return (
    main?.style ?? {
      fontName: 'Helvetica',
      fontSize: 11,
      color: [0, 0, 0],
      bold: false,
      italic: false
    }
  )
}

function cssColor([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

function TextEditor({
  value: initial,
  frame,
  fontSize,
  lineHeight,
  color,
  multiline,
  onDone
}: {
  value: string
  frame: Rect
  fontSize: number
  lineHeight: number
  color: string
  multiline: boolean
  onDone: (text: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (text: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(text)
  }
  const rows = Math.max(1, value.split('\n').length)
  const common = {
    className: s.editor,
    'aria-label': t.content.text,
    'data-content-editor': '',
    autoFocus: true,
    spellCheck: false,
    value,
    onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (initial !== '') event.target.select()
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue(event.target.value)
    },
    onBlur: () => {
      finish(value)
    },
    onPointerDown: (event: React.PointerEvent) => {
      event.stopPropagation()
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(null)
      } else if (event.key === 'Enter' && (!multiline || event.ctrlKey)) {
        event.preventDefault()
        finish(value)
      }
    }
  }
  const style: React.CSSProperties = {
    left: frame.x - 3,
    top: frame.y - 3,
    width: Math.max(frame.width + 6, fontSize * 4),
    fontSize,
    lineHeight: `${lineHeight}px`,
    color,
    fontFamily: `'${MARKUP_FONT_FAMILY}', sans-serif`
  }
  return multiline ? (
    <textarea
      {...common}
      wrap="soft"
      style={{
        ...style,
        height: Math.max(frame.height + 6, rows * lineHeight + 8),
        resize: 'none'
      }}
    />
  ) : (
    <input
      {...common}
      style={{
        ...style,
        width: Math.max(frame.width + 6, value.length * fontSize * 0.55),
        height: lineHeight + 6
      }}
    />
  )
}

/**
 * Слой инструмента «Правка»: абзацы, строки, картинки и векторные фигуры
 * самого документа (MuPDF, координаты пространства PDF) переводятся в пиксели
 * вида той же матрицей, что и разметка. Щелчок выбирает абзац, картинку или
 * фигуру, повторный щелчок по абзацу — строку в нём; двойной щелчок открывает
 * правку текста на месте. Выбранное перетаскивается и тянется за ручки:
 * у абзаца ручки меняют ширину колонки (текст переносится заново), у картинок
 * и фигур — ширину и высоту. В режиме «Новый текст» щелчок ставит новый текст,
 * в режиме «Ластик» протянутая рамка вырезает всё внутри. Каждое действие —
 * одна правка байтов через историю вкладки.
 */
export const ContentLayer = memo(function ContentLayer({
  geometry,
  pageNumber,
  scale,
  rotation,
  bytes,
  mode,
  selected,
  textStyle,
  group,
  actions
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const objects = usePageObjects(bytes, pageNumber, true)
  const pickable = useMemo<PageContentObject[]>(
    () => (objects ? [...objects.blocks, ...objects.images, ...objects.graphics] : []),
    [objects]
  )
  const [hover, setHover] = useState<PageContentObject | null>(null)
  /** Рамка во время жеста (пространство PDF): перенос, изменение размера или ластик. */
  const [preview, setPreview] = useState<Rect | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  /** Смещение группы во время перетаскивания (пространство PDF). */
  const [groupShift, setGroupShift] = useState<Point | null>(null)
  /** Что было выбрано до первого нажатия двойного щелчка. */
  const beforeDouble = useRef<ContentTarget | null>(null)
  /** Время и место прошлого нажатия: у pointerdown нет счётчика щелчков. */
  const lastDown = useRef<{ time: number; x: number; y: number } | null>(null)

  const totalRotation = geometry.rotate + rotation
  const matrix = useMemo(
    () => viewMatrix(geometry.box, totalRotation, scale),
    [geometry.box, totalRotation, scale]
  )
  const inverse = useMemo(() => invert(matrix), [matrix])
  const size = viewSize(geometry.box, totalRotation, scale)
  /** Направление «слева направо на экране» в пространстве PDF. */
  const screenRight = useMemo<PdfSpacePoint>(() => {
    const a = apply(inverse, { x: 0, y: 0 })
    const b = apply(inverse, { x: 1, y: 0 })
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  }, [inverse])

  const viewPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }, [])
  const pagePoint = useCallback(
    (clientX: number, clientY: number): Point => apply(inverse, viewPoint(clientX, clientY)),
    [inverse, viewPoint]
  )
  const view = (r: Rect): Rect => transformRect(matrix, r)
  const target = (object: PageContentObject): ContentTarget => ({
    source: 'content',
    id: contentId(pageNumber, object),
    page: pageNumber,
    object
  })

  /** Абзац выбранного объекта (сам абзац или абзац выбранной строки). */
  const blockOf = (object: PageContentObject | null | undefined): PageTextBlock | null => {
    if (!object || !objects) return null
    if (object.kind === 'block') return object
    if (object.kind !== 'text') return null
    return objects.blocks.find((b) => b.lines.includes(object.index)) ?? null
  }

  /**
   * Объект под точкой. Внутри уже выбранного абзаца выбирается строка
   * (второй щелчок), иначе — самый маленький из абзацев, картинок и фигур.
   */
  const objectAt = (p: Point, drill: boolean): PageContentObject | null => {
    if (!objects) return null
    const tolerance = HIT_TOLERANCE / scale
    const current = blockOf(selected?.object)
    if (drill && current && current.lines.length > 1 && contains(current.rect, p, tolerance)) {
      const lines = current.lines.flatMap((i) => objects.lines.filter((l) => l.index === i))
      const line = pickPageObject(lines, p, tolerance)
      if (line) return line
    }
    return pickPageObject(pickable, p, tolerance)
  }

  // ---- жесты --------------------------------------------------------------

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

  const startMove = (object: PageContentObject, startClient: Point): void => {
    if (object.kind === 'text') return
    const start = pagePoint(startClient.x, startClient.y)
    let delta: Point | null = null
    trackPointer(
      (e) => {
        const p = pagePoint(e.clientX, e.clientY)
        delta = { x: p.x - start.x, y: p.y - start.y }
        setPreview({ ...object.rect, x: object.rect.x + delta.x, y: object.rect.y + delta.y })
      },
      () => {
        setPreview(null)
        const shift: Point | null = delta
        if (!shift || Math.hypot(shift.x, shift.y) * scale < CLICK_DISTANCE) return
        const moved = { ...object.rect, x: object.rect.x + shift.x, y: object.rect.y + shift.y }
        if (object.kind === 'image') actions.moveContentImage(pageNumber, object, moved)
        else if (object.kind === 'graphic') actions.moveContentGraphic(pageNumber, object, moved)
        else {
          const origin = { x: object.origin.x + shift.x, y: object.origin.y + shift.y }
          actions.replaceContentBlock(pageNumber, object, object.text, { origin })
        }
      }
    )
  }

  /** Перетаскивание группы: все выбранные объекты сдвигаются одним шагом отмены. */
  const startGroupMove = (members: readonly ContentTarget[], startClient: Point): void => {
    const start = pagePoint(startClient.x, startClient.y)
    let delta: Point | null = null
    trackPointer(
      (e) => {
        const p = pagePoint(e.clientX, e.clientY)
        delta = { x: p.x - start.x, y: p.y - start.y }
        setGroupShift(delta)
      },
      () => {
        setGroupShift(null)
        const shift: Point | null = delta
        if (!shift || Math.hypot(shift.x, shift.y) * scale < CLICK_DISTANCE) return
        actions.moveContentGroup(members, shift)
      }
    )
  }

  /** Рамка с Shift: выбирает абзацы, картинки и фигуры целиком внутри неё. */
  const startBand = (start: Point): void => {
    let band: Rect | null = null
    trackPointer(
      (e) => {
        band = rectFromPoints(start, pagePoint(e.clientX, e.clientY))
        setPreview(band)
      },
      () => {
        setPreview(null)
        const area: Rect | null = band
        if (!area) return
        const inside = pickable.filter(
          (o) =>
            o.rect.x >= area.x &&
            o.rect.y >= area.y &&
            o.rect.x + o.rect.width <= area.x + area.width &&
            o.rect.y + o.rect.height <= area.y + area.height
        )
        actions.setContentGroup(inside.map(target))
      }
    )
  }

  /** Ширина абзаца: ручки начала и конца строки, текст переносится заново. */
  const startBlockResize = (block: PageTextBlock, handle: 'start' | 'end'): void => {
    const d = block.direction
    const s0 = dot(block.origin, d)
    const min = Math.max(block.style.fontSize * 3, MIN_SIZE / scale)
    let result: { start: number; width: number } | null = null
    trackPointer(
      (e) => {
        const along = dot(pagePoint(e.clientX, e.clientY), d) - s0
        result =
          handle === 'end'
            ? { start: 0, width: Math.max(min, along) }
            : {
                start: Math.min(along, block.width - min),
                width: block.width - Math.min(along, block.width - min)
              }
        setPreview(blockSpan(block, result.start, result.start + result.width))
      },
      () => {
        setPreview(null)
        const next: { start: number; width: number } | null = result
        if (!next || Math.abs(next.width - block.width) * scale < 1) return
        const origin = {
          x: block.origin.x + d.x * next.start,
          y: block.origin.y + d.y * next.start
        }
        actions.replaceContentBlock(pageNumber, block, block.text, {
          width: next.width,
          ...(next.start !== 0 ? { origin } : {})
        })
      }
    )
  }

  /** Картинка или фигура: углы и стороны в пикселях вида — при любом повороте. */
  const startBoxResize = (
    object: PageImage | PageGraphic,
    handle: Exclude<Handle, 'start' | 'end'>,
    event: React.PointerEvent
  ): void => {
    const frame = view(object.rect)
    const left = frame.x
    const right = frame.x + frame.width
    const top = frame.y
    const bottom = frame.y + frame.height
    const keepAspect =
      object.kind === 'image' && handle.length === 2 && !event.shiftKey && frame.width > 0
    let result: Rect | null = null
    trackPointer(
      (e) => {
        const q = viewPoint(e.clientX, e.clientY)
        let x0 = left
        let x1 = right
        let y0 = top
        let y1 = bottom
        if (handle.includes('w')) x0 = Math.min(q.x, right - MIN_SIZE)
        if (handle.includes('e')) x1 = Math.max(q.x, left + MIN_SIZE)
        if (handle.includes('n')) y0 = Math.min(q.y, bottom - MIN_SIZE)
        if (handle.includes('s')) y1 = Math.max(q.y, top + MIN_SIZE)
        if (keepAspect && frame.height > 0) {
          const k = Math.max((x1 - x0) / frame.width, (y1 - y0) / frame.height)
          const w = frame.width * k
          const h = frame.height * k
          if (handle.includes('w')) x0 = right - w
          else x1 = left + w
          if (handle.includes('n')) y0 = bottom - h
          else y1 = top + h
        }
        result = transformRect(inverse, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
        setPreview(result)
      },
      () => {
        setPreview(null)
        const next: Rect | null = result
        if (!next) return
        if (object.kind === 'image') actions.moveContentImage(pageNumber, object, next)
        else actions.moveContentGraphic(pageNumber, object, next)
      }
    )
  }

  // ---- события слоя -------------------------------------------------------

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const element = event.target as Element
    if (element.closest('[data-content-editor]')) return
    event.preventDefault()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const handle = element.closest<HTMLElement>('[data-content-handle]')?.dataset.contentHandle as
      Handle | undefined
    const object = selected?.object
    if (handle && object) {
      if (object.kind === 'block' && (handle === 'start' || handle === 'end')) {
        startBlockResize(object, handle)
      } else if (
        (object.kind === 'image' || object.kind === 'graphic') &&
        handle !== 'start' &&
        handle !== 'end'
      ) {
        startBoxResize(object, handle, event)
      }
      return
    }
    const start = pagePoint(event.clientX, event.clientY)
    if (mode === 'erase') {
      startErase(start)
      return
    }
    if (mode === 'text') {
      const style = textStyle ?? defaultStyle(objects)
      setEditing({ kind: 'new', at: viewPoint(event.clientX, event.clientY), style })
      return
    }
    // Второе нажатие двойного щелчка выбор не меняет: правку решает dblclick.
    const now = performance.now()
    const last = lastDown.current
    lastDown.current = { time: now, x: event.clientX, y: event.clientY }
    if (
      last &&
      now - last.time < 500 &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < 6
    ) {
      return
    }
    const hit = objectAt(start, !event.ctrlKey)
    if (!hit && event.shiftKey) {
      startBand(start)
      return
    }
    // Ctrl+щелчок добавляет объект к группе или убирает из неё.
    if (hit && (event.ctrlKey || event.metaKey)) {
      const picked = target(hit)
      const current: ContentTarget[] =
        group.length > 1 ? [...group] : selected?.page === pageNumber ? [selected] : []
      const next = current.some((t) => t.id === picked.id)
        ? current.filter((t) => t.id !== picked.id)
        : [...current, picked]
      actions.setContentGroup(next)
      return
    }
    if (hit && group.length > 1 && group.some((t) => t.id === contentId(pageNumber, hit))) {
      startGroupMove(group, { x: event.clientX, y: event.clientY })
      return
    }
    beforeDouble.current = selected
    actions.select(hit ? target(hit) : null)
    if (hit) startMove(hit, { x: event.clientX, y: event.clientY })
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (mode !== 'objects' || !objects) return
    const p = pagePoint(event.clientX, event.clientY)
    const before = beforeDouble.current?.object
    // Строка правится, если её выбрали до двойного щелчка; иначе — весь абзац.
    const line = before?.kind === 'text' ? objectAt(p, true) : null
    if (line?.kind === 'text' && line.index === before?.index) {
      event.preventDefault()
      actions.select(target(line))
      setEditing({ kind: 'line', line })
      return
    }
    const hit = pickPageObject(pickable, p, HIT_TOLERANCE / scale)
    if (hit?.kind === 'block') {
      event.preventDefault()
      actions.select(target(hit))
      setEditing({ kind: 'block', block: hit })
    }
  }

  const onHover = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.buttons !== 0 || mode !== 'objects') return
    const object = objectAt(pagePoint(event.clientX, event.clientY), true)
    setHover((current) =>
      current?.kind === object?.kind && current?.index === object?.index ? current : object
    )
  }

  // ---- отрисовка ----------------------------------------------------------

  const box = (r: Rect, pad: number): React.CSSProperties => {
    const v = inflate(view(r), pad)
    return { left: v.x, top: v.y, width: v.width, height: v.height }
  }

  const selectedObject = selected?.object ?? null
  const handles: { id: Handle; at: Point; cursor: string }[] = []
  if (selectedObject && !preview && !editing && mode === 'objects' && group.length < 2) {
    if (selectedObject.kind === 'block') {
      const d = selectedObject.direction
      const n = { x: -d.y, y: d.x }
      const r = selectedObject.rect
      const mid = (dot({ x: r.x, y: r.y }, n) + dot({ x: r.x + r.width, y: r.y + r.height }, n)) / 2
      const base = dot(selectedObject.origin, n)
      const at = (u: number): Point =>
        apply(matrix, {
          x: selectedObject.origin.x + d.x * u + n.x * (mid - base),
          y: selectedObject.origin.y + d.y * u + n.y * (mid - base)
        })
      handles.push({ id: 'start', at: at(0), cursor: 'ew-resize' })
      handles.push({ id: 'end', at: at(selectedObject.width), cursor: 'ew-resize' })
    } else if (selectedObject.kind === 'image' || selectedObject.kind === 'graphic') {
      const f = view(selectedObject.rect)
      const cx = f.x + f.width / 2
      const cy = f.y + f.height / 2
      handles.push(
        { id: 'nw', at: { x: f.x, y: f.y }, cursor: 'nwse-resize' },
        { id: 'n', at: { x: cx, y: f.y }, cursor: 'ns-resize' },
        { id: 'ne', at: { x: f.x + f.width, y: f.y }, cursor: 'nesw-resize' },
        { id: 'e', at: { x: f.x + f.width, y: cy }, cursor: 'ew-resize' },
        { id: 'se', at: { x: f.x + f.width, y: f.y + f.height }, cursor: 'nwse-resize' },
        { id: 's', at: { x: cx, y: f.y + f.height }, cursor: 'ns-resize' },
        { id: 'sw', at: { x: f.x, y: f.y + f.height }, cursor: 'nesw-resize' },
        { id: 'w', at: { x: f.x, y: cy }, cursor: 'ew-resize' }
      )
    }
  }

  // После правки страница перечитывается: подсветка прежнего объекта уже неверна.
  const current =
    hover && (pickable.includes(hover) || objects?.lines.includes(hover as PageTextLine))
      ? hover
      : null
  const hovered =
    current && mode === 'objects' && contentId(pageNumber, current) !== selected?.id
      ? current
      : null
  const movable =
    current && current.kind !== 'text' && contentId(pageNumber, current) === selected?.id

  let editor: React.JSX.Element | null = null
  if (editing?.kind === 'line') {
    const { line } = editing
    editor = (
      <TextEditor
        value={line.text}
        frame={view(line.rect)}
        fontSize={Math.max(8, line.fontSize * scale)}
        lineHeight={Math.max(10, line.rect.height * scale)}
        color={cssColor(line.color)}
        multiline={false}
        onDone={(text) => {
          setEditing(null)
          if (text !== null) actions.replaceContentText(pageNumber, line, text)
        }}
      />
    )
  } else if (editing?.kind === 'block') {
    const { block } = editing
    editor = (
      <TextEditor
        value={block.text}
        frame={view(blockSpan(block, 0, block.width))}
        fontSize={Math.max(8, block.style.fontSize * scale)}
        lineHeight={Math.max(10, block.lineHeight * scale)}
        color={cssColor(block.style.color)}
        multiline
        onDone={(text) => {
          setEditing(null)
          if (text !== null) actions.replaceContentBlock(pageNumber, block, text)
        }}
      />
    )
  } else if (editing?.kind === 'new') {
    const { at, style } = editing
    const fontSize = style.fontSize * scale
    editor = (
      <TextEditor
        value=""
        frame={{ x: at.x, y: at.y, width: fontSize * 12, height: fontSize * 1.4 }}
        fontSize={Math.max(8, fontSize)}
        lineHeight={Math.max(10, fontSize * 1.4)}
        color={cssColor(style.color)}
        multiline
        onDone={(text) => {
          setEditing(null)
          if (text === null || text.trim() === '') return
          // Верх набранного текста — в точке щелчка; базовая линия ниже на 0,8 кегля.
          const top = apply(inverse, at)
          const down = { x: screenRight.y, y: -screenRight.x }
          let origin = {
            x: top.x + down.x * style.fontSize * 0.8,
            y: top.y + down.y * style.fontSize * 0.8
          }
          // Щелчок рядом с левым краем абзаца прилипает к нему: новый текст встаёт ровно.
          const along = dot(origin, screenRight)
          const edge = objects?.blocks
            .filter((b) => Math.abs(dot(b.direction, screenRight) - 1) < 1e-3)
            .map((b) => dot(b.origin, screenRight))
            .find((start) => Math.abs(start - along) * scale <= 8)
          if (edge !== undefined) {
            origin = {
              x: origin.x + screenRight.x * (edge - along),
              y: origin.y + screenRight.y * (edge - along)
            }
          }
          actions.insertContentText(pageNumber, origin, text, style, { direction: screenRight })
        }}
      />
    )
  }

  return (
    <div
      ref={rootRef}
      className={cx(
        s.layer,
        mode === 'erase' && s.erase,
        mode === 'text' && s.textMode,
        mode === 'objects' && current?.kind === 'text' && s.over,
        mode === 'objects' && current && current.kind !== 'text' && !movable && s.over,
        mode === 'objects' && movable && s.overImage
      )}
      style={{ width: size.width, height: size.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onHover}
      onPointerLeave={() => {
        setHover(null)
      }}
      onDoubleClick={onDoubleClick}
      data-content-layer={pageNumber}
      data-content-ready={objects ? pickable.length : undefined}
    >
      {hovered && (
        <div className={s.outline} style={box(hovered.rect, 2)} data-content-hover={hovered.kind} />
      )}
      {group.length > 1 &&
        group.map((member) => {
          const shifted = groupShift
            ? {
                ...member.object.rect,
                x: member.object.rect.x + groupShift.x,
                y: member.object.rect.y + groupShift.y
              }
            : member.object.rect
          return (
            <div
              key={member.id}
              className={groupShift ? s.preview : s.frame}
              style={box(shifted, 2)}
              data-content-selected={member.object.kind}
            />
          )
        })}
      {selectedObject && !editing && group.length < 2 && (
        <div
          className={s.frame}
          style={box(
            selectedObject.kind === 'block'
              ? blockSpan(selectedObject, 0, selectedObject.width)
              : selectedObject.rect,
            2
          )}
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
      {handles.map((h) => (
        <span
          key={h.id}
          className={s.handle}
          data-content-handle={h.id}
          style={{ left: h.at.x, top: h.at.y, cursor: h.cursor }}
        />
      ))}
      {editor}
    </div>
  )
})
