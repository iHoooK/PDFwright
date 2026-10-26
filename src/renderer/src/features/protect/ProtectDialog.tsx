import { useState } from 'react'
import { Button, Toggle } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { activeDoc, useStore, type DocTab } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import { pdfContent } from '@renderer/pdf-content/client'
import ds from '@renderer/components/dialog.module.css'
import ts from '@renderer/features/tools/tools.module.css'

/**
 * «Защита паролем»: установить, сменить или снять пароль документа. Изменение —
 * шаг истории; шифрование выполняется при записи файла. Документ, открытый
 * паролем на открытие, меняет защиту только после ввода пароля владельца.
 */
export function ProtectDialog(): React.JSX.Element | null {
  const { state } = useStore()
  const tab = activeDoc(state)
  if (state.toolDialog !== 'protect' || tab?.status !== 'ready') return null
  return <ProtectForm key={tab.id} tab={tab} />
}

function ProtectForm({ tab }: { tab: DocTab }): React.JSX.Element {
  const { actions } = useStore()
  const protection = tab.protection ?? null
  const [user, setUser] = useState('')
  const [repeat, setRepeat] = useState('')
  const [owner, setOwner] = useState('')
  const [current, setCurrent] = useState('')
  const [allowPrint, setAllowPrint] = useState(true)
  const [allowCopy, setAllowCopy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const needsOwner = protection?.kind === 'file' && protection.info.access === 'user'
  const restricted = owner !== '' && owner !== user
  const close = (): void => {
    actions.openTool(null)
  }

  const lead: string[] = []
  if (!protection) lead.push(t.protect.leadNone)
  else if (protection.kind === 'new') lead.push(t.protect.leadNew)
  else {
    lead.push(t.protect.leadFile(protection.info.method))
    if (!protection.info.canPrint) lead.push(t.protect.noPrint)
    if (!protection.info.canCopy) lead.push(t.protect.noCopy)
  }

  /** Пароль владельца нужен, если документ открыт паролем на открытие. */
  const ownerConfirmed = async (): Promise<boolean> => {
    if (protection?.kind !== 'file' || !needsOwner) return true
    if (current === '') {
      setError(t.protect.ownerRequired)
      return false
    }
    setBusy(true)
    try {
      const info = await pdfContent.inspectProtection(protection.original, current)
      if (info?.access === 'owner') return true
    } catch {
      // неверный пароль — то же сообщение
    } finally {
      setBusy(false)
    }
    setError(t.protect.ownerWrong)
    return false
  }

  const apply = async (): Promise<void> => {
    if (busy) return
    if (user === '') {
      setError(t.protect.userRequired)
      return
    }
    if (user !== repeat) {
      setError(t.protect.mismatch)
      return
    }
    if (!(await ownerConfirmed())) return
    actions.setProtection({
      userPassword: user,
      ownerPassword: owner,
      allowPrint: restricted ? allowPrint : true,
      allowCopy: restricted ? allowCopy : true
    })
    close()
  }

  const remove = async (): Promise<void> => {
    if (busy || !(await ownerConfirmed())) return
    actions.removeProtection()
    close()
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void
  ): React.JSX.Element => (
    <div className={ts.field}>
      <label className={ts.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={ds.input}
        type="password"
        autoComplete="new-password"
        value={value}
        disabled={busy}
        onChange={(event) => {
          setError(null)
          onChange(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void apply()
        }}
      />
    </div>
  )

  const toggle = (
    id: string,
    label: string,
    value: boolean,
    onChange: (value: boolean) => void
  ): React.JSX.Element => (
    <div className={ts.row} style={{ justifyContent: 'space-between' }}>
      <label htmlFor={id}>{label}</label>
      <Toggle
        id={id}
        checked={value}
        onLabel={t.protect.yes}
        offLabel={t.protect.no}
        disabled={busy || !restricted}
        onChange={onChange}
      />
    </div>
  )

  return (
    <Dialog
      open
      title={t.protect.title}
      width={480}
      onClose={close}
      footer={
        <>
          {protection && (
            <Button
              variant="subtle"
              disabled={busy || tab.busy}
              style={{ marginRight: 'auto' }}
              onClick={() => {
                void remove()
              }}
            >
              {t.protect.remove}
            </Button>
          )}
          <Button onClick={close}>{t.protect.cancel}</Button>
          <Button
            variant="primary"
            disabled={busy || tab.busy}
            onClick={() => {
              void apply()
            }}
          >
            {protection ? t.protect.change : t.protect.set}
          </Button>
        </>
      }
    >
      <p className={ts.lead}>{lead.join(' ')}</p>
      {needsOwner && (
        <>
          <p className={ts.lead}>{t.protect.leadUser}</p>
          {field('protect-current', t.protect.current, current, setCurrent)}
        </>
      )}
      {field('protect-user', t.protect.user, user, setUser)}
      {field('protect-repeat', t.protect.repeat, repeat, setRepeat)}
      {field('protect-owner', t.protect.owner, owner, setOwner)}
      <p className={ts.label} style={{ margin: 0 }}>
        {t.protect.ownerHint}
      </p>
      {toggle('protect-print', t.protect.allowPrint, allowPrint, setAllowPrint)}
      {toggle('protect-copy', t.protect.allowCopy, allowCopy, setAllowCopy)}
      {error !== null && (
        <p className={ds.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
