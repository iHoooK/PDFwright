import { useEffect, useState } from 'react'
import { Button, RadioGroup } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { useStore, type ConvertSource } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { pdfContent } from '@renderer/pdf-content/client'
import type { CompressLevel, CompressResult } from '@shared/pdf-content/compress'
import { compressionGain } from '@shared/convert/compress-gain'
import { formatBytes } from '@shared/update-messages'
import { basenameOf, dirnameOf, joinPath, safeFileName, stripExtension } from '@shared/paths'
import ts from '@renderer/features/tools/tools.module.css'
import { SourceField, toArrayBuffer, useConvertSource } from './SourceField'
import s from './convert.module.css'

interface Estimates {
  for: ConvertSource
  results: Partial<Record<CompressLevel, CompressResult>>
}

/**
 * «Сжать PDF»: предпросмотр размера для выбранной степени считается сразу в
 * worker'е MuPDF; готовый результат применяется к открытому документу шагом
 * истории или сохраняется новым файлом.
 */
export function CompressDialog(): React.JSX.Element {
  const { state, actions, api } = useStore()
  const source = useConvertSource()
  const doc = source.source
  // Степень запоминается в настройках: в следующий раз диалог открывается с ней.
  const [level, setLevel] = useState<CompressLevel>(state.settings.convert.compressLevel)
  const [estimates, setEstimates] = useState<Estimates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const results = estimates?.for === doc ? estimates.results : {}
  const result = results[level] ?? null
  const measuring = doc !== null && result === null && error === null

  useEffect(() => {
    if (!doc || result !== null) return
    let alive = true
    pdfContent.compressPdf(doc.bytes, level).then(
      (computed) => {
        if (!alive) return
        setEstimates((prev) => ({
          for: doc,
          results: { ...(prev?.for === doc ? prev.results : {}), [level]: computed }
        }))
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    )
    return () => {
      alive = false
    }
  }, [doc, level, result])

  // Выигрыш меньше 1 % не предлагается: «−0 %» с активной кнопкой только путает.
  const gain = result ? compressionGain(result) : null
  const smaller = gain !== null
  const percent = gain ?? 0

  const apply = (): void => {
    if (!result || !smaller) return
    void (async () => {
      setBusy(true)
      const ok = await actions.replaceDocument(
        result.bytes,
        t.convert.applied(formatBytes(result.before), formatBytes(result.after))
      )
      setBusy(false)
      if (ok) actions.openTool(null)
    })()
  }

  const saveAs = (): void => {
    if (!doc || !result || !smaller) return
    void (async () => {
      setBusy(true)
      try {
        const name = safeFileName(t.convert.compressName(stripExtension(doc.name)))
        const path = await api.savePdfDialog({
          title: t.convert.compressSaveTitle,
          defaultPath: doc.path ? joinPath(dirnameOf(doc.path), name) : name
        })
        if (path === null) return
        await api.writeFile({ path, bytes: toArrayBuffer(result.bytes), backup: false })
        actions.toast(t.convert.compressSaved(basenameOf(path)))
        actions.openTool(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  const close = (): void => {
    actions.openTool(null)
  }

  return (
    <Dialog
      open
      title={t.convert.compressTitle}
      width={560}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t.confirm.cancel}</Button>
          <Button onClick={saveAs} disabled={busy || !smaller}>
            {t.convert.saveAs}
          </Button>
          {source.active && (
            <Button variant="primary" onClick={apply} disabled={busy || !smaller}>
              {t.convert.apply}
            </Button>
          )}
        </>
      }
    >
      <p className={ts.lead}>{t.convert.compressLead}</p>
      <SourceField state={source} disabled={busy} />
      <div className={ts.field}>
        <span className={ts.label}>{t.convert.level}</span>
        <RadioGroup
          label={t.convert.level}
          value={level}
          onChange={(next) => {
            setError(null)
            setLevel(next)
            void actions.updateSettings({ convert: { compressLevel: next } })
          }}
          options={[
            { value: 'strong', label: t.convert.levelStrong },
            { value: 'medium', label: t.convert.levelMedium },
            { value: 'light', label: t.convert.levelLight }
          ]}
        />
      </div>
      {/* Отменить Ctrl+Z можно только применение к открытому документу. */}
      {source.active && <p className={s.warning}>{t.convert.compressWarning}</p>}
      {doc && (
        <div className={s.sizes} aria-live="polite">
          <span>
            <small>{t.convert.before}</small>
            <b>{formatBytes(doc.bytes.length)}</b>
          </span>
          <span className={s.arrow}>→</span>
          <span>
            <small>{t.convert.after}</small>
            <b>{result ? formatBytes(result.after) : '…'}</b>
          </span>
          <span className={s.gain}>{smaller ? t.convert.saving(percent) : ''}</span>
        </div>
      )}
      <p className={s.hint}>
        {measuring
          ? t.convert.measuring
          : result
            ? smaller
              ? t.convert.imagesStat(result.recompressed, result.images)
              : t.convert.notSmaller
            : ' '}
      </p>
      {(error ?? source.error) !== null && <p className={ts.error}>{error ?? source.error}</p>}
    </Dialog>
  )
}
