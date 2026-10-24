import { useState } from 'react'
import { IconAdd, IconChevronDown, IconClose, IconDocument } from '@renderer/icons'
import { Button, IconButton } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { activeDoc, useStore } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { mergeDocuments, pageCount } from '@shared/pdf-ops'
import { dirnameOf, joinPath } from '@shared/paths'
import s from './tools.module.css'

interface Item {
  key: string
  name: string
  path: string
  bytes: Uint8Array
  pages: number | null
}

let itemKey = 0

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Объединение нескольких PDF в новый файл в заданном порядке. */
export function MergeDialog(): React.JSX.Element | null {
  const { state } = useStore()
  // Форма монтируется заново при каждом открытии: состояние списка сбрасывается само.
  return state.toolDialog === 'merge' ? <MergeForm /> : null
}

function MergeForm(): React.JSX.Element {
  const { state, actions, api } = useStore()
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = activeDoc(state)

  const addItems = (files: { name: string; path: string; bytes: Uint8Array }[]): void => {
    const added = files.map<Item>((f) => ({
      key: `m${++itemKey}`,
      name: f.name,
      path: f.path,
      bytes: f.bytes,
      pages: null
    }))
    setItems((prev) => [...prev, ...added])
    for (const item of added) {
      void pageCount(item.bytes)
        .then((pages) => {
          setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, pages } : i)))
        })
        .catch(() => {
          setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, pages: 0 } : i)))
        })
    }
  }

  const addFiles = (): void => {
    void (async () => {
      const picked = await api.openPdfsDialog()
      const loaded: { name: string; path: string; bytes: Uint8Array }[] = []
      for (const file of picked) {
        try {
          loaded.push({
            name: file.name,
            path: file.path,
            bytes: new Uint8Array((await api.readFile(file.path)).bytes)
          })
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
      addItems(loaded)
    })()
  }

  const addCurrent = (): void => {
    if (current?.bytes) addItems([{ name: current.name, path: current.path, bytes: current.bytes }])
  }

  const move = (index: number, delta: -1 | 1): void => {
    setItems((prev) => {
      const next = [...prev]
      const target = index + delta
      const a = next[index]
      const b = next[target]
      if (!a || !b) return prev
      next[index] = b
      next[target] = a
      return next
    })
  }

  const run = (): void => {
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const bytes = await mergeDocuments(items.map((i) => i.bytes))
        const first = items[0]
        const path = await api.savePdfDialog({
          title: t.tools.mergeTitle,
          defaultPath: joinPath(first ? dirnameOf(first.path) : '', t.tools.mergeDefaultName)
        })
        if (path === null) return
        await api.writeFile({ path, bytes: toArrayBuffer(bytes), backup: false })
        actions.toast(t.tools.merged(items.length, path))
        actions.openTool(null)
        actions.openPath(path)
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
      title={t.tools.mergeTitle}
      width={560}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t.confirm.cancel}</Button>
          <Button variant="primary" onClick={run} disabled={busy || items.length < 2}>
            {t.tools.mergeRun}
          </Button>
        </>
      }
    >
      <p className={s.lead}>{t.tools.mergeLead}</p>
      <div className={s.row}>
        <Button icon={<IconAdd />} onClick={addFiles} disabled={busy}>
          {t.tools.addFiles}
        </Button>
        {current?.bytes && !items.some((i) => i.path === current.path) && (
          <Button icon={<IconDocument />} onClick={addCurrent} disabled={busy}>
            {t.tools.addCurrent}
          </Button>
        )}
      </div>
      <ol className={s.list} aria-label={t.tools.mergeTitle}>
        {items.length === 0 && <li className={s.empty}>{t.tools.mergeEmpty}</li>}
        {items.map((item, index) => (
          <li key={item.key} className={s.item}>
            <span className={s.index}>{index + 1}</span>
            <span className={s.itemText}>
              <span className={s.name}>{item.name}</span>
              <span className={s.meta}>
                {item.pages === null ? t.tools.reading : t.tools.pagesCount(item.pages)} ·{' '}
                {item.path}
              </span>
            </span>
            <IconButton
              label={t.tools.moveUp}
              small
              disabled={index === 0}
              onClick={() => {
                move(index, -1)
              }}
            >
              <IconChevronDown style={{ transform: 'rotate(180deg)' }} />
            </IconButton>
            <IconButton
              label={t.tools.moveDown}
              small
              disabled={index === items.length - 1}
              onClick={() => {
                move(index, 1)
              }}
            >
              <IconChevronDown />
            </IconButton>
            <IconButton
              label={t.tools.removeItem}
              small
              onClick={() => {
                setItems((prev) => prev.filter((i) => i.key !== item.key))
              }}
            >
              <IconClose />
            </IconButton>
          </li>
        ))}
      </ol>
      {error !== null && <p className={s.error}>{error}</p>}
    </Dialog>
  )
}
