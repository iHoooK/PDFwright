import { useEffect, useMemo, useState } from 'react'
import { Button, Toggle } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { useStore, type ConvertSource } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { pdfContent } from '@renderer/pdf-content/client'
import {
  encodeTextFile,
  isBlankText,
  joinPagesText,
  type PageText
} from '@shared/convert/text-file'
import { basenameOf, dirnameOf, joinPath, safeFileName, stripExtension } from '@shared/paths'
import ts from '@renderer/features/tools/tools.module.css'
import { PagesField, SourceField, toArrayBuffer, useConvertSource, usePages } from './SourceField'
import s from './convert.module.css'

/** Предпросмотр показывает начало текста: огромный textarea тормозит окно. */
const PREVIEW_CHARS = 100_000

interface Extracted {
  for: ConvertSource
  pages: readonly number[]
  texts: PageText[]
}

/** «Извлечь текст»: текст страниц в буфер обмена или в .txt (UTF-8 с BOM). */
export function ExtractTextDialog(): React.JSX.Element {
  const { actions, api } = useStore()
  const source = useConvertSource()
  const doc = source.source
  // Запрет копирования владельцем распространяется и на извлечение текста.
  const blocked = doc?.noCopy === true
  const pages = usePages(doc?.pages ?? 0)
  const [markPages, setMarkPages] = useState(false)
  const [extracted, setExtracted] = useState<Extracted | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Текст читается в worker'е MuPDF; ввод диапазона не дёргает его на каждую букву.
  useEffect(() => {
    if (!doc || blocked || pages.pages.length === 0) return
    let alive = true
    const list = pages.pages
    const timer = window.setTimeout(() => {
      pdfContent
        .extractText(
          doc.bytes,
          list.map((p) => p - 1)
        )
        .then(
          (texts) => {
            if (!alive) return
            setExtracted({
              for: doc,
              pages: list,
              texts: texts.map((text, i) => ({ page: list[i] ?? 0, text }))
            })
            setError(null)
          },
          (e: unknown) => {
            if (alive) setError(e instanceof Error ? e.message : String(e))
          }
        )
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [doc, blocked, pages.pages])

  const current = extracted?.for === doc && extracted.pages === pages.pages ? extracted : null
  const text = useMemo(
    () => (current ? joinPagesText(current.texts, markPages) : ''),
    [current, markPages]
  )
  const blank = current ? isBlankText(current.texts) : false
  const ready = current !== null && !blank

  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => {
        actions.toast(t.convert.copied)
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      }
    )
  }

  const save = (): void => {
    if (!doc) return
    void (async () => {
      setSaving(true)
      try {
        const name = `${safeFileName(stripExtension(doc.name))}.txt`
        const path = await api.saveTextDialog({
          title: t.convert.saveTextTitle,
          defaultPath: doc.path ? joinPath(dirnameOf(doc.path), name) : name
        })
        if (path === null) return
        await api.writeFiles([{ path, bytes: toArrayBuffer(encodeTextFile(text)) }])
        actions.toast(t.convert.textSaved(basenameOf(path)))
        actions.openTool(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    })()
  }

  const close = (): void => {
    actions.openTool(null)
  }

  const reading =
    doc !== null && !blocked && pages.pages.length > 0 && current === null && error === null

  return (
    <Dialog
      open
      title={t.convert.textTitle}
      width={600}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t.confirm.cancel}</Button>
          <Button onClick={copy} disabled={!ready || saving}>
            {t.convert.copy}
          </Button>
          <Button variant="primary" onClick={save} disabled={!ready || saving}>
            {t.convert.saveText}
          </Button>
        </>
      }
    >
      <p className={ts.lead}>{t.convert.textLead}</p>
      <SourceField state={source} disabled={saving} />
      <PagesField state={pages} />
      <div className={ts.field}>
        <span className={ts.label}>{t.convert.markPages}</span>
        <div>
          <Toggle
            checked={markPages}
            onChange={setMarkPages}
            onLabel={t.convert.markPagesOn}
            offLabel={t.convert.markPagesOff}
          />
        </div>
      </div>
      <textarea
        className={s.text}
        readOnly
        aria-label={t.convert.textTitle}
        value={reading ? t.convert.textReading : text.slice(0, PREVIEW_CHARS)}
      />
      <p className={s.hint}>
        {blank
          ? t.convert.textEmpty
          : current
            ? t.convert.textStats(text.length, current.texts.length)
            : ' '}
      </p>
      {blocked && <p className={ts.error}>{t.protect.copyBlocked}</p>}
      {(error ?? source.error) !== null && <p className={ts.error}>{error ?? source.error}</p>}
    </Dialog>
  )
}
