import { memo } from 'react'
import {
  arrowHead,
  boxContentSize,
  textLineStroke,
  viewMatrix,
  viewSize,
  type PageGeometry
} from '@shared/markup/geometry'
import {
  isBoxObject,
  type ImageObject,
  type MarkupObject,
  type NoteObject,
  type TextObject
} from '@shared/markup/model'
import { noteIcon, noteInk } from '@shared/markup/note'
import { layoutTextObject, MARKUP_FONT_FAMILY } from '@shared/markup/text-layout'
import type { Rotation } from '@renderer/pdf-engine/engine'
import { cx } from '@renderer/components/cx'
import { measureText } from './font'
import { boxPlacement, type BoxPlacement } from './placement'
import s from './markup.module.css'

/**
 * Отрисовка объектов разметки: векторные — в координатах страницы внутри
 * группы с матрицей вида, текст и картинки — коробками в пикселях вида. Слой
 * разметки (MarkupLayer) и миниатюры страниц (MarkupPreview) рисуют одно и то же.
 */

const points = (list: readonly { x: number; y: number }[]): string =>
  list.map((p) => `${p.x},${p.y}`).join(' ')

/** Значок заметки в координатах страницы (тот же контур пишет applyMarkup). */
function NoteShape({ o }: { o: NoteObject }): React.JSX.Element {
  const icon = noteIcon(o.rect)
  const ink = noteInk(o.color)
  return (
    <g
      opacity={o.opacity}
      stroke={ink}
      strokeWidth={icon.stroke}
      strokeLinejoin="round"
      strokeLinecap="round"
      data-markup-kind="note"
    >
      <polygon points={points(icon.body)} fill={o.color} />
      <polyline points={points(icon.fold)} fill="none" />
      {icon.lines.map(([from, to], i) => (
        <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      ))}
    </g>
  )
}

/** Векторные объекты рисуются в координатах страницы внутри группы с матрицей вида. */
export function VectorObject({ o }: { o: MarkupObject }): React.JSX.Element | null {
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
            <polyline key={i} points={points(path.length === 1 ? [...path, ...path] : path)} />
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
          {head && <polyline points={points([head[0], o.to, head[1]])} />}
        </g>
      )
    }
    case 'note':
      return <NoteShape o={o} />
    case 'text':
    case 'image':
      return null
  }
}

/** Строки текстового блока в SVG размером с содержимое коробки (пункты). */
function TextLines({ o }: { o: TextObject }): React.JSX.Element {
  return (
    <>
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
    </>
  )
}

export function BoxObject({
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
            <TextLines o={o} />
          </svg>
        )}
      </div>
    </div>
  )
}

/**
 * Несохранённая разметка поверх миниатюры: одно SVG в пикселях вида при
 * масштабе 1, растянутое на всю миниатюру. Неинтерактивно.
 */
export const MarkupPreview = memo(function MarkupPreview({
  geometry,
  rotation,
  objects
}: {
  geometry: PageGeometry
  rotation: Rotation
  objects: readonly MarkupObject[]
}): React.JSX.Element {
  const turn = geometry.rotate + rotation
  const matrix = viewMatrix(geometry.box, turn, 1)
  const size = viewSize(geometry.box, turn, 1)
  const gTransform = `matrix(${matrix.join(' ')})`
  const highlights = objects.filter((o) => o.kind === 'highlight')
  const svg = {
    viewBox: `0 0 ${size.width} ${size.height}`,
    preserveAspectRatio: 'none',
    'aria-hidden': true
  } as const
  return (
    <>
      {highlights.length > 0 && (
        <svg {...svg} className={cx(s.preview, s.multiply)}>
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
      <svg {...svg} className={s.preview} data-thumb-markup={objects.length}>
        <g transform={gTransform}>
          {objects.map((o) => (
            <VectorObject key={o.id} o={o} />
          ))}
        </g>
        {objects.filter(isBoxObject).map((o) => {
          const {
            frame,
            width,
            height,
            turn: boxTurn
          } = boxPlacement(o, matrix, geometry, rotation, 1)
          const content = boxContentSize(o.rect, o.rotate)
          return (
            <g
              key={o.id}
              opacity={o.opacity}
              transform={`translate(${frame.x + frame.width / 2} ${frame.y + frame.height / 2}) rotate(${boxTurn})`}
            >
              {o.kind === 'image' ? (
                <image
                  href={o.src}
                  x={-width / 2}
                  y={-height / 2}
                  width={width}
                  height={height}
                  preserveAspectRatio="none"
                />
              ) : (
                <svg
                  x={-width / 2}
                  y={-height / 2}
                  width={width}
                  height={height}
                  viewBox={`0 0 ${content.width} ${content.height}`}
                  preserveAspectRatio="none"
                  overflow="visible"
                >
                  <TextLines o={o} />
                </svg>
              )}
            </g>
          )
        })}
      </svg>
    </>
  )
})
