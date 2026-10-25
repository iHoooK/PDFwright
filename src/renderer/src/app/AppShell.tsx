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
import { CompareScreen } from '@renderer/features/compare/CompareScreen'
import logo from '../assets/logo.svg'
import { activeDoc, useStore, type DocTab } from './store'
import { useHotkeys } from './hotkeys'
import { resolvedTheme } from './theme'
import s from './app.module.css'

export function AppShell(): React.JSX.Element {
  const { state, actions } = useStore()
  useHotkeys()
  const doc = activeDoc(state)
  const dark = resolvedTheme() === 'dark'

  return (
    <div
      className={s.app}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (event.dataTransfer.files.length > 0) actions.openFiles(event.dataTransfer.files)
      }}
    >
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
              <span className={s.tabName}>{d.dirty ? `${d.name} •` : d.name}</span>
              <span
                role="button"
                tabIndex={0}
                className={s.tabClose}
                aria-label={`${t.app.closeTab}: ${d.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.requestCloseDoc(d.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    actions.requestCloseDoc(d.id)
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
        {state.screen === 'compare' && <CompareScreen />}
      </main>

      <footer className={s.statusbar}>
        {doc?.status === 'ready' ? (
          <>
            <span>{t.viewer.pageOf(state.page, doc.pages)}</span>
            <span>{pageSizeLabel(doc)}</span>
            <span>{state.resolvedZoom}%</span>
          </>
        ) : (
          <span>{doc ? doc.name : t.app.name}</span>
        )}
        <span className={s.grow} />
        <span>
          <kbd>Ctrl</kbd> + <kbd>F</kbd> {t.viewer.searchHint}
        </span>
        {doc?.status === 'ready' &&
          (doc.dirty ? (
            <span className={s.warn}>{t.viewer.unsaved}</span>
          ) : (
            <span className={s.ok}>{t.viewer.saved}</span>
          ))}
      </footer>

      <Toast message={state.toast} />
    </div>
  )
}

function pageSizeLabel(doc: DocTab): string {
  const size = doc.doc?.sizeOf(1)
  if (!size) return ''
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4)
  return `${mm(size.width)} × ${mm(size.height)} мм`
}
