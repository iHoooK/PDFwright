import { useEffect, useState } from 'react'
import type { AppInfo, OpenedPdfFile } from '@shared/ipc-contract'
import { THEMES, type AppSettings, type Theme } from '@shared/settings-schema'

const THEME_LABELS: Record<Theme, string> = {
  system: 'Как в системе',
  light: 'Светлая',
  dark: 'Тёмная'
}

/**
 * Заглушка фазы 0: доказывает, что IPC, настройки и темы работают.
 * Настоящий app shell появится в фазе 1 после выбора дизайна.
 */
export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [opened, setOpened] = useState<OpenedPdfFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([window.pdfwright.getAppInfo(), window.pdfwright.getSettings()])
      .then(([appInfo, appSettings]) => {
        setInfo(appInfo)
        setSettings(appSettings)
        console.info(
          `[pdfwright] IPC готов: версия ${appInfo.version}, тема ${appSettings.general.theme}`
        )
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.general.theme ?? 'system'
  }, [settings?.general.theme])

  const changeTheme = (theme: Theme): void => {
    void window.pdfwright.updateSettings({ general: { theme } }).then(setSettings)
  }

  const openPdf = (): void => {
    void window.pdfwright.openPdfDialog().then(setOpened)
  }

  return (
    <main className="shell">
      <header className="shell__header">
        <h1 className="shell__title">PDFwright</h1>
        <p className="shell__subtitle">
          Фаза 0: каркас приложения. Интерфейс появится после выбора дизайна.
        </p>
      </header>

      <section className="card">
        <h2>Документ</h2>
        <button type="button" onClick={openPdf}>
          Открыть PDF…
        </button>
        <p className="muted">{opened ? `Выбран файл: ${opened.name}` : 'Файл не выбран.'}</p>
      </section>

      <section className="card">
        <h2>Тема</h2>
        <div className="row">
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={settings?.general.theme === theme}
              onClick={() => {
                changeTheme(theme)
              }}
            >
              {THEME_LABELS[theme]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>О сборке</h2>
        {error && <p className="error">Ошибка IPC: {error}</p>}
        {info ? (
          <dl className="facts">
            <dt>Версия</dt>
            <dd>{info.version}</dd>
            <dt>Electron</dt>
            <dd>{info.electron}</dd>
            <dt>Chromium</dt>
            <dd>{info.chrome}</dd>
            <dt>Node.js</dt>
            <dd>{info.node}</dd>
            <dt>Сборка</dt>
            <dd>{info.packaged ? (info.portable ? 'portable' : 'установленная') : 'разработка'}</dd>
            <dt>Данные</dt>
            <dd>{info.userDataPath}</dd>
          </dl>
        ) : (
          !error && <p className="muted">Загрузка…</p>
        )}
      </section>
    </main>
  )
}
