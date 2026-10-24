import { useState } from 'react'
import { Button, Tabs } from '@renderer/components/controls'
import { Dialog } from '@renderer/components/Dialog'
import { t } from '@renderer/i18n'
import licenseText from '../../../../../LICENSE?raw'
import noticesText from '../../../../../THIRD_PARTY_NOTICES.md?raw'
import privacyText from '../../../../../PRIVACY.md?raw'
import s from './settings.module.css'

type Section = 'license' | 'notices' | 'privacy'

const TEXTS: Record<Section, string> = {
  license: licenseText,
  notices: noticesText,
  privacy: privacyText
}

/** Лицензия, перечень сторонних компонентов и политика конфиденциальности из корня репозитория. */
export function LicensesDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const [section, setSection] = useState<Section>('license')
  if (!open) return null
  return (
    <Dialog
      open
      title={t.settings.licenses}
      width={720}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t.properties.close}
        </Button>
      }
    >
      <Tabs
        label={t.settings.licenses}
        value={section}
        onChange={setSection}
        tabs={[
          { value: 'license', label: t.settings.licenseTab },
          { value: 'notices', label: t.settings.noticesTab },
          { value: 'privacy', label: t.settings.privacyTab }
        ]}
      />
      <pre className={s.licenseText}>{TEXTS[section]}</pre>
    </Dialog>
  )
}
