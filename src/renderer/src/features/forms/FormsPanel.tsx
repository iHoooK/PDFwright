import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/controls'
import { activeDoc, useStore } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { createCancelToken, type FieldObjects } from '@renderer/pdf-engine/engine'
import v from '@renderer/features/viewer/viewer.module.css'

/** Виды полей, которые заполняет слой форм (у pdf.js в `getFieldObjects`). */
const FILLABLE = new Set(['text', 'checkbox', 'radiobutton', 'combobox', 'listbox'])

function fillableCount(fields: FieldObjects | null): number {
  if (!fields) return 0
  let count = 0
  for (const widgets of fields.values()) {
    if (widgets.some((w) => FILLABLE.has(w.type))) count += 1
  }
  return count
}

/**
 * Карточка «Форма» в панели свойств: сколько полей в документе и сколько
 * изменено, сброс несохранённых значений и вплавление полей в страницы.
 * Показывается, только если в документе есть заполняемые поля.
 */
export function FormsPanel(): React.JSX.Element | null {
  const { state, actions } = useStore()
  const tab = activeDoc(state)
  const doc = tab?.doc ?? null
  const [count, setCount] = useState<{ doc: unknown; fields: number } | null>(null)

  useEffect(() => {
    if (!doc) return
    const run = createCancelToken()
    void doc.getFieldObjects().then((fields) => {
      if (!run.isCancelled()) setCount({ doc, fields: fillableCount(fields) })
    })
    return () => {
      run.cancel()
    }
  }, [doc])

  const fields = count?.doc === doc ? count.fields : 0
  if (!tab || fields === 0) return null
  const changed = Object.keys(tab.forms).length
  return (
    <div className={v.pcard} data-forms-panel="">
      <b style={{ fontWeight: 600 }}>{t.forms.title}</b>
      <p className="muted" style={{ margin: 0 }}>
        {t.forms.fields(fields)}
        {changed > 0 && (
          <>
            <br />
            {t.forms.changed(changed)}
          </>
        )}
      </p>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {state.tool === 'select' ? t.forms.hint : t.forms.otherTool}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button disabled={changed === 0 || tab.busy} onClick={actions.resetForms}>
          {t.forms.reset}
        </Button>
        <Button title={t.forms.flattenHint} disabled={tab.busy} onClick={actions.flattenForms}>
          {t.forms.flatten}
        </Button>
      </div>
    </div>
  )
}
