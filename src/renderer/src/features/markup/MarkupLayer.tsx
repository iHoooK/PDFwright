import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  apply,
  invert,
  normalizeTurn,
  rectFromPoints,
  shiftInside,
  simplifyPath,
  transformRect,
  unionRects,
  viewMatrix,
  viewSize,
  type PageBox,
  type PageGeometry,
  type Point,
  type Rect
} from '@shared/markup/geometry'
import {
  geometryBounds,
  hitTest,
  isBoxObject,
  isMovable,
  isResizable,
  moveObject,
  newMarkupId,
  visualBounds,
  type LineObject,
  type MarkupObject,
  type NoteObject,
  type ShapeKind,
  type TextObject
} from '@shared/markup/model'
import { noteRectAt } from '@shared/markup/note'
import {
  dragFrame,
  FRAME_HANDLES,
  handlePoint,
  resizeInView,
  type FrameHandle
} from '@shared/markup/resize'
import {
  fitTextBox,
  LINE_HEIGHT,
  MARKUP_FONT_FAMILY,
  TEXT_PADDING
} from '@shared/markup/text-layout'
import type { PageAnnotation } from '@shared/pdf-content/annotations'
import type { Actions, Tool, ToolStyle } from '@renderer/app/store'
import type { PdfDocument, Rotation } from '@renderer/pdf-engine/engine'
import { t } from '@renderer/i18n'
import { cx } from '@renderer/components/cx'
import { usePageAnnotations } from '@renderer/features/annotations/page-annotations'
import { measureText } from './font'
import { BoxObject, VectorObject } from './MarkupShapes'
import { boxPlacement, type BoxPlacement } from './placement'
import {
  annotationSource,
  annotationTarget,
  hasTarget,
  hitSources,
  markupSource,
  type SelectionSource,
  type SelectionTarget
} from './selection'
import s from './markup.module.css'

interface Props {
  doc: PdfDocument
  /** Байты документа: по ним читаются его аннотации (MuPDF). */
  bytes: Uint8Array | null
  geometry: PageGeometry
  pageNumber: number
  /** CSS-пикселей на пункт. */
  scale: number
  /** Поворот вида (без собственного /Rotate страницы). */
  rotation: Rotation
  objects: readonly MarkupObject[]
  /** Выбранные объекты этой страницы (разметка и аннотации документа). */
  selected: readonly SelectionTarget[]
  /** Сколько объектов выбрано всего: ручки размера — только у единственного. */
  groupSize: number
  tool: Tool
  style: ToolStyle
  shapeKind: ShapeKind
  actions: Actions
}

/** Допуск попадания по тонким линиям, CSS-пиксели. */
const HIT_TOLERANCE = 6
/** Меньше этого жест считается щелчком, а не протягиванием, пт. */
const CLICK_DISTANCE = 3
/** Всплывающее окно текста заметки, CSS-пиксели. */
const NOTE_POPUP = { width: 220, height: 120, gap: 8 }
const NO_ANNOTATIONS: readonly PageAnnotation[] = []

interface Editing {
  object: TextObject | NoteObject
  isNew: boolean
}

/** Перенос выбранного: id объектов разметки и места аннотаций в списке, сдвиг в пунктах. */
interface Moving {
  markup: ReadonlySet<string>
  annotations: ReadonlySet<number>
  dx: number
  dy: number
}

