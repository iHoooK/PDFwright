import { useEffect, useRef, useState } from 'react'
import { IconAdd, IconChevronDown, IconClose, IconGrip } from '@renderer/icons'
import { Button, IconButton, RadioGroup } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { useStore } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { imagesToPdf, type ImagePageSize } from '@shared/convert/images-to-pdf'
import { stripExtension } from '@shared/paths'
import ts from '@renderer/features/tools/tools.module.css'
import { prepareImage, type PreparedImage } from './prepare-image'
import s from './convert.module.css'

type Margin = 'none' | 'narrow' | 'normal'

const MARGIN_MM: Record<Margin, number> = { none: 0, narrow: 5, normal: 15 }

interface Item extends PreparedImage {
  key: string
  /** Адрес миниатюры (blob:), освобождается при удалении из списка. */
  url: string
}

let itemKey = 0

/** Новый порядок: элемент from встаёт перед индексом to (0..length). */
function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return [...list]
  next.splice(to > from ? to - 1 : to, 0, moved)
  return next
}

/** «Изображения в PDF»: картинки по порядку страниц, результат — новая вкладка. */
export function FromImagesDialog(): React.JSX.Element {
  const { actions, api } = useStore()
  const [items, setItems] = useState<Item[]>([])
  const [pageSize, setPageSize] = useState<ImagePageSize>('a4')
  const [margin, setMargin] = useState<Margin>('narrow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [over, setOver] = useState<{ key: string; place: 'before' | 'after' } | null>(null)
  const [dropping, setDropping] = useState(false)
  const urls = useRef(new Set<string>())

  useEffect(() => {
    const owned = urls.current
    return () => {
      for (const url of owned) URL.revokeObjectURL(url)
    }
  }, [])

  const addImages = (files: readonly { name: string; bytes: Uint8Array }[]): void => {
    void (async () => {
      const added: Item[] = []
      const failed: string[] = []
      for (const file of files) {
        try {
          const image = await prepareImage(file.name, file.bytes)
          const url = URL.createObjectURL(new Blob([image.bytes as BlobPart]))
          urls.current.add(url)
          added.push({ ...image, key: `i${++itemKey}`, url })
        } catch (e) {
          failed.push(e instanceof Error ? e.message : String(e))
        }
      }
      setItems((prev) => [...prev, ...added])
      setError(failed.length > 0 ? failed.join(' ') : null)
    })()
  }

  const pick = (): void => {
    api.openImagesDialog().then(
      (picked) => {
        addImages(picked.map((p) => ({ name: p.name, bytes: new Uint8Array(p.bytes) })))
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      }
    )
  }

  const remove = (key: string): void => {
    setItems((prev) => {
      const item = prev.find((i) => i.key === key)
      if (item) {
        URL.revokeObjectURL(item.url)
        urls.current.delete(item.url)
      }
      return prev.filter((i) => i.key !== key)
    })
  }

  const run = (): void => {
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const bytes = await imagesToPdf(items, {
          pageSize,
          marginMm: pageSize === 'a4' ? MARGIN_MM[margin] : 0
        })
        const first = items[0]
        const name =
          items.length === 1 && first
            ? `${stripExtension(first.name)}.pdf`
            : t.convert.fromImagesName
        actions.openTool(null)
        if (await actions.openNewDocument(name, bytes)) {
          actions.toast(t.convert.fromImagesDone(items.length))
        }
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

  const external = (event: React.DragEvent): boolean => event.dataTransfer.types.includes('Files')

  return (
    <Dialog
      open
      title={t.convert.fromImagesTitle}
      width={600}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t.confirm.cancel}</Button>
          <Button variant="primary" onClick={run} disabled={busy || items.length === 0}>
            {t.convert.fromImagesRun}
          </Button>
        </>
      }
    >
      <p className={ts.lead}>{t.convert.fromImagesLead}</p>
      <div className={ts.row}>
        <Button icon={<IconAdd />} onClick={pick} disabled={busy}>
          {t.convert.addImages}
        </Button>
      </div>
      <ol
        className={`${s.images} ${dropping ? s.dropping : ''}`}
        aria-label={t.convert.imagesList}
        onDragOver={(event) => {
          if (!external(event)) return
          event.preventDefault()
          event.stopPropagation()
          setDropping(true)
        }}
        onDragLeave={() => {
          setDropping(false)
        }}
        onDrop={(event) => {
          if (!external(event)) return
          event.preventDefault()
          event.stopPropagation()
          setDropping(false)
          const files = Array.from(event.dataTransfer.files)
          void Promise.all(
            files.map(async (file) => ({
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer())
            }))
          ).then(addImages)
        }}
      >
        {items.length === 0 && <li className={ts.empty}>{t.convert.imagesEmpty}</li>}
        {items.map((item, index) => (
          <li
            key={item.key}
            className={s.image}
            draggable={!busy}
            data-dragging={dragKey === item.key}
            data-over={over?.key === item.key ? over.place : undefined}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', item.key)
              setDragKey(item.key)
            }}
            onDragEnd={() => {
              setDragKey(null)
              setOver(null)
            }}
            onDragOver={(event) => {
              if (dragKey === null || external(event)) return
              event.preventDefault()
              const box = event.currentTarget.getBoundingClientRect()
              const place = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
              if (over?.key !== item.key || over.place !== place) setOver({ key: item.key, place })
            }}
            onDrop={(event) => {
              if (dragKey === null || external(event)) return
              event.preventDefault()
              const from = items.findIndex((i) => i.key === dragKey)
              const to = over?.place === 'after' ? index + 1 : index
              if (from !== -1) setItems((prev) => moveItem(prev, from, to))
              setDragKey(null)
              setOver(null)
            }}
          >
            <span className={s.grip} aria-hidden="true">
              <IconGrip />
            </span>
            <span className={ts.index}>{index + 1}</span>
            <img className={s.thumb} src={item.url} alt="" />
            <span className={ts.itemText}>
              <span className={ts.name}>{item.name}</span>
              <span className={ts.meta}>{t.convert.imageMeta(item.width, item.height)}</span>
            </span>
            <IconButton
              label={t.tools.moveUp}
              small
              disabled={busy || index === 0}
              onClick={() => {
                setItems((prev) => moveItem(prev, index, index - 1))
              }}
            >
              <IconChevronDown style={{ transform: 'rotate(180deg)' }} />
            </IconButton>
            <IconButton
              label={t.tools.moveDown}
              small
              disabled={busy || index === items.length - 1}
              onClick={() => {
                setItems((prev) => moveItem(prev, index, index + 2))
              }}
            >
              <IconChevronDown />
            </IconButton>
            <IconButton
              label={t.tools.removeItem}
              small
              disabled={busy}
              onClick={() => {
                remove(item.key)
              }}
            >
              <IconClose />
            </IconButton>
          </li>
        ))}
      </ol>
      <div className={ts.field}>
        <span className={ts.label}>{t.convert.pageSize}</span>
        <RadioGroup
          label={t.convert.pageSize}
          value={pageSize}
          onChange={setPageSize}
          options={[
            { value: 'a4', label: t.convert.sizeA4 },
            { value: 'image', label: t.convert.sizeImage }
          ]}
        />
      </div>
      {pageSize === 'a4' && (
        <div className={ts.field}>
          <span className={ts.label}>{t.convert.margins}</span>
          <div className={s.inline}>
            <RadioGroup
              label={t.convert.margins}
              value={margin}
              onChange={setMargin}
              options={[
                { value: 'none', label: t.convert.marginNone },
                { value: 'narrow', label: t.convert.marginNarrow },
                { value: 'normal', label: t.convert.marginNormal }
              ]}
            />
          </div>
        </div>
      )}
      <p className={s.hint}>{t.convert.orientationHint}</p>
      {error !== null && <p className={ts.error}>{error}</p>}
    </Dialog>
  )
}
