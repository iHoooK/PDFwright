import { useEffect, useRef, useState } from 'react'
import { Button, RadioGroup, Range } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { useStore, type ConvertSource } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import {
  createCancelToken,
  loadPdfDocument,
  type CancelToken,
  type PdfDocument
} from '@renderer/pdf-engine/engine'
import {
  DPI_PRESETS,
  isValidDpi,
  MAX_DPI,
  MIN_DPI,
  pageImageName,
  pageImageSize,
  type PageImageFormat
} from '@shared/convert/page-images'
import { dirnameOf, joinPath, safeFileName, stripExtension } from '@shared/paths'
import dialogStyles from '@renderer/components/dialog.module.css'
import ts from '@renderer/features/tools/tools.module.css'
import { PageTooLargeError, renderPageImage } from './render-pages'
import {
  PagesField,
  Progress,
  SourceField,
  toArrayBuffer,
  useConvertSource,
  usePages
} from './SourceField'
import s from './convert.module.css'

type DpiChoice = '72' | '150' | '300' | 'custom'

interface Outcome {
  paths: string[]
  total: number
  stopped: boolean
}

/** «PDF в изображения»: страницы в PNG или JPEG с выбранным DPI в папку. */
export function ToImagesDialog(): React.JSX.Element {
  const { actions, api } = useStore()
  const source = useConvertSource()
  const doc = source.source
  const pages = usePages(doc?.pages ?? 0)
  const [dpiChoice, setDpiChoice] = useState<DpiChoice>('150')
  const [customDpi, setCustomDpi] = useState('200')
  const [format, setFormat] = useState<PageImageFormat>('png')
  const [quality, setQuality] = useState(85)
  const [folder, setFolder] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ for: ConvertSource; pdf: PdfDocument } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const token = useRef<CancelToken | null>(null)

  const dpi = dpiChoice === 'custom' ? Number(customDpi) : Number(dpiChoice)
  const dpiOk = isValidDpi(dpi)
  const target = folder ?? (doc?.path ? dirnameOf(doc.path) : '')
  const running = progress !== null
  const pdf = loaded?.for === doc ? loaded.pdf : null

  // Документ pdf.js для размеров и рендера; пересоздаётся при смене источника.
  useEffect(() => {
    if (!doc) return
    let alive = true
    let opened: PdfDocument | null = null
    loadPdfDocument(doc.bytes, { askPassword: () => Promise.resolve(null) }).then(
      (result) => {
        opened = result
        if (alive) setLoaded({ for: doc, pdf: result })
        else result.destroy()
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    )
    return () => {
      alive = false
      opened?.destroy()
    }
  }, [doc])

  // Закрытие окна во время выгрузки останавливает её.
  useEffect(
    () => () => {
      token.current?.cancel()
    },
    []
  )

  const first = pages.pages[0]
  const firstSize =
    pdf && first !== undefined && dpiOk
      ? pageImageSize(pdf.sizeOf(first).width, pdf.sizeOf(first).height, dpi)
      : null

  const chooseFolder = (): void => {
    void api.chooseFolderDialog(target || undefined).then((picked) => {
      if (picked !== null) setFolder(picked)
    })
  }

  const run = (): void => {
    if (!doc || !pdf || !dpiOk || pages.pages.length === 0 || target.length === 0) return
    const list = pages.pages
    const cancel = createCancelToken()
    token.current = cancel
    setError(null)
    setOutcome(null)
    setProgress({ done: 0, total: list.length })
    void (async () => {
      const base = safeFileName(stripExtension(doc.name))
      const written: string[] = []
      try {
        for (const page of list) {
          if (cancel.isCancelled()) break
          const bytes = await renderPageImage(pdf, page, { dpi, format, quality }, cancel)
          if (bytes === null) break
          const path = joinPath(target, pageImageName(base, page, doc.pages, format))
          // Существующие картинки не перезаписываются: занятое имя получает « (2)».
          const [saved] = await api.writeFiles([{ path, bytes: toArrayBuffer(bytes) }], {
            unique: true
          })
          written.push(saved ?? path)
          setProgress({ done: written.length, total: list.length })
        }
        const stopped = written.length < list.length
        setOutcome({ paths: written, total: list.length, stopped })
        if (!stopped) actions.toast(t.convert.toImagesDone(written.length))
      } catch (e) {
        setError(
          e instanceof PageTooLargeError
            ? t.convert.tooLarge(e.page)
            : e instanceof Error
              ? e.message
              : String(e)
        )
        if (written.length > 0) setOutcome({ paths: written, total: list.length, stopped: true })
      } finally {
        token.current = null
        setProgress(null)
      }
    })()
  }

  const close = (): void => {
    token.current?.cancel()
    actions.openTool(null)
  }

  const canRun =
    !running &&
    pdf !== null &&
    dpiOk &&
    pages.pages.length > 0 &&
    target.length > 0 &&
    !source.loading

  return (
    <Dialog
      open
      title={t.convert.toImagesTitle}
      width={580}
      onClose={close}
      footer={
        running ? (
          <Button
            onClick={() => {
              token.current?.cancel()
            }}
          >
            {t.convert.stop}
          </Button>
        ) : outcome && outcome.paths.length > 0 ? (
          <>
            <Button
              onClick={() => {
                const path = outcome.paths[0]
                if (path !== undefined) void api.showItemInFolder(path)
              }}
            >
              {t.convert.showInFolder}
            </Button>
            <Button onClick={run} disabled={!canRun}>
              {t.convert.toImagesRun}
            </Button>
            <Button variant="primary" onClick={close}>
              {t.convert.close}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{t.confirm.cancel}</Button>
            <Button variant="primary" onClick={run} disabled={!canRun}>
              {t.convert.toImagesRun}
            </Button>
          </>
        )
      }
    >
      <p className={ts.lead}>{t.convert.toImagesLead}</p>
      <SourceField state={source} disabled={running} />
      <PagesField state={pages} />
      <div className={ts.field}>
        <span className={ts.label}>{t.convert.dpi}</span>
        <div className={s.inline}>
          <RadioGroup
            label={t.convert.dpi}
            value={dpiChoice}
            onChange={setDpiChoice}
            options={[
              ...DPI_PRESETS.map((value) => ({
                value: String(value) as DpiChoice,
                label: t.convert.dpiPreset(value)
              })),
              { value: 'custom' as const, label: t.convert.dpiCustom }
            ]}
          />
          {dpiChoice === 'custom' && (
            <input
              className={`${dialogStyles.input} ${s.number}`}
              type="number"
              min={MIN_DPI}
              max={MAX_DPI}
              aria-label={t.convert.dpiLabel}
              value={customDpi}
              onChange={(event) => {
                setCustomDpi(event.target.value)
              }}
            />
          )}
        </div>
        <p className={s.hint}>
          {!dpiOk
            ? t.convert.dpiInvalid(MIN_DPI, MAX_DPI)
            : firstSize
              ? t.convert.pixelSize(firstSize.width, firstSize.height)
              : ' '}
        </p>
      </div>
      <div className={ts.field}>
        <span className={ts.label}>{t.convert.format}</span>
        <div className={s.inline}>
          <RadioGroup
            label={t.convert.format}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: t.convert.png },
              { value: 'jpeg', label: t.convert.jpeg }
            ]}
          />
        </div>
        {format === 'jpeg' && (
          <label className={ts.field}>
            <span className={ts.label}>{t.convert.quality(quality)}</span>
            <Range
              min={40}
              max={100}
              step={5}
              value={quality}
              onChange={(event) => {
                setQuality(Number(event.target.value))
              }}
            />
          </label>
        )}
      </div>
      <div className={ts.field}>
        <span className={ts.label}>{t.convert.folder}</span>
        <div className={ts.row}>
          <span className={ts.path} title={target}>
            {target || '—'}
          </span>
          <Button onClick={chooseFolder} disabled={running}>
            {t.convert.chooseFolder}
          </Button>
        </div>
      </div>
      {progress && <Progress done={progress.done} total={progress.total} />}
      {!running && outcome && (
        <p className={s.done}>
          {outcome.stopped
            ? t.convert.toImagesStopped(outcome.paths.length, outcome.total)
            : t.convert.toImagesDone(outcome.paths.length)}
        </p>
      )}
      {(error ?? source.error) !== null && <p className={ts.error}>{error ?? source.error}</p>}
    </Dialog>
  )
}
