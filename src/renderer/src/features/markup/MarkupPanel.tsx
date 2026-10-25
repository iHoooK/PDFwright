import { useRef, useState } from 'react'
import { resizeBoxKeepingOrigin } from '@shared/markup/geometry'
import { type MarkupObject, type ShapeKind, type TextMarkKind } from '@shared/markup/model'
import { layoutText } from '@shared/markup/text-layout'
import type { MarkupSaveMode } from '@shared/settings-schema'
import { IconAdd, IconDelete, IconImage } from '@renderer/icons'
import { t } from '@renderer/i18n'
import {
  Button,
  Command,
  IconButton,
  RadioGroup,
  Range,
  Swatches
} from '@renderer/components/controls'
import {
  activeDoc,
  INK_COLORS,
  MARKER_COLORS,
  useStore,
  type StyledTool,
  type Tool,
  type ToolStyle
} from '@renderer/app/store'
import v from '@renderer/features/viewer/viewer.module.css'
import { measureText } from './font'
import { readImageFile } from './images'
import { SignatureDialog } from './SignatureDialog'
import s from './markup.module.css'

const MARK_KINDS: readonly { value: TextMarkKind; label: string }[] = [
  { value: 'highlight', label: t.markup.highlight },
  { value: 'underline', label: t.markup.underline },
  { value: 'strikeout', label: t.markup.strikeout }
]

const SHAPE_KINDS: readonly { value: ShapeKind; label: string }[] = [
  { value: 'rect', label: t.markup.rect },
  { value: 'ellipse', label: t.markup.ellipse },
  { value: 'line', label: t.markup.line },
  { value: 'arrow', label: t.markup.arrow }
]

const SAVE_MODES: readonly { value: MarkupSaveMode; label: string }[] = [
  { value: 'annotation', label: t.props.asAnnotation },
  { value: 'content', label: t.props.asContent }
]

function objectName(o: MarkupObject): string {
  return o.kind === 'image' && o.signature ? t.markup.objects.signature : t.markup.objects[o.kind]
}

interface StyleFieldsProps {
  idPrefix: string
  colors: readonly string[]
  value: { color: string; opacity: number; width?: number; fontSize?: number }
  onChange: (patch: Partial<ToolStyle>) => void
}

/** Цвет, непрозрачность, толщина или кегль — для инструмента и для выбранного объекта. */
function StyleFields({ idPrefix, colors, value, onChange }: StyleFieldsProps): React.JSX.Element {
  const opacity = Math.round(value.opacity * 100)
  return (
    <>
      {colors.length > 0 && (
        <div className={v.field}>
          <span className={v.fieldLabel}>{t.props.color}</span>
          <Swatches
            colors={colors}
            value={value.color}
            onChange={(color) => {
              onChange({ color })
            }}
            label={t.props.color}
          />
        </div>
      )}
      {value.width !== undefined && (
        <div className={v.field}>
          <label htmlFor={`${idPrefix}-width`}>
            {t.props.width} · {value.width.toLocaleString('ru-RU')} пт
          </label>
          <Range
            id={`${idPrefix}-width`}
            min={0.5}
            max={12}
            step={0.5}
            value={value.width}
            onChange={(event) => {
              onChange({ width: Number(event.target.value) })
            }}
          />
        </div>
      )}
      {value.fontSize !== undefined && (
        <div className={v.field}>
          <label htmlFor={`${idPrefix}-size`}>
            {t.props.fontSize} · {Math.round(value.fontSize)} пт
          </label>
          <Range
            id={`${idPrefix}-size`}
            min={6}
            max={72}
            step={1}
            value={Math.round(value.fontSize)}
            onChange={(event) => {
              onChange({ fontSize: Number(event.target.value) })
            }}
          />
        </div>
      )}
      <div className={v.field}>
        <label htmlFor={`${idPrefix}-opacity`}>
          {t.props.opacity} · {opacity}%
        </label>
        <Range
          id={`${idPrefix}-opacity`}
          min={10}
          max={100}
          value={opacity}
          onChange={(event) => {
            onChange({ opacity: Number(event.target.value) / 100 })
          }}
        />
      </div>
    </>
  )
}

