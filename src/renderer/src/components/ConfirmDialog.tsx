import { Button } from './controls'
import { Dialog } from './Dialog'

export interface ConfirmAction {
  label: string
  variant?: 'default' | 'primary'
  onClick: () => void
}

interface Props {
  open: boolean
  title: string
  message: string
  actions: ConfirmAction[]
  onCancel: () => void
}

/** Подтверждение с произвольным набором кнопок; Esc и крестик — отмена. */
export function ConfirmDialog({
  open,
  title,
  message,
  actions,
  onCancel
}: Props): React.JSX.Element | null {
  if (!open) return null
  return (
    <Dialog
      open
      title={title}
      onClose={onCancel}
      footer={actions.map((action) => (
        <Button key={action.label} variant={action.variant ?? 'default'} onClick={action.onClick}>
          {action.label}
        </Button>
      ))}
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Dialog>
  )
}
