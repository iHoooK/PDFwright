import { useRef, useState } from 'react'
import type {
  PageGraphic,
  PageImage,
  PageTextBlock,
  PageTextLine,
  RgbColor,
  TextStyle,
  TextStylePatch
} from '@shared/pdf-content/types'
import { fontFamily } from '@shared/pdf-content/to-unicode'
import { IconDelete, IconImage } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { Button, RadioGroup, SelectField, Swatches } from '@renderer/components/controls'
import {
  activeDoc,
  INK_COLORS,
  useStore,
  type ContentMode,
  type ContentShift
} from '@renderer/app/store'
import { contentId, type SelectionTarget } from '@renderer/features/markup/selection'
import v from '@renderer/features/viewer/viewer.module.css'
import { usePageObjects } from './page-objects'
import s from './content.module.css'

type ContentTarget = Extract<SelectionTarget, { source: 'content' }>

const SHIFTS: readonly { value: ContentShift; label: string }[] = [
  { value: 'page', label: t.content.shiftPage },
  { value: 'column', label: t.content.shiftColumn },
  { value: 'none', label: t.content.shiftNone }
]

const MODES: readonly { value: ContentMode; label: string }[] = [
  { value: 'objects', label: t.content.modeObjects },
  { value: 'text', label: t.content.modeText },
  { value: 'erase', label: t.content.modeErase }
]

function toHex([r, g, b]: RgbColor): string {
  const part = (c: number): string =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function fromHex(hex: string): RgbColor {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Шрифт, кегль и цвет текста документа. Шрифты — семейства из самого файла,
 * поэтому новый и изменённый текст набирается тем же шрифтом, что остальной.
 */
function TextStyleFields({
  idPrefix,
  style,
  fonts,
  onChange
}: {
  idPrefix: string
  style: TextStyle
  fonts: readonly string[]
  onChange: (patch: TextStylePatch) => void
}): React.JSX.Element {
  const current = fontFamily(style.fontName)
  const known = fonts.find((f) => f.startsWith(current) || current.startsWith(f)) ?? current
  const options = [...new Set([known, ...fonts])].map((f) => ({ value: f, label: f }))
  const color = toHex(style.color)
  const colors = [...new Set([color, ...INK_COLORS])]
  const [size, setSize] = useState(String(Math.round(style.fontSize * 10) / 10))
  const commitSize = (): void => {
    const value = Number(size.replace(',', '.'))
    if (
      Number.isFinite(value) &&
      value >= 4 &&
      value <= 144 &&
      Math.abs(value - style.fontSize) > 0.05
    ) {
      onChange({ fontSize: value })
    } else {
      setSize(String(Math.round(style.fontSize * 10) / 10))
    }
  }
  return (
    <>
      <div className={v.field}>
        <label htmlFor={`${idPrefix}-font`}>{t.content.fontFamily}</label>
        <SelectField
          id={`${idPrefix}-font`}
          value={known}
          options={options}
          label={t.content.fontFamily}
          onChange={(fontName) => {
            if (fontName !== known) onChange({ fontName, bold: /bold/i.test(fontName) })
          }}
        />
      </div>
      <div className={v.field}>
        <label htmlFor={`${idPrefix}-size`}>{t.content.fontSizeLabel}</label>
        <input
          id={`${idPrefix}-size`}
          className={s.lineField}
          inputMode="decimal"
          value={size}
          onChange={(event) => {
            setSize(event.target.value)
          }}
          onBlur={commitSize}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitSize()
          }}
        />
      </div>
      <div className={v.field}>
        <span className={v.fieldLabel}>{t.content.colorLabel}</span>
        <Swatches
          colors={colors}
          value={color}
          label={t.content.colorLabel}
          onChange={(hex) => {
            if (hex !== color) onChange({ color: fromHex(hex) })
          }}
        />
      </div>
    </>
  )
}

function LineCard({
  page,
  line,
  block,
  fonts
}: {
  page: number
  line: PageTextLine
  block: PageTextBlock | null
  fonts: readonly string[]
}): React.JSX.Element {
  const { actions } = useStore()
  const [text, setText] = useState(line.text)
  return (
    <div className={v.pcard} data-content-props="text">
      <div className={v.field}>
        <label htmlFor="content-line">{t.content.text}</label>
        <input
          id="content-line"
          className={s.lineField}
          value={text}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              actions.replaceContentText(page, line, text)
            }
          }}
        />
      </div>
      <TextStyleFields
        idPrefix="content-line"
        style={line}
        fonts={fonts}
        onChange={(patch) => {
          actions.replaceContentText(page, line, text, patch)
        }}
      />
      <div className={s.row}>
        <Button
          variant="primary"
          disabled={text === line.text}
          onClick={() => {
            actions.replaceContentText(page, line, text)
          }}
        >
          {t.content.apply}
        </Button>
        {block && block.lines.length > 1 && (
          <Button
            onClick={() => {
              actions.select({ source: 'content', id: contentId(page, block), page, object: block })
            }}
          >
            {t.content.wholeBlock}
          </Button>
        )}
        <Button
          icon={<IconDelete />}
          onClick={() => {
            actions.removeContent(page, line)
          }}
        >
          {t.content.removeLine}
        </Button>
      </div>
    </div>
  )
}

