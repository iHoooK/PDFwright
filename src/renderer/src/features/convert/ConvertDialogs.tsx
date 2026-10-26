import { IconCompress, IconTextFile, IconToImages } from '@renderer/icons'
import { useStore } from '@renderer/app/store'
import { OcrDialog } from '@renderer/features/ocr/OcrDialog'
import { t } from '@renderer/i18n'
import { CompressDialog } from './CompressDialog'
import { ExtractTextDialog } from './ExtractTextDialog'
import { FromImagesDialog } from './FromImagesDialog'
import { ToImagesDialog } from './ToImagesDialog'
import s from './convert.module.css'

/**
 * Диалоги конвертации. Подключены в оболочке окна, поэтому открываются и со
 * стартового экрана, и из открытого документа (меню «Инструменты»). Форма
 * монтируется заново при каждом открытии и смене документа.
 */
export function ConvertDialogs(): React.JSX.Element | null {
  const { state } = useStore()
  const key = state.activeId ?? 'none'
  switch (state.toolDialog) {
    case 'toImages':
      return <ToImagesDialog key={key} />
    case 'fromImages':
      return <FromImagesDialog />
    case 'extractText':
      return <ExtractTextDialog key={key} />
    case 'compress':
      return <CompressDialog key={key} />
    case 'ocr':
      return <OcrDialog key={key} />
    default:
      return null
  }
}

/** Плитки инструментов конвертации на стартовом экране. */
export function ConvertTiles(): React.JSX.Element {
  const { actions } = useStore()
  const tiles = [
    {
      dialog: 'toImages',
      icon: <IconToImages />,
      title: t.convert.toImagesTitle,
      hint: t.convert.toImagesHint
    },
    {
      dialog: 'extractText',
      icon: <IconTextFile />,
      title: t.convert.textTitle,
      hint: t.convert.extractTextHint
    },
    {
      dialog: 'compress',
      icon: <IconCompress />,
      title: t.convert.compressTitle,
      hint: t.convert.compressHint
    }
  ] as const
  return (
    <section>
      <h2 className={s.sectionTitle}>{t.convert.startTitle}</h2>
      <div className={s.tiles}>
        {tiles.map((tile) => (
          <button
            key={tile.dialog}
            type="button"
            className={s.tile}
            onClick={() => {
              actions.openTool(tile.dialog)
            }}
          >
            {tile.icon}
            <b>{tile.title}</b>
            <small>{tile.hint}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
