import {
  IconAdd,
  IconClose,
  IconDocument,
  IconHome,
  IconMoon,
  IconSettings,
  IconSun
} from '@renderer/icons'
import { t } from '@renderer/i18n'
import { IconButton, Toast } from '@renderer/components/controls'
import { StartScreen } from '@renderer/features/start/StartScreen'
import { ViewerScreen } from '@renderer/features/viewer/ViewerScreen'
import { SettingsScreen } from '@renderer/features/settings/SettingsScreen'
import { KitScreen } from '@renderer/features/kit/KitScreen'
import logo from '../assets/logo.svg'
import { activeDoc, useStore } from './store'
import { useHotkeys } from './hotkeys'
import { resolvedTheme } from './theme'
import s from './app.module.css'

export function AppShell(): React.JSX.Element {
  const { state, actions } = useStore()
  useHotkeys()
  const doc = activeDoc(state)
  const dark = resolvedTheme() === 'dark'

  return (
    <div className={s.app}>
      <header className={s.titlebar}>
        <div className={s.brand}>
          <img className={s.logo} src={logo} alt="" width={20} height={20} />
          <span>{t.app.name}</span>
        </div>
        <div className={s.tabs} role="tablist" aria-label="Документы">
          <button
            type="button"
            role="tab"
            className={s.tab}
            aria-selected={state.screen === 'start'}
            onClick={() => {
              actions.go('start')
            }}
          >
            <IconHome />
            <span className={s.tabName}>{t.app.startTab}</span>
          </button>
          {state.docs.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              className={s.tab}
              aria-selected={state.screen === 'viewer' && d.id === state.activeId}
              title={d.path}
              onClick={() => {
                actions.activateDoc(d.id)
              }}
            >
              <IconDocument />
              <span className={s.tabName}>{d.name}</span>
              <span
                role="button"
                tabIndex={0}
                className={s.tabClose}
                aria-label={`${t.app.closeTab}: ${d.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.closeDoc(d.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    actions.closeDoc(d.id)
                  }
                }}
              >
                <IconClose />
              </span>
            </button>
          ))}
          <IconButton
            label={t.app.openFile}
            className={s.tabAdd}
            onClick={() => {
              void actions.openDialog()
            }}
          >
            <IconAdd />
          </IconButton>
        </div>
        <div className={s.actions}>
          <IconButton label={t.app.toggleTheme} onClick={actions.cycleTheme}>
            {dark ? <IconSun /> : <IconMoon />}
          </IconButton>
          <IconButton
            label={t.app.settings}
            pressed={state.screen === 'settings'}
            onClick={() => {
              actions.openSettings()
            }}
          >
            <IconSettings />
          </IconButton>
        </div>
      </header>

      <main className={s.screen}>
        {state.screen === 'start' && <StartScreen />}
        {state.screen === 'viewer' && <ViewerScreen />}
        {state.screen === 'settings' && <SettingsScreen />}
        {state.screen === 'kit' && <KitScreen />}
      </main>

      <footer className={s.statusbar}>
        {doc ? (
          <>
            <span>{t.viewer.pageOf(state.page, doc.pages)}</span>
            <span>{t.viewer.paperA4}</span>
          </>
        ) : (
          <span>{t.app.name}</span>
        )}
        <span className={s.grow} />
        <span>
          <kbd>Ctrl</kbd> + <kbd>F</kbd> {t.viewer.searchHint}
        </span>
        {doc && <span className={s.ok}>{t.viewer.saved}</span>}
      </footer>

      <Toast message={state.toast} />
    </div>
  )
}
