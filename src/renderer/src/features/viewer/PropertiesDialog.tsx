import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { activeDoc, useStore } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { createCancelToken, type DocumentProperties } from '@renderer/pdf-engine/engine'
import s from '@renderer/components/dialog.module.css'

function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`
  return `${(size / 1024 / 1024).toFixed(1)} МБ`
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleString('ru-RU') : '—'
}

/** Свойства документа: метаданные PDF и сведения о файле. */
export function PropertiesDialog(): React.JSX.Element | null {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const [props, setProps] = useState<DocumentProperties | null>(null)
  const doc = state.propertiesOpen ? (tab?.doc ?? null) : null

  useEffect(() => {
    if (!doc) return
    const run = createCancelToken()
    void doc.getProperties().then((value) => {
      if (!run.isCancelled()) setProps(value)
    })
    return () => {
      run.cancel()
    }
  }, [doc])

  if (!tab || !doc) return null
  const size = doc.sizeOf(1)
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4)
  const rows: [string, string][] = [
    [t.properties.file, tab.name],
    [t.properties.path, tab.path],
    [t.properties.size, formatBytes(tab.fileSize)],
    [t.properties.pages, String(tab.pages)],
    [t.properties.pageSize, `${mm(size.width)} × ${mm(size.height)} мм`],
    [t.properties.title, props?.title ?? '—'],
    [t.properties.author, props?.author ?? '—'],
    [t.properties.subject, props?.subject ?? '—'],
    [t.properties.keywords, props?.keywords ?? '—'],
    [t.properties.creator, props?.creator ?? '—'],
    [t.properties.producer, props?.producer ?? '—'],
    [t.properties.created, formatDate(props?.created ?? null)],
    [t.properties.modified, formatDate(props?.modified ?? null)],
    [t.properties.version, props?.pdfVersion ? `PDF ${props.pdfVersion}` : '—'],
    [t.properties.encrypted, props ? (props.encrypted ? t.properties.yes : t.properties.no) : '—']
  ]
  return (
    <Dialog
      open
      title={t.properties.title_}
      width={560}
      onClose={actions.closeProperties}
      footer={
        <Button variant="primary" onClick={actions.closeProperties}>
          {t.properties.close}
        </Button>
      }
    >
      <dl className={s.props}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
