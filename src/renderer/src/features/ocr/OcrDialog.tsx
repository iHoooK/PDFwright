import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, RadioGroup, Toggle } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { activeDoc, useStore } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { createCancelToken, type CancelToken, type PdfDocument } from '@renderer/pdf-engine/engine'
import { pagesFromSpec } from '@shared/convert/page-images'
import { PageRangeError } from '@shared/pdf-ops'
import { addOcrTextLayer, type OcrPageText } from '@shared/pdf-ops/ocr-layer'
import { loadMarkupFont } from '@renderer/features/markup/font'
import { PageTooLargeError, renderPageImage } from '@renderer/features/convert/render-pages'
import dialogStyles from '@renderer/components/dialog.module.css'
import ts from '@renderer/features/tools/tools.module.css'
import s from '@renderer/features/convert/convert.module.css'
import { createOcrEngine, pngSize, type OcrEngine, type OcrLanguage } from './recognize'

type PagesMode = 'all' | 'current' | 'range'
type DpiChoice = '200' | '300' | '400'

interface Running {
  /** Номер по порядку обрабатываемой страницы (с 0) и всего страниц. */
  index: number
  total: number
  /** Доля распознавания текущей страницы 0…1. */
  fraction: number
  phase: 'loading' | 'page' | 'saving'
}

/** Если страница слишком велика для выбранного разрешения — пробуем меньше. */
const FALLBACK_DPI = [150, 72]

async function hasText(pdf: PdfDocument, page: number): Promise<boolean> {
  return (await pdf.getTextItems(page)).some((item) => item.trim().length > 0)
}

async function renderForOcr(
  pdf: PdfDocument,
  page: number,
  dpi: number,
  token: CancelToken
): Promise<Uint8Array | null> {
  for (const value of [dpi, ...FALLBACK_DPI.filter((d) => d < dpi)]) {
    try {
      return await renderPageImage(pdf, page, { dpi: value, format: 'png', quality: 100 }, token)
    } catch (error) {
      if (!(error instanceof PageTooLargeError) || value === 72) throw error
    }
  }
  return null
}

/**
 * «Распознать текст…»: страницы открытого документа рисуются pdf.js в
 * картинку, tesseract.js находит на ней слова, и они дописываются невидимым
 * текстом — одним шагом истории (Ctrl+Z снимает весь слой). Страницы, где
 * текст уже есть, по умолчанию пропускаются.
 */
