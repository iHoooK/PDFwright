import { useState } from 'react'
import { Button } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { useStore, type PasswordRequest } from '@renderer/app/store'
import { t } from '@renderer/i18n'
import s from '@renderer/components/dialog.module.css'

/** Запрос пароля для зашифрованного PDF; повторный показ сообщает о неверном пароле. */
export function PasswordDialog(): React.JSX.Element | null {
  const { state } = useStore()
  const request = state.passwordRequest
  if (!request) return null
  // Ключ сбрасывает поле ввода при каждом новом запросе (в том числе после неверного пароля).
  return <PasswordForm key={`${request.fileName}:${request.reason}`} request={request} />
}

function PasswordForm({ request }: { request: PasswordRequest }): React.JSX.Element {
  const [value, setValue] = useState('')
  const submit = (): void => {
    if (value.length > 0) request.resolve(value)
  }
  const cancel = (): void => {
    request.resolve(null)
  }
  return (
    <Dialog
      open
      title={t.password.title}
      onClose={cancel}
      footer={
        <>
          <Button onClick={cancel}>{t.password.cancel}</Button>
          <Button variant="primary" onClick={submit} disabled={value.length === 0}>
            {t.password.open}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{t.password.lead(request.fileName)}</p>
      {request.reason === 'wrong' && <p className={s.error}>{t.password.wrong}</p>}
      <input
        className={s.input}
        type="password"
        aria-label={t.password.title}
        value={value}
        autoFocus
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
      />
    </Dialog>
  )
}
