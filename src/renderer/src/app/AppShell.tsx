import { useCallback, useEffect, useState } from 'react'
import {
  IconAdd,
  IconClose,
  IconDocument,
  IconExternal,
  IconHome,
  IconMoon,
  IconSettings,
  IconSun
} from '@renderer/icons'
import { t } from '@renderer/i18n'
import { IconButton, Toast } from '@renderer/components/controls'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { StartScreen } from '@renderer/features/start/StartScreen'
import { ViewerScreen } from '@renderer/features/viewer/ViewerScreen'
import { SettingsScreen } from '@renderer/features/settings/SettingsScreen'
import { KitScreen } from '@renderer/features/kit/KitScreen'
import { CompareScreen } from '@renderer/features/compare/CompareScreen'
import { ConvertDialogs } from '@renderer/features/convert/ConvertDialogs'
import { PasswordDialog } from '@renderer/features/viewer/PasswordDialog'
import logo from '../assets/logo.svg'
import { activeDoc, useStore, type DocTab } from './store'
import { useHotkeys } from './hotkeys'
import { ContextMenu } from './ContextMenu'
import { resolvedTheme } from './theme'
import { windowTitle } from './window-title'
import s from './app.module.css'

export function AppShell(): React.JSX.Element {
  const { state, actions } = useStore()
  useHotkeys()
  const doc = activeDoc(state)
  // Строка состояния и заголовок окна говорят о документе, только когда он на экране.
  const shown = state.screen === 'viewer' ? doc : null
  const dark = resolvedTheme() === 'dark'
  const title = windowTitle(
    state.screen === 'viewer' || state.screen === 'compare' ? (doc?.name ?? null) : null
  )
  useEffect(() => {
    document.title = title
  }, [title])
  const [tabMenu, setTabMenu] = useState<{ tab: DocTab; x: number; y: number } | null>(null)
  const [moveConfirm, setMoveConfirm] = useState<DocTab | null>(null)
  const closeTabMenu = useCallback(() => {
    setTabMenu(null)
  }, [])

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
        <div className={s.tabs} role="tablist" aria-label={t.a11y.tabs}>
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
              onContextMenu={(event) => {
                event.preventDefault()
                // Меню с клавиатуры (Shift+F10) приходит без координат курсора.
                const rect = event.currentTarget.getBoundingClientRect()
                const fromKeyboard = event.clientX === 0 && event.clientY === 0
                setTabMenu({
                  tab: d,
                  x: fromKeyboard ? rect.left : event.clientX,
                  y: fromKeyboard ? rect.bottom : event.clientY
                })
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
        {shown?.status === 'ready' ? (
          <>
            <span>{t.viewer.pageOf(state.page, shown.pages)}</span>
            <span>{pageSizeLabel(shown, state.page)}</span>
            <span>{state.resolvedZoom}%</span>
          </>
        ) : (
          <span>{shown ? shown.name : t.app.name}</span>
        )}
        <span className={s.grow} />
        {shown?.status === 'ready' && (
          <span>
            <kbd>Ctrl</kbd> + <kbd>F</kbd> {t.viewer.searchHint}
          </span>
        )}
        {shown?.status === 'ready' &&
          (shown.dirty ? (
            <span className={s.warn}>{t.viewer.unsaved}</span>
          ) : (
            <span className={s.ok}>{t.viewer.saved}</span>
          ))}
      </footer>

      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          label={t.windows.tabMenu(tabMenu.tab.name)}
          onClose={closeTabMenu}
          items={[
            ...(tabMenu.tab.status === 'error'
              ? []
              : [
                  {
                    label: t.windows.openInNewWindow,
                    icon: <IconExternal />,
                    onSelect: () => {
                      const tab = state.docs.find((d) => d.id === tabMenu.tab.id)
                      if (tab?.dirty) setMoveConfirm(tab)
                      else actions.openInNewWindow(tabMenu.tab.id)
                    }
                  }
                ]),
            {
              label: t.windows.closeTab,
              icon: <IconClose />,
              onSelect: () => {
                actions.requestCloseDoc(tabMenu.tab.id)
              }
            }
          ]}
        />
      )}

      <ConfirmDialog
        open={moveConfirm !== null}
        title={t.windows.saveFirstTitle}
        message={moveConfirm ? t.windows.saveFirstText(moveConfirm.name) : ''}
        onCancel={() => {
          setMoveConfirm(null)
        }}
        actions={[
          {
            label: t.windows.saveAndOpen,
            variant: 'primary',
            onClick: () => {
              if (moveConfirm) actions.openInNewWindow(moveConfirm.id, true)
              setMoveConfirm(null)
            }
          },
          {
            label: t.windows.cancel,
            onClick: () => {
              setMoveConfirm(null)
            }
          }
        ]}
      />

      <ConvertDialogs />
      {/* Пароль спрашивается и при открытии вкладки, и из диалогов конвертации — поверх них. */}
      <PasswordDialog />
      <Toast message={state.toast} action={state.toastAction} />
    </div>
  )
}

/** Размер текущей страницы: у документа страницы бывают разные. */
function pageSizeLabel(doc: DocTab, page: number): string {
  const size = doc.doc?.sizeOf(page)
  if (!size) return ''
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4)
  return `${mm(size.width)} × ${mm(size.height)} ${t.units.mm}`
}
