import type { ReactNode } from 'react'
import {
  IconBack,
  IconCopy,
  IconDocument,
  IconExternal,
  IconInfo,
  IconKeyboard,
  IconLink,
  IconPages,
  IconPerson,
  IconSave,
  IconSettings,
  IconText,
  IconTheme,
  IconUpdate,
  IconView,
  IconZoomIn
} from '@renderer/icons'
import { t } from '@renderer/i18n'
import { Button, SelectField, SettingCard, Toggle } from '@renderer/components/controls'
import { cx } from '@renderer/components/cx'
import { useStore, type SettingsSection } from '@renderer/app/store'
import { HOTKEYS } from '@renderer/app/hotkeys'
import { DEVELOPER_LINKS, RELEASES_PAGE } from '@shared/external-links'
import {
  SCROLL_MODES,
  THEMES,
  ZOOM_MODES,
  type ScrollMode,
  type Theme,
  type ZoomMode
} from '@shared/settings-schema'
import s from './settings.module.css'

const SECTIONS: readonly { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: t.settings.general, icon: <IconSettings /> },
  { id: 'view', label: t.settings.view, icon: <IconView /> },
  { id: 'updates', label: t.settings.updates, icon: <IconUpdate /> },
  { id: 'about', label: t.settings.about, icon: <IconInfo /> },
  { id: 'author', label: t.settings.author, icon: <IconPerson /> }
]

const THEME_LABELS: Record<Theme, string> = {
  system: t.settings.themeSystem,
  light: t.settings.themeLight,
  dark: t.settings.themeDark
}
const ZOOM_LABELS: Record<ZoomMode, string> = {
  'fit-width': t.settings.zoomFitWidth,
  'fit-page': t.settings.zoomFitPage,
  actual: t.settings.zoomActual
}
const SCROLL_LABELS: Record<ScrollMode, string> = {
  continuous: t.settings.scrollContinuous,
  single: t.settings.scrollSingle,
  spread: t.settings.scrollSpread
}