function ObjectCard({ object }: { object: MarkupObject }): React.JSX.Element {
  const { actions } = useStore()
  const colors =
    object.kind === 'image' ? [] : object.kind === 'highlight' ? MARKER_COLORS : INK_COLORS
  const hasWidth =
    object.kind === 'ink' ||
    object.kind === 'rect' ||
    object.kind === 'ellipse' ||
    object.kind === 'line' ||
    object.kind === 'arrow'
  const update = (patch: Partial<ToolStyle>, key: string): void => {
    let next: MarkupObject = object
    if (patch.color !== undefined) next = { ...next, color: patch.color }
    if (patch.opacity !== undefined) next = { ...next, opacity: patch.opacity }
    if (patch.width !== undefined && hasWidth && 'width' in next)
      next = { ...next, width: patch.width }
    if (patch.fontSize !== undefined && next.kind === 'text') {
      const layout = layoutText(next.text, patch.fontSize, measureText)
      next = {
        ...next,
        fontSize: patch.fontSize,
        rect: resizeBoxKeepingOrigin(next.rect, next.rotate, layout.width, layout.height)
      }
    }
    actions.updateMarkup(next, key)
  }
  return (
    <div className={v.pcard} data-markup-props={object.kind}>
      {object.kind === 'text' && (
        <div className={v.field}>
          <label htmlFor="markup-text">{t.props.text}</label>
          <textarea
            id="markup-text"
            className={s.textField}
            value={object.text}
            rows={Math.min(6, Math.max(2, object.text.split('\n').length))}
            onChange={(event) => {
              const text = event.target.value
              const layout = layoutText(text, object.fontSize, measureText)
              actions.updateMarkup(
                {
                  ...object,
                  text,
                  rect: resizeBoxKeepingOrigin(
                    object.rect,
                    object.rotate,
                    layout.width,
                    layout.height
                  )
                },
                'text'
              )
            }}
          />
        </div>
      )}
      <StyleFields
        idPrefix="object"
        colors={colors}
        value={{
          color: object.color,
          opacity: object.opacity,
          ...(hasWidth && 'width' in object ? { width: object.width } : {}),
          ...(object.kind === 'text' ? { fontSize: object.fontSize } : {})
        }}
        onChange={(patch) => {
          update(patch, Object.keys(patch).join(','))
        }}
      />
      <div>
        <Button
          icon={<IconDelete />}
          onClick={() => {
            actions.removeMarkup(object.id)
          }}
        >
          {t.props.remove}
        </Button>
      </div>
    </div>
  )
}

