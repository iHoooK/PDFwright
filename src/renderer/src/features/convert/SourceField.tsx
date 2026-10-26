/* eslint-disable react-refresh/only-export-components -- общие поля и хуки диалогов конвертации */
import { useEffect, useMemo, useState } from 'react'
import { IconDocument } from '@renderer/icons'
import { Button, RadioGroup } from '@renderer/components/controls'
import { activeDoc, useStore, type ConvertSource } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { pageCount, PageRangeError } from '@shared/pdf-ops'
import { pagesFromSpec } from '@shared/convert/page-images'
import dialogStyles from '@renderer/components/dialog.module.css'
import ts from '@renderer/features/tools/tools.module.css'
import s from './convert.module.css'

export interface SourceState {
  source: ConvertSource | null
  /** Байты активного документа ещё готовятся (запись разметки). */
  loading: boolean
  error: string | null
  /** Источник — открытый документ (а не выбранный файл): результат можно применить к нему. */
  active: boolean
  pick: () => void
}

/**
 * Источник для конвертации: открытый документ (с несохранённой разметкой)
 * или PDF, выбранный кнопкой «Выбрать файл…».
 */
export function useConvertSource(): SourceState {
  const { state, actions, api } = useStore()
  const [source, setSource] = useState<ConvertSource | null>(null)
  const [loading, setLoading] = useState(() => activeDoc(state)?.status === 'ready')
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    let alive = true
    actions.convertSource().then(
      (current) => {
        if (!alive) return
        setSource(current)
        setActive(current !== null)
        setLoading(false)
      },
      (e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    )
    return () => {
      alive = false
    }
  }, [actions])

  const pick = (): void => {
    void (async () => {
      const file = await api.openPdfDialog()
      if (!file) return
      try {
        const bytes = new Uint8Array((await api.readFile(file.path)).bytes)
        setSource({ name: file.name, path: file.path, bytes, pages: await pageCount(bytes) })
        setActive(false)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  return { source, loading, error, active, pick }
}

export function SourceField({
  state,
  disabled
}: {
  state: SourceState
  disabled: boolean
}): React.JSX.Element {
  const { source, loading } = state
  return (
    <div className={ts.field}>
      <span className={ts.label}>{t.convert.source}</span>
      <div className={ts.row}>
        {source ? (
          <span className={ts.source}>
            <IconDocument />
            <span className={ts.name}>{source.name}</span>
            <span className={ts.meta}>{t.convert.pagesCount(source.pages)}</span>
          </span>
        ) : (
          <span className={ts.source}>
            <span className={ts.meta}>{loading ? t.tools.reading : t.convert.noSource}</span>
          </span>
        )}
        <Button onClick={state.pick} disabled={disabled}>
          {t.convert.chooseFile}
        </Button>
      </div>
    </div>
  )
}

export type PagesMode = 'all' | 'range'

export interface PagesState {
  mode: PagesMode
  spec: string
  setMode: (mode: PagesMode) => void
  setSpec: (spec: string) => void
  /** Выбранные страницы (с 1) или пусто при ошибке. */
  pages: number[]
  error: string | null
}

export function usePages(total: number): PagesState {
  const [mode, setMode] = useState<PagesMode>('all')
  const [spec, setSpec] = useState('')
  const { pages, error } = useMemo(() => {
    if (total === 0) return { pages: [], error: null }
    try {
      return { pages: pagesFromSpec(mode === 'all' ? null : spec, total), error: null }
    } catch (e) {
      return { pages: [], error: e instanceof PageRangeError ? e.message : String(e) }
    }
  }, [mode, spec, total])
  return { mode, spec, setMode, setSpec, pages, error }
}

/** Выбор страниц: все или диапазон `1-3, 5, 7-`. */
export function PagesField({ state }: { state: PagesState }): React.JSX.Element {
  return (
    <div className={ts.field}>
      <span className={ts.label}>{t.convert.pages}</span>
      <div className={s.inline}>
        <RadioGroup
          label={t.convert.pages}
          value={state.mode}
          onChange={state.setMode}
          options={[
            { value: 'all', label: t.convert.pagesAll },
            { value: 'range', label: t.convert.pagesRange }
          ]}
        />
      </div>
      {state.mode === 'range' && (
        <input
          className={dialogStyles.input}
          aria-label={t.convert.rangeLabel}
          value={state.spec}
          placeholder="1-3, 5, 7-"
          onChange={(event) => {
            state.setSpec(event.target.value)
          }}
        />
      )}
      {state.mode === 'range' && state.spec.trim().length > 0 && (
        <p className={s.hint}>{state.error ?? t.convert.pagesPicked(state.pages.length)}</p>
      )}
    </div>
  )
}

export function Progress({ done, total }: { done: number; total: number }): React.JSX.Element {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className={s.progress}>
      <span>{t.convert.progress(Math.min(total, done + 1), total)}</span>
      <div
        className={s.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