export function SettingsScreen(): React.JSX.Element {
  const { state, actions } = useStore()
  const { settings, info } = state
  const section = state.settingsSection
  const version = info?.version ?? '…'
  const kind = info
    ? info.packaged
      ? info.portable
        ? t.settings.kindPortable
        : t.settings.kindInstalled
      : t.settings.kindDev
    : ''

  const copyDiagnostics = (): void => {
    const lines = [
      `PDFwright ${version}`,
      `Electron ${info?.electron ?? '?'} · Chromium ${info?.chrome ?? '?'} · Node ${info?.node ?? '?'}`,
      `${info?.platform ?? '?'} ${info?.arch ?? ''}`.trim(),
      `Сборка: ${kind}`,
      `Данные: ${info?.userDataPath ?? '?'}`
    ]
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => {
        actions.toast(t.settings.copied)
      })
      .catch(() => {
        actions.toast(t.toast.soon)
      })
  }

  return (
    <div className={s.settings}>
      <nav className={s.nav} aria-label={t.settings.title}>
        <h2>{t.settings.title}</h2>
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={s.navItem}
            aria-current={section === sec.id}
            onClick={() => {
              actions.openSettings(sec.id)
            }}
          >
            {sec.icon}
            {sec.label}
          </button>
        ))}
        <button
          type="button"
          className={`${s.navItem ?? ''} ${s.back ?? ''}`}
          onClick={() => {
            actions.go(state.docs.length > 0 ? 'viewer' : 'start')
          }}
        >
          <IconBack />
          {t.settings.back}
        </button>
      </nav>

      <div className={s.body}>
        {section === 'general' && (
          <section className={s.section}>
            <h1>{t.settings.general}</h1>
            <p className={s.lead}>{t.settings.generalLead}</p>
            <SettingCard icon={<IconTheme />} title={t.settings.theme} hint={t.settings.themeHint}>
              <SelectField
                label={t.settings.theme}
                value={settings.general.theme}
                options={THEMES.map((v) => ({ value: v, label: THEME_LABELS[v] }))}
                onChange={(theme) => {
                  void actions.updateSettings({ general: { theme } })
                }}
              />
            </SettingCard>
            <SettingCard
              icon={<IconText />}
              title={t.settings.language}
              hint={t.settings.languageHint}
            >
              <SelectField
                label={t.settings.language}
                value="ru"
                options={[{ value: 'ru', label: t.settings.languageRu }]}
                onChange={() => undefined}
                disabled
              />
            </SettingCard>
            <SettingCard icon={<IconSave />} title={t.settings.backup} hint={t.settings.backupHint}>
              <Toggle
                checked={settings.files.backupOnSave}
                onLabel={t.settings.on}
                offLabel={t.settings.off}
                onChange={(backupOnSave) => {
                  void actions.updateSettings({ files: { backupOnSave } })
                }}
              />
            </SettingCard>
            <SettingCard icon={<IconKeyboard />} title={t.settings.hotkeys} column>
              <dl className={s.hotkeys}>
                {HOTKEYS.map((h) => (
                  <div key={h.keys} style={{ display: 'contents' }}>
                    <dt>
                      <kbd>{h.keys}</kbd>
                    </dt>
                    <dd style={{ margin: 0 }}>{h.action}</dd>
                  </div>
                ))}
              </dl>
            </SettingCard>
          </section>
        )}

        {section === 'view' && (
          <section className={s.section}>
            <h1>{t.settings.view}</h1>
            <p className={s.lead}>{t.settings.viewLead}</p>
            <SettingCard icon={<IconZoomIn />} title={t.settings.zoom}>
              <SelectField
                label={t.settings.zoom}
                value={settings.viewer.defaultZoom}
                options={ZOOM_MODES.map((v) => ({ value: v, label: ZOOM_LABELS[v] }))}
                onChange={(defaultZoom) => {
                  void actions.updateSettings({ viewer: { defaultZoom } })
                }}
              />
            </SettingCard>
            <SettingCard icon={<IconPages />} title={t.settings.scroll}>
              <SelectField
                label={t.settings.scroll}
                value={settings.viewer.scrollMode}
                options={SCROLL_MODES.map((v) => ({ value: v, label: SCROLL_LABELS[v] }))}
                onChange={(scrollMode) => {
                  void actions.updateSettings({ viewer: { scrollMode } })
                }}
              />
            </SettingCard>
          </section>
        )}

        {section === 'updates' && (
          <section className={s.section}>
            <h1>{t.settings.updates}</h1>
            <p className={s.lead}>{t.settings.updatesLead}</p>
            <SettingCard
              icon={<IconUpdate />}
              title={t.settings.installed(version)}
              hint={t.settings.updatesHint}
              column
            >
              <div className={s.row}>
                <Button
                  variant="primary"
                  onClick={() => {
                    actions.toast(t.settings.updatesSoon)
                  }}
                >
                  {t.settings.check}
                </Button>
                <Button
                  icon={<IconExternal />}
                  onClick={() => {
                    actions.openExternal(RELEASES_PAGE)
                  }}
                >
                  {t.settings.releases}
                </Button>
              </div>
            </SettingCard>
          </section>
        )}

        {section === 'about' && (
          <section className={s.section}>
            <h1>{t.settings.about}</h1>
            <p className={s.lead}>{t.settings.aboutLead(version, kind)}</p>
            <SettingCard icon={<IconDocument />} title={t.app.name} column>
              <p className={s.text}>{t.settings.aboutText}</p>
              <div className={s.row}>
                <Button icon={<IconCopy />} onClick={copyDiagnostics}>
                  {t.settings.copyDiag}
                </Button>
                <Button
                  onClick={() => {
                    actions.toast(t.toast.soon)
                  }}
                >
                  {t.settings.licenses}
                </Button>
              </div>
            </SettingCard>
          </section>
        )}

        {section === 'author' && (
          <section className={s.section}>
            <h1>{t.settings.author}</h1>
            <p className={s.lead}>{t.settings.authorLead}</p>
            <SettingCard icon={<IconPerson />} title="Promptix" column>
              <p className={s.text}>{t.settings.authorText}</p>
              <div className={s.links}>
                {DEVELOPER_LINKS.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    className={s.link}
                    onClick={() => {
                      actions.openExternal(link.url)
                    }}
                  >
                    <IconLink />
                    {link.label}
                    <IconExternal className={cx(s.arrow)} />
                  </button>
                ))}
              </div>
            </SettingCard>
          </section>
        )}
      </div>
    </div>
  )
}