function SignaturesCard(): React.JSX.Element {
  const { state, actions } = useStore()
  const [drawing, setDrawing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const signatures = state.settings.markup.signatures
  const active = state.activeSignature ?? signatures[0]?.id ?? null
  return (
    <div className={v.pcard}>
      <b style={{ fontWeight: 600 }}>{t.markup.signatures}</b>
      {signatures.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {t.markup.signaturesEmpty}
        </p>
      ) : (
        <div className={s.signatures} role="radiogroup" aria-label={t.markup.signatures}>
          {signatures.map((sig, i) => (
            <div key={sig.id} className={s.signature}>
              <button
                type="button"
                role="radio"
                aria-checked={sig.id === active}
                aria-label={t.markup.signatureItem(i + 1)}
                className={s.signatureButton}
                onClick={() => {
                  actions.setActiveSignature(sig.id)
                }}
              >
                <img src={sig.src} alt="" draggable={false} />
              </button>
              <IconButton
                small
                label={t.markup.removeSignature}
                onClick={() => {
                  actions.removeSignature(sig.id)
                }}
              >
                <IconDelete />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          icon={<IconAdd />}
          onClick={() => {
            setDrawing(true)
          }}
        >
          {t.markup.drawSignature}
        </Button>
        <Button
          icon={<IconImage />}
          onClick={() => {
            fileRef.current?.click()
          }}
        >
          {t.markup.uploadSignature}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png"
        hidden
        data-signature-input=""
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          readImageFile(file, 'png').then(actions.addSignature, (error: unknown) => {
            actions.toast(error instanceof Error ? error.message : String(error))
          })
        }}
      />
      {drawing && (
        <SignatureDialog
          open
          onClose={() => {
            setDrawing(false)
          }}
          onSave={(src) => {
            setDrawing(false)
            actions.addSignature(src)
          }}
        />
      )}
    </div>
  )
}

function ToolCard({ tool }: { tool: StyledTool }): React.JSX.Element {
  const { state, actions } = useStore()
  const style = state.toolStyles[tool]
  return (
    <div className={v.pcard}>
      {tool === 'marker' && (
        <div className={v.field}>
          <span className={v.fieldLabel}>{t.markup.markKind}</span>
          <RadioGroup
            value={state.markKind}
            options={MARK_KINDS}
            label={t.markup.markKind}
            onChange={actions.setMarkKind}
          />
        </div>
      )}
      {tool === 'shapes' && (
        <div className={v.field}>
          <span className={v.fieldLabel}>{t.markup.shapeKind}</span>
          <RadioGroup
            value={state.shapeKind}
            options={SHAPE_KINDS}
            label={t.markup.shapeKind}
            onChange={actions.setShapeKind}
          />
        </div>
      )}
      <StyleFields
        idPrefix={`tool-${tool}`}
        colors={tool === 'marker' ? MARKER_COLORS : INK_COLORS}
        value={{
          color: style.color,
          opacity: style.opacity,
          ...(tool === 'pen' || tool === 'shapes' ? { width: style.width } : {}),
          ...(tool === 'text' ? { fontSize: style.fontSize } : {})
        }}
        onChange={(patch) => {
          actions.setToolStyle(tool, patch)
        }}
      />
    </div>
  )
}

function isStyled(tool: Tool): tool is StyledTool {
  return tool === 'marker' || tool === 'pen' || tool === 'shapes' || tool === 'text'
}

/**
 * Панель свойств разметки: выбранный объект, настройки текущего инструмента,
 * библиотека подписей и режим записи при сохранении.
 */
export function MarkupPanel({ toolLabel }: { toolLabel: string }): React.JSX.Element {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const selected = tab?.markup.find((o) => o.id === state.selection?.id) ?? null
  const tool = state.tool
  const showSaveMode = isStyled(tool) || tool === 'sign' || (tab?.markup.length ?? 0) > 0
  return (
    <>
      <h3>{selected ? objectName(selected) : toolLabel}</h3>
      {selected && <ObjectCard key={selected.id} object={selected} />}
      {!selected && isStyled(tool) && <ToolCard tool={tool} />}
      {tool === 'sign' && <SignaturesCard />}
      <p className={s.hint}>{t.markup.hint[tool]}</p>
      {showSaveMode && (
        <div className={v.pcard}>
          <div className={v.field}>
            <span className={v.fieldLabel}>{t.props.saveAs}</span>
            <RadioGroup
              value={state.settings.markup.saveMode}
              label={t.props.saveAs}
              options={SAVE_MODES}
              onChange={actions.setSaveMode}
            />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {t.props.saveModeHint}
          </p>
        </div>
      )}
    </>
  )
}

/** Команда «Картинка»: выбор PNG или JPEG и вставка в центр текущей страницы. */
export function ImageCommand({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { actions } = useStore()
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <Command
        icon={<IconImage />}
        label={t.markup.image}
        title={t.markup.imageHint}
        disabled={disabled}
        onClick={() => {
          ref.current?.click()
        }}
      />
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        data-image-input=""
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) actions.insertImage(file)
        }}
      />
    </>
  )
}
