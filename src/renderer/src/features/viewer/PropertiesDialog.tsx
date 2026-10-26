import { useEffect, useState } from 'react'
import { METADATA_FIELDS, type DocumentMetadata } from '@shared/pdf-ops'
import { Button } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { activeDoc, useStore } from '@renderer/app/store'
import { locale, t } from '@renderer/i18n'
import { createCancelToken, type DocumentProperties } from '@renderer/pdf-engine/engine'
import s from '@renderer/components/dialog.module.css'

function formatBytes(size: number): string {
  if (size < 1024) return t.units.bytes(size)
  if (size < 1024 * 1024) return t.units.kb((size / 1024).toFixed(1))
  return t.units.mb((size / 1024 / 1024).toFixed(1))
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleString(locale) : '—'
}

const EMPTY_META: DocumentMetadata = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: ''
}

function metadataOf(props: DocumentProperties | null): DocumentMetadata {
  return {
    title: props?.title ?? '',
    author: props?.author ?? '',
    subject: props?.subject ?? '',
    keywords: props?.keywords ?? '',
    creator: props?.creator ?? ''
  }
}

/**
 * Свойства документа: сведения о файле и редактор метаданных (название,
 * автор, тема, ключевые слова, создатель). Запись и очистка — шаг истории.
 */
export function PropertiesDialog(): React.JSX.Element | null {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const [props, setProps] = useState<DocumentProperties | null>(null)
  const [draft, setDraft] = useState<DocumentMetadata>(EMPTY_META)
  const doc = state.propertiesOpen ? (tab?.doc ?? null) : null

  useEffect(() => {
    if (!doc) return
    const run = createCancelToken()
    void doc.getProperties().then((value) => {
      if (run.isCancelled()) return
      setProps(value)
      setDraft(metadataOf(value))
    })
    return () => {
      run.cancel()
    }
  }, [doc])

  if (!tab || !doc) return null
  const size = doc.sizeOf(1)
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4)
  const saved = metadataOf(props)
  const changed = METADATA_FIELDS.some((field) => draft[field].trim() !== saved[field])
  const busy = tab.busy || props === null
  const info: [string, string][] = [
    [t.properties.file, tab.name],
    [t.properties.path, tab.path],
    [t.properties.size, formatBytes(tab.fileSize)],
    [t.properties.pages, String(tab.pages)],
    [t.properties.pageSize, `${mm(size.width)} × ${mm(size.height)} ${t.units.mm}`]
  ]
  const labels: Record<keyof DocumentMetadata, string> = {
    title: t.properties.title,
    author: t.properties.author,
    subject: t.properties.subject,
    keywords: t.properties.keywords,
    creator: t.properties.creator
  }
  const technical: [string, string][] = [
    [t.properties.producer, props?.producer ?? '—'],
    [t.properties.created, formatDate(props?.created ?? null)],
    [t.properties.modified, formatDate(props?.modified ?? null)],
    [t.properties.version, props?.pdfVersion ? `PDF ${props.pdfVersion}` : '—'],
    [t.properties.encrypted, props ? (props.encrypted ? t.properties.yes : t.properties.no) : '—']
  ]
  const apply = (): void => {
    const patch: Partial<DocumentMetadata> = {}
    for (const field of METADATA_FIELDS) {
      if (draft[field].trim() !== saved[field]) patch[field] = draft[field]
    }
    void actions.setMetadata(patch).then((ok) => {
      if (ok) actions.closeProperties()
    })
  }
  const rows = (list: [string, string][]): React.JSX.Element[] =>
    list.map(([label, value]) => (
      <div key={label} style={{ display: 'contents' }}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ))
  return (
    <Dialog
      open
      title={t.properties.title_}
      width={560}
      onClose={actions.closeProperties}
      footer={
        <>
          <Button
            variant="subtle"
            title={t.forms.metaClearHint}
            disabled={busy}
            style={{ marginRight: 'auto' }}
            onClick={() => {
              void actions.clearMetadata()
            }}
          >
            {t.forms.metaClear}
          </Button>
          <Button onClick={actions.closeProperties}>
            {changed ? t.forms.metaCancel : t.properties.close}
          </Button>
          <Button variant="primary" disabled={busy || !changed} onClick={apply}>
            {t.forms.metaApply}
          </Button>
        </>
      }
    >
      <dl className={s.props}>
        {rows(info)}
        {METADATA_FIELDS.map((field) => (
          <div key={field} style={{ display: 'contents' }}>
            <dt>
              <label htmlFor={`meta-${field}`}>{labels[field]}</label>
            </dt>
            <dd>
              <input
                id={`meta-${field}`}
                name={field}
                className={s.input}
                value={draft[field]}
                disabled={busy}
                onChange={(event) => {
                  setDraft({ ...draft, [field]: event.target.value })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && changed && !busy) apply()
                }}
              />
            </dd>
          </div>
        ))}
        {rows(technical)}
      </dl>
    </Dialog>
  )
}
