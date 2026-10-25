import { useRef, useState } from 'react'
import type { PageImage, PageTextLine } from '@shared/pdf-content/types'
import { IconDelete, IconImage } from '@renderer/icons'
import { t } from '@renderer/i18n'
import { Button, RadioGroup } from '@renderer/components/controls'
import { activeDoc, useStore, type ContentMode } from '@renderer/app/store'
import type { SelectionTarget } from '@renderer/features/markup/selection'
import v from '@renderer/features/viewer/viewer.module.css'
import { usePageObjects } from './page-objects'
import s from './content.module.css'

type ContentTarget = Extract<SelectionTarget, { source: 'content' }>

const MODES: readonly { value: ContentMode; label: string }[] = [
  { value: 'objects', label: t.content.modeObjects },
  { value: 'erase', label: t.content.modeErase }
]

/** Имя шрифта без префикса подмножества (ABCDEF+). */
function fontLabel(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '') || '—'
}

function rgbToCss([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

function LineCard({ page, line }: { page: number; line: PageTextLine }): React.JSX.Element {
  const { actions } = useStore()
  const [text, setText] = useState(line.text)
  const size = Math.round(line.fontSize * 10) / 10
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
      <p className={s.info}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            marginRight: 6,
            borderRadius: 2,
            verticalAlign: 'middle',
            background: rgbToCss(line.color)
          }}
        />
        {t.content.font}: {t.content.fontInfo(fontLabel(line.fontName), size)}
      </p>
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

function ImageCard({ page, image }: { page: number; image: PageImage }): React.JSX.Element {
  const { actions } = useStore()
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className={v.pcard} data-content-props="image">
      <p className={s.info}>{t.content.pixels(image.pixelWidth, image.pixelHeight)}</p>
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

/** Карточка выбранной строки или картинки документа. */
export function ContentCard({ target }: { target: ContentTarget }): React.JSX.Element {
  return target.object.kind === 'text' ? (
    <LineCard key={target.id} page={target.page} line={target.object} />
  ) : (
    <ImageCard key={target.id} page={target.page} image={target.object} />
  )
}

/** Настройки инструмента «Правка»: режим щелчка, состояние страницы и предупреждение. */
export function EditToolCard(): React.JSX.Element {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const objects = usePageObjects(tab?.bytes ?? null, state.page, true)
  const empty = objects !== null && objects.lines.length === 0 && objects.images.length === 0
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
      {objects === null ? (
        <p className={s.info}>{t.content.loading}</p>
      ) : (
        empty && <p className={s.info}>{t.content.empty}</p>
      )}
      <p className={s.warning}>{t.content.warning}</p>
    </div>
  )
}