function BlockCard({
  page,
  block,
  fonts
}: {
  page: number
  block: PageTextBlock
  fonts: readonly string[]
}): React.JSX.Element {
  const { actions } = useStore()
  const [text, setText] = useState(block.text)
  const apply = (): void => {
    actions.replaceContentBlock(page, block, text)
  }
  return (
    <div className={v.pcard} data-content-props="block">
      <div className={v.field}>
        <label htmlFor="content-block">{t.content.blockText}</label>
        <textarea
          id="content-block"
          className={s.lineField}
          value={text}
          spellCheck={false}
          rows={Math.min(10, Math.max(3, Math.ceil(text.length / 40)))}
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
              event.preventDefault()
              apply()
            }
          }}
        />
      </div>
      <TextStyleFields
        idPrefix="content-block"
        style={block.style}
        fonts={fonts}
        onChange={(style) => {
          actions.replaceContentBlock(page, block, text, { style })
        }}
      />
      <p className={s.warning}>{t.content.blockHint}</p>
      <div className={s.row}>
        <Button variant="primary" disabled={text === block.text} onClick={apply}>
          {t.content.applyBlock}
        </Button>
        <Button
          icon={<IconDelete />}
          onClick={() => {
            actions.removeContent(page, block)
          }}
        >
          {t.content.removeBlock}
        </Button>
      </div>
    </div>
  )
}

function ImageCard({ page, image }: { page: number; image: PageImage }): React.JSX.Element {
  const { actions } = useStore()
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className={v.pcard} data-content-props="image">
      <p className={s.info}>{t.content.pixels(image.pixelWidth, image.pixelHeight)}</p>
      <p className={s.warning}>{t.content.imageHint}</p>
      <div className={s.row}>
        <Button
          icon={<IconImage />}
          onClick={() => {
            fileRef.current?.click()
          }}
        >
          {t.content.replaceImage}
        </Button>
        <Button
          icon={<IconDelete />}
          onClick={() => {
            actions.removeContent(page, image)
          }}
        >
          {t.content.removeImage}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        data-content-image-input=""
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) actions.replaceContentImage(page, image, file)
        }}
      />
    </div>
  )
}

function GraphicCard({ page, graphic }: { page: number; graphic: PageGraphic }): React.JSX.Element {
  const { actions } = useStore()
  return (
    <div className={v.pcard} data-content-props="graphic">
      <p className={s.warning}>{t.content.graphicHint}</p>
      <div className={s.row}>
        <Button
          icon={<IconDelete />}
          onClick={() => {
            actions.removeContent(page, graphic)
          }}
        >
          {t.content.removeGraphic}
        </Button>
      </div>
    </div>
  )
}

/** Карточка выбранного объекта документа. */
export function ContentCard({ target }: { target: ContentTarget }): React.JSX.Element {
  const { state } = useStore()
  const objects = usePageObjects(activeDoc(state)?.bytes ?? null, target.page, true)
  const fonts = objects?.fonts ?? []
  const { object, page } = target
  switch (object.kind) {
    case 'text': {
      const block = objects?.blocks.find((b) => b.lines.includes(object.index)) ?? null
      return <LineCard key={target.id} page={page} line={object} block={block} fonts={fonts} />
    }
    case 'block':
      return <BlockCard key={target.id} page={page} block={object} fonts={fonts} />
    case 'image':
      return <ImageCard key={target.id} page={page} image={object} />
    case 'graphic':
      return <GraphicCard key={target.id} page={page} graphic={object} />
  }
}

/** Настройки инструмента «Правка»: режим щелчка, стиль нового текста, предупреждение. */
export function EditToolCard(): React.JSX.Element {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const objects = usePageObjects(tab?.bytes ?? null, state.page, true)
  const empty =
    objects !== null &&
    objects.blocks.length === 0 &&
    objects.images.length === 0 &&
    objects.graphics.length === 0
  const style = state.contentTextStyle
  return (
    <div className={v.pcard}>
      <div className={v.field}>
        <span className={v.fieldLabel}>{t.content.modeLabel}</span>
        <RadioGroup
          value={state.contentMode}
          options={MODES}
          label={t.content.modeLabel}
          onChange={actions.setContentMode}
        />
      </div>
      {state.contentMode === 'objects' && (
        <div className={v.field}>
          <span className={v.fieldLabel}>{t.content.shiftLabel}</span>
          <RadioGroup
            value={state.contentShift}
            options={SHIFTS}
            label={t.content.shiftLabel}
            onChange={actions.setContentShift}
          />
          <p className={s.warning}>{t.content.shiftHint}</p>
        </div>
      )}
      {state.contentMode === 'text' &&
        (style ? (
          <TextStyleFields
            key={`${style.fontName}:${style.fontSize}`}
            idPrefix="content-new"
            style={style}
            fonts={objects?.fonts ?? []}
            onChange={(patch) => {
              actions.setContentTextStyle(patch)
            }}
          />
        ) : (
          <p className={s.info}>{t.content.noStyle}</p>
        ))}
      {objects === null ? (
        <p className={s.info}>{t.content.loading}</p>
      ) : (
        empty && <p className={s.info}>{t.content.empty}</p>
      )}
      <p className={s.warning}>{t.content.warning}</p>
    </div>
  )
}

/** Карточка группы объектов документа: сколько выбрано и удаление всех сразу. */
export function GroupCard(): React.JSX.Element {
  const { actions } = useStore()
  return (
    <div className={v.pcard} data-content-props="group">
      <p className={s.warning}>{t.content.groupHint}</p>
      <div className={s.row}>
        <Button icon={<IconDelete />} onClick={actions.removeSelected}>
          {t.content.removeAll}
        </Button>
      </div>
    </div>
  )
}