export function OcrDialog(): React.JSX.Element {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const pdf = tab?.status === 'ready' ? tab.doc : null
  const total = pdf ? (tab?.pages ?? 0) : 0
  const [mode, setMode] = useState<PagesMode>('all')
  const [spec, setSpec] = useState('')
  const [language, setLanguage] = useState<OcrLanguage>('rus+eng')
  const [dpi, setDpi] = useState<DpiChoice>('300')
  const [skipText, setSkipText] = useState(true)
  const [running, setRunning] = useState<Running | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef<((discard: boolean) => void) | null>(null)
  const current = Math.min(Math.max(state.page, 1), Math.max(total, 1))

  const { pages, rangeError } = useMemo(() => {
    if (total === 0) return { pages: [], rangeError: null }
    if (mode === 'current') return { pages: [current], rangeError: null }
    try {
      return { pages: pagesFromSpec(mode === 'all' ? null : spec, total), rangeError: null }
    } catch (e) {
      return { pages: [], rangeError: e instanceof PageRangeError ? e.message : String(e) }
    }
  }, [mode, spec, total, current])

  // Закрытие окна во время распознавания останавливает его без записи.
  useEffect(
    () => () => {
      stopRef.current?.(true)
    },
    []
  )

  const run = (): void => {
    if (!pdf || pages.length === 0 || running) return
    const list = pages
    const token = createCancelToken()
    // Флаги меняет кнопка «Остановить» или закрытие окна, пока цикл ждёт.
    const flags = { stopped: false, discard: false }
    let wake: () => void = () => undefined
    const stopSignal = new Promise<'stop'>((resolve) => {
      wake = () => {
        resolve('stop')
      }
    })
    stopRef.current = (drop) => {
      flags.stopped = true
      flags.discard ||= drop
      token.cancel()
      wake()
    }
    setError(null)
    setOutcome(null)
    setRunning({ index: 0, total: list.length, fraction: 0, phase: 'loading' })
    void (async () => {
      let engine: OcrEngine | null = null
      const results: OcrPageText[] = []
      let skipped = 0
      let done = 0
      try {
        const font = loadMarkupFont()
        const starting = createOcrEngine(language)
        const started = await Promise.race([starting, stopSignal])
        if (started === 'stop') {
          // Worker ещё запускается: завершаем его, когда он будет готов.
          void starting.then(
            (e) => e.terminate(),
            () => undefined
          )
        } else {
          engine = started
          for (const [index, page] of list.entries()) {
            if (flags.stopped) break
            setRunning({ index, total: list.length, fraction: 0, phase: 'page' })
            if (skipText && (await hasText(pdf, page))) {
              skipped += 1
              done += 1
              continue
            }
            const image = await renderForOcr(pdf, page, Number(dpi), token)
            if (image === null || token.isCancelled()) break
            const words = await Promise.race([
              engine.recognize(image, (fraction) => {
                setRunning({ index, total: list.length, fraction, phase: 'page' })
              }),
              stopSignal
            ])
            if (words === 'stop') break
            done += 1
            if (words.length > 0) results.push({ page, ...pngSize(image), words })
          }
        }
        if (flags.discard) return
        const partial = done < list.length
        if (results.length === 0) {
          setOutcome(
            partial
              ? t.ocr.stoppedEmpty
              : skipped === list.length
                ? t.ocr.allHaveText
                : t.ocr.nothingFound
          )
          return
        }
        setRunning({ index: list.length - 1, total: list.length, fraction: 1, phase: 'saving' })
        const { bytes: fontBytes } = await font
        const message = partial
          ? t.ocr.stopped(results.length, list.length)
          : t.ocr.done(results.length)
        const applied = await actions.applyTextLayer(
          (bytes) => addOcrTextLayer(bytes, results, { font: fontBytes }),
          message
        )
        if (applied) actions.openTool(null)
      } catch (e) {
        if (!flags.discard) setError(e instanceof Error ? e.message : String(e))
      } finally {
        void engine?.terminate()
        stopRef.current = null
        if (!flags.discard) setRunning(null)
      }
    })()
  }

  const close = (): void => {
    stopRef.current?.(true)
    actions.openTool(null)
  }

  const canRun = pdf !== null && pages.length > 0 && running === null && !tab?.busy

  const percent = running
    ? Math.round(((running.index + running.fraction) / Math.max(running.total, 1)) * 100)
    : 0

  return (
    <Dialog
      open
      title={t.ocr.title}
      width={560}
      onClose={close}
      footer={
        running ? (
          <Button
            onClick={() => {
              stopRef.current?.(false)
            }}
            disabled={running.phase === 'saving'}
          >
            {t.ocr.stop}
          </Button>
        ) : (
          <>
            <Button onClick={close}>{outcome ? t.ocr.close : t.confirm.cancel}</Button>
            <Button variant="primary" onClick={run} disabled={!canRun}>
              {t.ocr.run}
            </Button>
          </>
        )
      }
    >
      <p className={ts.lead}>{t.ocr.lead}</p>
      {pdf === null ? (
        <>
          <p className={ts.error}>{t.ocr.noDocument}</p>
          {/* Со стартового экрана: открытый документ появится в этом же окне. */}
          {tab?.status !== 'loading' && (
            <div>
              <Button
                onClick={() => {
                  void actions.openDialog()
                }}
              >
                {t.ocr.openDocument}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={ts.field}>
            <span className={ts.label}>{t.ocr.pages}</span>
            <div className={s.inline}>
              <RadioGroup
                label={t.ocr.pages}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'all', label: t.ocr.pagesAll(total) },
                  { value: 'current', label: t.ocr.pagesCurrent(current) },
                  { value: 'range', label: t.ocr.pagesRange }
                ]}
              />
            </div>
            {mode === 'range' && (
              <input
                className={dialogStyles.input}
                aria-label={t.ocr.rangeLabel}
                value={spec}
                placeholder="1-3, 5, 7-"
                disabled={running !== null}
                onChange={(event) => {
                  setSpec(event.target.value)
                }}
              />
            )}
            {mode === 'range' && spec.trim().length > 0 && (
              <p className={s.hint}>{rangeError ?? t.ocr.pagesPicked(pages.length)}</p>
            )}
          </div>
          <div className={ts.field}>
            <span className={ts.label}>{t.ocr.language}</span>
            <div className={s.inline}>
              <RadioGroup
                label={t.ocr.language}
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'rus+eng', label: t.ocr.languageBoth },
                  { value: 'rus', label: t.ocr.languageRu },
                  { value: 'eng', label: t.ocr.languageEn }
                ]}
              />
            </div>
          </div>
          <div className={ts.field}>
            <span className={ts.label}>{t.ocr.dpi}</span>
            <div className={s.inline}>
              <RadioGroup
                label={t.ocr.dpi}
                value={dpi}
                onChange={setDpi}
                options={[
                  { value: '200', label: t.ocr.dpiFast },
                  { value: '300', label: t.ocr.dpiNormal },
                  { value: '400', label: t.ocr.dpiFine }
                ]}
              />
            </div>
          </div>
          <div className={ts.field}>
            <span className={ts.label}>{t.ocr.skipText}</span>
            <div>
              <Toggle
                checked={skipText}
                onChange={setSkipText}
                onLabel={t.ocr.skipTextOn}
                offLabel={t.ocr.skipTextOff}
                disabled={running !== null}
              />
            </div>
            {/* Текст поверх уже имеющегося дублируется: поиск находит его дважды. */}
            {!skipText && (
              <p className={s.hint} data-ocr-duplicate-warning="">
                {t.ocr.duplicateWarning}
              </p>
            )}
          </div>
        </>
      )}
      {running && (
        <div className={s.progress}>
          <span>
            {running.phase === 'loading'
              ? t.ocr.loading
              : running.phase === 'saving'
                ? t.ocr.saving
                : t.ocr.progress(running.index + 1, running.total)}
          </span>
          <div
            className={s.bar}
            role="progressbar"
            aria-label={t.ocr.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <i style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {!running && outcome && <p className={s.done}>{outcome}</p>}
      {error !== null && <p className={ts.error}>{error}</p>}
    </Dialog>
  )
}