/** Текст нового содержания: рамка подгоняется от начала текста (см. fitTextBox). */
function withText(o: TextObject, text: string, page: PageBox): TextObject {
  return fitTextBox({ ...o, text }, measureText, page)
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function TextEditor({
  editing,
  placement,
  scale,
  onChange,
  onDone
}: {
  editing: Editing & { object: TextObject }
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

/** Всплывающее окно текста заметки рядом со значком (справа, у края страницы — слева). */
function NoteEditor({
  note,
  icon,
  pageWidth,
  onChange,
  onDone
}: {
  note: NoteObject
  icon: Rect
  pageWidth: number
  onChange: (text: string) => void
  onDone: () => void
}): React.JSX.Element {
  const right = icon.x + icon.width + NOTE_POPUP.gap
  const left =
    right + NOTE_POPUP.width <= pageWidth ? right : icon.x - NOTE_POPUP.gap - NOTE_POPUP.width
  return (
    <div
      className={s.notePopup}
      style={{ left: Math.max(0, left), top: icon.y, width: NOTE_POPUP.width }}
      data-markup-editor=""
      data-note-editor=""
    >
      <textarea
        className={s.noteText}
        aria-label={t.annotations.noteText}
        placeholder={t.annotations.notePlaceholder}
        value={note.text}
        autoFocus
        spellCheck={false}
        style={{ height: NOTE_POPUP.height, borderColor: note.color }}
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
  )
}

/**
 * Слой разметки поверх страницы: объекты в координатах PDF переводятся в
 * пиксели вида матрицей pdf.js (масштаб, поворот вида и /Rotate страницы).
 * Инструменты рисования ловят указатель на всём слое; «Выделение» слушает
 * страницу в фазе захвата и забирает щелчок, только если под ним объект
 * разметки или аннотация документа, — иначе выделение текста работает как
 * обычно. Ctrl+щелчок собирает группу, Shift и протяжка по пустому месту —
 * выбор рамкой; группа двигается и удаляется целиком.
 */
export const MarkupLayer = memo(function MarkupLayer({
  doc,
  bytes,
  geometry,
  pageNumber,
  scale,
  rotation,
  objects,
  selected,
  groupSize,
  tool,
  style,
  shapeKind,
  actions
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<MarkupObject | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  /** Рамка аннотации, которую тянут за ручку (пространство страницы). */
  const [resizing, setResizing] = useState<{ index: number; rect: Rect } | null>(null)
  /** Рамка выбора с Shift, пиксели вида. */
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [hovered, setHovered] = useState<SelectionTarget | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  useLayoutEffect(() => {
    editingRef.current = editing
  })

  const loaded = usePageAnnotations(doc, bytes, pageNumber, tool === 'select')
  const annotations = loaded ?? NO_ANNOTATIONS

  const totalRotation = geometry.rotate + rotation
  const matrix = useMemo(
    () => viewMatrix(geometry.box, totalRotation, scale),
    [geometry.box, totalRotation, scale]
  )
  const inverse = useMemo(() => invert(matrix), [matrix])
  const size = viewSize(geometry.box, totalRotation, scale)
  const sources = useMemo<SelectionSource[]>(
    () => [markupSource(objects), annotationSource(pageNumber, annotations)],
    [objects, pageNumber, annotations]
  )

  // Выбранная аннотация исчезла из файла (отмена, другая правка) — из выбора тоже.
  useEffect(() => {
    if (!loaded) return
    for (const target of selected) {
      if (target.source !== 'annotation') continue
      const found = loaded.find((a) => a.index === target.index)
      if (found?.subtype !== target.subtype) actions.toggleSelected(target)
    }
  }, [loaded, selected, actions])

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
    if (object.kind === 'note') {
      // Заметка без текста не ставится; у поставленной текст можно и стереть.
      const before = objects.find((o) => o.id === object.id)
      if (isNew) {
        if (object.text.trim().length > 0) actions.addMarkup(object, false)
      } else if (before?.kind === 'note' && before.text !== object.text) {
        actions.updateMarkup(object)
      }
      return
    }
    if (object.text.trim().length === 0) {
      if (!isNew) actions.removeMarkup(object.id)
    } else if (isNew) {
      actions.addMarkup(object, false)
    } else {
      actions.updateMarkup(object)
    }
  }, [actions, objects])

  // Смена инструмента завершает правку текста.
  useEffect(() => {
    if (tool !== 'text' && tool !== 'note' && tool !== 'select') finishEditing()
  }, [tool, finishEditing])

  /** Перенос объекта или всей группы; без сдвига щелчок по члену группы выбирает только его. */
  const startMove = useCallback(
    (event: PointerEvent, target: SelectionTarget, group: readonly SelectionTarget[]) => {
      const start = pagePoint(event.clientX, event.clientY)
      const markupIds = new Set(group.filter((x) => x.source === 'markup').map((x) => x.id))
      const annotationIndexes = new Set(
        group.flatMap((x) => (x.source === 'annotation' && x.page === pageNumber ? [x.index] : []))
      )
      let delta: Point | null = null
      gesture(
        (e) => {
          const p = pagePoint(e.clientX, e.clientY)
          delta = { x: p.x - start.x, y: p.y - start.y }
          setMoving({
            markup: markupIds,
            annotations: annotationIndexes,
            dx: delta.x,
            dy: delta.y
          })
        },
        () => {
          setMoving(null)
          const moved = delta !== null && Math.hypot(delta.x, delta.y) * scale >= 1
          if (!delta || !moved) {
            if (group.length > 1) actions.select(target)
            return
          }
          // Объекты разметки группы не уходят за край страницы: сдвиг ограничивается.
          const base = delta
          const members = objects.filter((o) => markupIds.has(o.id))
          let shift = base
          if (members.length > 0) {
            const moved = members.map((o) => visualBounds(moveObject(o, base.x, base.y)))
            const fix = shiftInside(unionRects(moved), geometry.box)
            shift = { x: base.x + fix.x, y: base.y + fix.y }
          }
          const single = group.length === 1 ? objects.find((o) => o.id === target.id) : undefined
          if (single) actions.updateMarkup(moveObject(single, shift.x, shift.y))
          else actions.moveSelected(shift.x, shift.y)
        }
      )
    },
    [actions, gesture, geometry.box, objects, pageNumber, pagePoint, scale]
  )

  /** Shift и протяжка по пустому месту: всё, что целиком внутри рамки (с Ctrl — добавить). */
  const startMarquee = useCallback(
    (event: PointerEvent, existing: readonly SelectionTarget[]) => {
      const start = viewPoint(event.clientX, event.clientY)
      const additive = event.ctrlKey || event.metaKey
      gesture(
        (e) => {
          setMarquee(rectFromPoints(start, viewPoint(e.clientX, e.clientY)))
        },
        (e) => {
          setMarquee(null)
          const view = rectFromPoints(start, viewPoint(e.clientX, e.clientY))
          if (Math.max(view.width, view.height) < CLICK_DISTANCE) {
            if (!additive) actions.select(null)
            return
          }
          const area = transformRect(inverse, view)
          const found: SelectionTarget[] = [
            ...objects
              .filter((o) => containsRect(area, visualBounds(o)))
              .map((o): SelectionTarget => ({ source: 'markup', id: o.id })),
            ...annotations
              .filter((a) => containsRect(area, a.rect))
              .map((a) => annotationTarget(pageNumber, a))
          ]
          const base = additive ? existing : []
          actions.selectGroup([...base, ...found.filter((x) => !hasTarget(base, x))])
        }
      )
    },
    [actions, annotations, gesture, inverse, objects, pageNumber, viewPoint]
  )

  // Текущая группа нужна обработчикам страницы без их пересоздания на каждый выбор.
  const groupRef = useRef<{ selected: readonly SelectionTarget[]; size: number }>({
    selected,
    size: groupSize
  })
  useLayoutEffect(() => {
    groupRef.current = { selected, size: groupSize }
  })

  // «Выделение»: выбор, группа, перенос, рамка с Shift и правка текста двойным щелчком.
  useEffect(() => {
    const page = rootRef.current?.parentElement
    if (!page || tool !== 'select') return
    const hit = (event: MouseEvent): SelectionTarget | null =>
      hitSources(
        sources,
        pageNumber,
        pagePoint(event.clientX, event.clientY),
        HIT_TOLERANCE / scale
      )
    const movable = (target: SelectionTarget): boolean => {
      if (target.source === 'markup') {
        const object = objects.find((o) => o.id === target.id)
        return object !== undefined && isMovable(object)
      }
      if (target.source !== 'annotation') return false
      const { index } = target
      return annotations.some((a) => a.index === index && a.can.move)
    }
    const isOwnControl = (event: Event): boolean =>
      event.target instanceof Element &&
      event.target.closest('[data-markup-handle], [data-markup-editor]') !== null
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0 || isOwnControl(event)) return
      const target = hit(event)
      const { selected: mine, size } = groupRef.current
      if (!target) {
        if (event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          window.getSelection()?.removeAllRanges()
          startMarquee(event, mine)
          return
        }
        // Снимает выбор и на других страницах; повторный null состояние не меняет.
        actions.select(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
      if (event.ctrlKey || event.metaKey) {
        actions.toggleSelected(target)
        return
      }
      const inGroup = size > 1 && hasTarget(mine, target)
      if (!inGroup) actions.select(target)
      if (inGroup || movable(target)) startMove(event, target, inGroup ? mine : [target])
    }
    // Нажатие на объект (и рамка с Shift) не должно начинать выделение текста под ним.
    const onMouseDown = (event: MouseEvent): void => {
      if (!isOwnControl(event) && (hit(event) || event.shiftKey)) event.preventDefault()
    }
    const onDoubleClick = (event: MouseEvent): void => {
      const target = hit(event)
      const object =
        target?.source === 'markup' ? objects.find((o) => o.id === target.id) : undefined
      if (object?.kind === 'text' || object?.kind === 'note') {
        event.preventDefault()
        setEditing({ object, isNew: false })
      }
    }
    const onHover = (event: PointerEvent): void => {
      if (event.buttons !== 0) return
      const target = hit(event)
      page.classList.toggle(s.hoverObject ?? '', target !== null)
      setHovered((current) => (current?.id === target?.id ? current : target))
    }
    const onLeave = (): void => {
      setHovered(null)
    }
    page.addEventListener('pointerdown', onDown, true)
    page.addEventListener('mousedown', onMouseDown, true)
    page.addEventListener('dblclick', onDoubleClick, true)
    page.addEventListener('pointermove', onHover)
    page.addEventListener('pointerleave', onLeave)
    return () => {
      page.removeEventListener('pointerdown', onDown, true)
      page.removeEventListener('mousedown', onMouseDown, true)
      page.removeEventListener('dblclick', onDoubleClick, true)
      page.removeEventListener('pointermove', onHover)
      page.removeEventListener('pointerleave', onLeave)
      page.classList.remove(s.hoverObject ?? '')
    }
  }, [
    tool,
    sources,
    objects,
    annotations,
    pageNumber,
    pagePoint,
    scale,
    actions,
    startMove,
    startMarquee
  ])

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
    } else if (tool === 'text' || tool === 'note') {
      if (editingRef.current) {
        finishEditing()
        return
      }
      // Редактор на другой странице закрывается по потере фокуса.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      // Щелчок по уже поставленному блоку того же вида открывает его правку, а не новый поверх.
      const existing = hitTest(objects, pageNumber, start, HIT_TOLERANCE / scale)
      if (existing?.kind === tool) {
        setEditing({ object: existing, isNew: false })
        return
      }
      const object: TextObject | NoteObject =
        tool === 'note'
          ? { ...base, id: newMarkupId(), kind: 'note', rect: noteRectAt(start), text: '' }
          : withText(
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
              '',
              geometry.box
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
        const resized: MarkupObject | null = result
        if (!resized) return
        // Растянутый за край объект возвращается на страницу целиком.
        const fix = shiftInside(visualBounds(resized), geometry.box)
        actions.updateMarkup(moveObject(resized, fix.x, fix.y))
      }
    )
  }

  /** Рамка аннотации документа за ручку: новая /Rect, геометрию пересчитывает движок. */
  const startAnnotationResize = (
    event: React.PointerEvent,
    annotation: PageAnnotation,
    handle: FrameHandle
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const frame = transformRect(matrix, annotation.rect)
    let rect: Rect | null = null
    gesture(
      (e) => {
        const view = dragFrame(frame, handle, viewPoint(e.clientX, e.clientY), {
          min: 4 * scale,
          keepAspect: annotation.subtype === 'Stamp' && !e.shiftKey
        })
        rect = transformRect(inverse, view)
        setResizing({ index: annotation.index, rect })
      },
      () => {
        setResizing(null)
        if (rect) actions.editAnnotation(pageNumber, annotation.index, { rect })
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
    let list = objects.map((o) => (o.id === preview?.id ? preview : o))
    if (preview && !objects.some((o) => o.id === preview.id)) list.push(preview)
    if (moving) {
      list = list.map((o) =>
        moving.markup.has(o.id) && isMovable(o) ? moveObject(o, moving.dx, moving.dy) : o
      )
    }
    if (editing?.object.kind === 'note') {
      // Новая заметка видна, пока пишут её текст; у старой текст меняется на лету.
      const note = editing.object
      return list.some((o) => o.id === note.id)
        ? list.map((o) => (o.id === note.id ? note : o))
        : [...list, note]
    }
    return editing ? list.filter((o) => o.id !== editing.object.id) : list
  }, [objects, preview, moving, editing])

  /** Рамка аннотации на экране с учётом переноса или изменения размера. */
  const annotationRect = (a: PageAnnotation): Rect => {
    if (resizing?.index === a.index) return resizing.rect
    if (moving?.annotations.has(a.index) && a.can.move) {
      return { ...a.rect, x: a.rect.x + moving.dx, y: a.rect.y + moving.dy }
    }
    return a.rect
  }

  const highlights = shown.filter((o) => o.kind === 'highlight')
  const drawing =
    tool === 'pen' || tool === 'shapes' || tool === 'text' || tool === 'note' || tool === 'sign'
  const gTransform = `matrix(${matrix.join(' ')})`
  const single = groupSize === 1 && tool === 'select'

  const frames: React.JSX.Element[] = []
  const frameStyle = (bounds: Rect): React.CSSProperties => ({
    left: bounds.x - 3,
    top: bounds.y - 3,
    width: bounds.width + 6,
    height: bounds.height + 6
  })
  for (const target of selected) {
    if (target.source === 'markup') {
      const object = shown.find((o) => o.id === target.id)
      if (!object || editing?.object.id === object.id) continue
      const bounds = transformRect(matrix, visualBounds(object))
      frames.push(
        <div
          key={target.id}
          className={s.frame}
          style={frameStyle(bounds)}
          data-markup-selected={object.kind}
        />
      )
      if (!single) continue
      if (object.kind === 'line' || object.kind === 'arrow') {
        for (const end of ['from', 'to'] as const) {
          const p = apply(matrix, object[end])
          frames.push(
            <span
              key={end}
              className={s.handle}
              data-markup-handle={end}
              style={{ left: p.x, top: p.y }}
              onPointerDown={(e) => {
                startEndpoint(e, object, end)
              }}
            />
          )
        }
      } else if (isResizable(object)) {
        const g = transformRect(matrix, geometryBounds(object))
        for (const handle of FRAME_HANDLES) {
          const p = handlePoint(g, handle)
          frames.push(
            <span
              key={handle.id}
              className={s.handle}
              data-markup-handle={handle.id}
              style={{ left: p.x, top: p.y, cursor: handle.cursor }}
              onPointerDown={(e) => {
                startResize(e, object, handle)
              }}
            />
          )
        }
      }
    } else if (target.source === 'annotation') {
      const annotation = annotations.find((a) => a.index === target.index)
      if (!annotation) continue
      const rect = annotationRect(annotation)
      const changed = rect !== annotation.rect
      const bounds = transformRect(matrix, rect)
      frames.push(
        <div
          key={target.id}
          className={cx(s.frame, changed && s.ghost)}
          style={frameStyle(bounds)}
          data-annotation-selected={annotation.subtype}
        />
      )
      if (!single || !annotation.can.resize) continue
      for (const handle of FRAME_HANDLES) {
        const p = handlePoint(bounds, handle)
        frames.push(
          <span
            key={`${target.id}:${handle.id}`}
            className={s.handle}
            data-markup-handle={handle.id}
            style={{ left: p.x, top: p.y, cursor: handle.cursor }}
            onPointerDown={(e) => {
              startAnnotationResize(e, annotation, handle)
            }}
          />
        )
      }
    }
  }

  // Подсветка объекта под указателем в «Выделении» (если он ещё не выбран).
  let hoverFrame: React.JSX.Element | null = null
  if (tool === 'select' && hovered && !hasTarget(selected, hovered) && !moving) {
    let rect: Rect | null = null
    if (hovered.source === 'markup') {
      const object = shown.find((o) => o.id === hovered.id)
      rect = object ? visualBounds(object) : null
    } else if (hovered.source === 'annotation') {
      const index = hovered.index
      rect = annotations.find((a) => a.index === index)?.rect ?? null
    }
    if (rect) {
      const view = transformRect(matrix, rect)
      hoverFrame = (
        <div className={s.hoverFrame} style={frameStyle(view)} data-hover-frame={hovered.source} />
      )
    }
  }

  const editingNote = editing?.object.kind === 'note' ? editing.object : null
  const editingText = editing?.object.kind === 'text' ? editing.object : null

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
      data-annotations={loaded ? loaded.length : undefined}
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
      {hoverFrame}
      {frames}
      {marquee && <div className={s.marquee} style={{ ...marquee }} data-marquee="" />}
      {editingText && editing && (
        <TextEditor
          editing={{ ...editing, object: editingText }}
          placement={boxPlacement(editingText, matrix, geometry, rotation, scale)}
          scale={scale}
          onChange={(text) => {
            setEditing((current) =>
              current?.object.kind === 'text'
                ? { ...current, object: withText(current.object, text, geometry.box) }
                : current
            )
          }}
          onDone={finishEditing}
        />
      )}
      {editingNote && (
        <NoteEditor
          note={editingNote}
          icon={transformRect(matrix, editingNote.rect)}
          pageWidth={size.width}
          onChange={(text) => {
            setEditing((current) =>
              current?.object.kind === 'note'
                ? { ...current, object: { ...current.object, text } }
                : current
            )
          }}
          onDone={finishEditing}
        />
      )}
    </div>
  )
})
