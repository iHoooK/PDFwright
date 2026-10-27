import { useMemo, useState } from 'react'
import { IconDocument } from '@renderer/icons'
import { Button, RadioGroup } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { activeDoc, useStore } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { PageRangeError, splitByRanges, splitEveryN, splitToPages } from '@shared/pdf-ops'
import { chunkEveryN, parsePageRanges } from '@shared/pdf-ops/ranges'
import { dirnameOf, joinPath, safeFileName, stripExtension } from '@shared/paths'
import dialogStyles from '@renderer/components/dialog.module.css'
import s from './tools.module.css'

type Mode = 'ranges' | 'every' | 'each'

interface Source {
  name: string
  path: string
  bytes: Uint8Array
  pages: number
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Разделение документа на части: по диапазонам, по N страниц или постранично. */
export function SplitDialog(): React.JSX.Element | null {
  const { state } = useStore()
  const current = activeDoc(state)
  // Форма монтируется заново при открытии и смене документа.
  return state.toolDialog === 'split' ? <SplitForm key={current?.id ?? 'none'} /> : null
}

function SplitForm(): React.JSX.Element {
  const { state, actions, api } = useStore()
  const current = activeDoc(state)
  const [source, setSource] = useState<Source | null>(() =>
    current?.status === 'ready' && current.bytes
      ? { name: current.name, path: current.path, bytes: current.bytes, pages: current.pages }
      : null
  )
  const [mode, setMode] = useState<Mode>('ranges')
  const [ranges, setRanges] = useState('')
  const [every, setEvery] = useState('1')
  const [folder, setFolder] = useState(() => (current ? dirnameOf(current.path) : ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string[] | null>(null)

  const preview = useMemo(() => {
    if (!source) return { count: 0, error: null as string | null }
    try {
      if (mode === 'each') return { count: source.pages, error: null }
      if (mode === 'every')
        return { count: chunkEveryN(source.pages, Number(every)).length, error: null }
      return {
        count: ranges.trim() ? parsePageRanges(ranges, source.pages).length : 0,
        error: null
      }
    } catch (e) {
      return { count: 0, error: e instanceof PageRangeError ? e.message : String(e) }
    }
  }, [source, mode, ranges, every])

  const pickFile = (): void => {
    void (async () => {
      const file = await api.openPdfDialog()
      if (!file) return
      try {
        const bytes = new Uint8Array((await api.readFile(file.path)).bytes)
        const { pageCount } = await import('@shared/pdf-ops')
        setSource({ name: file.name, path: file.path, bytes, pages: await pageCount(bytes) })
        setFolder(dirnameOf(file.path))
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  const chooseFolder = (): void => {
    void api.chooseFolderDialog(folder || undefined).then((picked) => {
      if (picked !== null) setFolder(picked)
    })
  }

  const run = (): void => {
    if (!source) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const parts =
          mode === 'each'
            ? await splitToPages(source.bytes)
            : mode === 'every'
              ? await splitEveryN(source.bytes, Number(every))
              : await splitByRanges(source.bytes, ranges)
        const base = stripExtension(source.name)
        const files = parts.map((part) => ({
          path: joinPath(folder, safeFileName(t.tools.partName(base, part.from, part.to))),
          bytes: toArrayBuffer(part.bytes)
        }))
        // Существующие файлы не перезаписываются: занятое имя получает « (2)».
        const written = await api.writeFiles(files, { unique: true })
        setDone(written)
        actions.toast(t.tools.splitDone(written.length))
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
      title={t.tools.splitTitle}
      width={560}
      onClose={close}
      footer={
        done ? (
          <>
            <Button
              onClick={() => {
                const first = done[0]
                if (first !== undefined) void api.showItemInFolder(first)
              }}
            >
              {t.tools.showInFolder}
            </Button>
            <Button variant="primary" onClick={close}>
              {t.properties.close}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{t.confirm.cancel}</Button>
            <Button
              variant="primary"
              onClick={run}
              disabled={busy || !source || preview.count === 0 || folder.length === 0}
            >
              {t.tools.splitRun}
            </Button>
          </>
        )
      }
    >
      <p className={s.lead}>{t.tools.splitLead}</p>
      <div className={s.field}>
        <span className={s.label}>{t.tools.splitSource}</span>
        <div className={s.row}>
          {source ? (
            <span className={s.source}>
              <IconDocument />
              <span className={s.name}>{source.name}</span>
              <span className={s.meta}>{t.tools.pagesCount(source.pages)}</span>
            </span>
          ) : null}
          <Button onClick={pickFile} disabled={busy}>
            {t.tools.chooseFile}
          </Button>
        </div>
      </div>
      <div className={s.field}>
        <span className={s.label}>{t.tools.splitMode}</span>
        <RadioGroup
          label={t.tools.splitMode}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ranges', label: t.tools.modeRanges },
            { value: 'every', label: t.tools.modeEvery },
            { value: 'each', label: t.tools.modeEach }
          ]}
        />
      </div>
      {mode === 'ranges' && (
        <label className={s.field}>
          <span className={s.label}>{t.tools.rangesLabel}</span>
          <input
            className={dialogStyles.input}
            value={ranges}
            placeholder="1-3, 5, 7-"
            onChange={(event) => {
              setRanges(event.target.value)
            }}
          />
        </label>
      )}
      {mode === 'every' && (
        <label className={s.field}>
          <span className={s.label}>{t.tools.everyLabel}</span>
          <input
            className={dialogStyles.input}
            type="number"
            min={1}
            value={every}
            onChange={(event) => {
              setEvery(event.target.value)
            }}
          />
        </label>
      )}
      <div className={s.field}>
        <span className={s.label}>{t.tools.folder}</span>
        <div className={s.row}>
          <span className={s.path} title={folder}>
            {folder || '—'}
          </span>
          <Button onClick={chooseFolder} disabled={busy}>
            {t.tools.chooseFolder}
          </Button>
        </div>
      </div>
      <p className={s.meta}>{preview.error ?? t.tools.preview(preview.count)}</p>
      {error !== null && <p className={s.error}>{error}</p>}
      {done && (
        <ul className={s.doneList}>
          {done.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
